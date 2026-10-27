"""Fetch and normalize ESPN Fantasy Football league data.

ESPN's API is unofficial. Public leagues work with no credentials; private
leagues need the `espn_s2` and `SWID` cookies from a logged-in browser session.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
VIEWS = ["mTeam", "mMatchupScore", "mScoreboard", "mSettings", "mStatus"]


class ESPNError(Exception):
    pass


@dataclass
class Team:
    id: int
    name: str
    abbrev: str
    owners: list[str] = field(default_factory=list)


@dataclass
class Game:
    """One team's side of a matchup in a given week."""

    team_id: int
    opp_id: int | None  # None for a bye
    points: float
    opp_points: float | None
    result: str  # "W", "L", "T", or "BYE"


@dataclass
class League:
    id: int
    season: int
    name: str
    teams: dict[int, Team]
    weeks: dict[int, list[Game]]  # completed matchup periods only
    regular_season_weeks: int
    current_week: int
    # In-progress week: {"week", "games": [{teamId, oppId, projected, live}]}
    projection: dict | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "season": self.season,
            "name": self.name,
            "teams": {tid: vars(t) for tid, t in self.teams.items()},
            "completedWeeks": sorted(self.weeks),
            "regularSeasonWeeks": self.regular_season_weeks,
            "currentWeek": self.current_week,
        }


def fetch_raw(league_id: int, season: int, espn_s2: str | None = None,
              swid: str | None = None, timeout: float = 20) -> dict:
    params = urllib.parse.urlencode([("view", v) for v in VIEWS])
    if season < 2018:
        url = f"{BASE}/leagueHistory/{league_id}?seasonId={season}&{params}"
    else:
        url = f"{BASE}/seasons/{season}/segments/0/leagues/{league_id}?{params}"

    headers = {"Accept": "application/json", "User-Agent": "espn-standings/1.0"}
    cookies = []
    if espn_s2:
        cookies.append(f"espn_s2={espn_s2.strip()}")
    if swid:
        swid = swid.strip()
        if not swid.startswith("{"):
            swid = "{" + swid.strip("{}") + "}"
        cookies.append(f"SWID={swid}")
    if cookies:
        headers["Cookie"] = "; ".join(cookies)

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ESPNError(
                "ESPN refused access. This league is probably private: "
                "add your espn_s2 and SWID cookies.") from e
        if e.code == 404:
            raise ESPNError(f"League {league_id} not found for season {season}.") from e
        raise ESPNError(f"ESPN returned HTTP {e.code}.") from e
    except urllib.error.URLError as e:
        raise ESPNError(f"Could not reach ESPN: {e.reason}") from e

    if isinstance(data, list):  # leagueHistory returns a list
        if not data:
            raise ESPNError(f"No data for season {season}.")
        data = data[0]
    return data


def parse_league(data: dict, include_playoffs: bool = False) -> League:
    members = {}
    for m in data.get("members", []):
        name = m.get("displayName") or " ".join(
            p for p in (m.get("firstName"), m.get("lastName")) if p)
        members[m["id"]] = name

    teams = {}
    for t in data.get("teams", []):
        name = t.get("name") or f"{t.get('location', '')} {t.get('nickname', '')}".strip()
        teams[t["id"]] = Team(
            id=t["id"],
            name=name or f"Team {t['id']}",
            abbrev=t.get("abbrev", ""),
            owners=[members[o] for o in t.get("owners", []) if o in members],
        )

    settings = data.get("settings", {})
    sched = settings.get("scheduleSettings", {})
    reg_weeks = sched.get("matchupPeriodCount") or 0
    status = data.get("status", {})
    current = status.get("currentMatchupPeriod") or data.get("scoringPeriodId") or 0

    by_week: dict[int, list[dict]] = {}
    for m in data.get("schedule", []):
        if not include_playoffs and m.get("playoffTierType", "NONE") != "NONE":
            continue
        by_week.setdefault(m["matchupPeriodId"], []).append(m)

    weeks: dict[int, list[Game]] = {}
    projection = None
    for week, matchups in sorted(by_week.items()):
        # Only count a week once every matchup in it is final.
        if any(m.get("winner", "UNDECIDED") == "UNDECIDED" and "away" in m
               for m in matchups):
            if week == current:
                projection = {"week": week, "games": _projected_games(matchups)}
            continue
        games = []
        for m in matchups:
            home, away = m["home"], m.get("away")
            hp = float(home.get("totalPoints", 0))
            if away is None:
                games.append(Game(home["teamId"], None, hp, None, "BYE"))
                continue
            ap = float(away.get("totalPoints", 0))
            winner = m.get("winner")
            hr, ar = {"HOME": ("W", "L"), "AWAY": ("L", "W")}.get(winner, ("T", "T"))
            games.append(Game(home["teamId"], away["teamId"], hp, ap, hr))
            games.append(Game(away["teamId"], home["teamId"], ap, hp, ar))
        weeks[week] = games

    return League(
        id=data.get("id", 0),
        season=data.get("seasonId", 0),
        name=settings.get("name", "Fantasy League"),
        teams=teams,
        weeks=weeks,
        regular_season_weeks=reg_weeks,
        current_week=current,
        projection=projection,
    )


def _projected_games(matchups: list[dict]) -> list[dict]:
    """ESPN's live projected totals (actual points so far + projections)."""
    def side(s: dict) -> dict:
        live = float(s.get("totalPointsLive", s.get("totalPoints", 0)) or 0)
        return {"teamId": s["teamId"], "live": live,
                "projected": float(s.get("totalProjectedPointsLive") or live)}

    games = []
    for m in matchups:
        home = side(m["home"])
        if "away" not in m:
            games.append({**home, "oppId": None})
            continue
        away = side(m["away"])
        games.append({**home, "oppId": away["teamId"]})
        games.append({**away, "oppId": home["teamId"]})
    return games


def fetch_league(league_id: int, season: int, espn_s2: str | None = None,
                 swid: str | None = None, include_playoffs: bool = False) -> League:
    return parse_league(fetch_raw(league_id, season, espn_s2, swid), include_playoffs)
