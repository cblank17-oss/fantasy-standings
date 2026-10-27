"""Fetch ESPN Fantasy Football league data.

Python only fetches and trims the data; parsing and scoring live in
static/js/ so the published page, the local app and the tests share one copy.

ESPN's API is unofficial. Public leagues work with no credentials; private
leagues need the `espn_s2` and `SWID` cookies from a logged-in browser session.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
VIEWS = ["mTeam", "mMatchupScore", "mScoreboard", "mSettings", "mStatus"]


class ESPNError(Exception):
    pass


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


def _pick(d: dict, keys: tuple[str, ...]) -> dict:
    return {k: d[k] for k in keys if k in d}


def owner_of(team: dict) -> str:
    return team.get("primaryOwner") or (team.get("owners") or [None])[0] or f"team-{team['id']}"


def trim(raw: dict, keep_members: bool = False, managers: dict[str, str] | None = None) -> dict:
    """Keep only the fields static/js/espn.js reads.

    Without keep_members, owner names are dropped (the published page is public).
    `managers` maps ESPN owner ids to opaque ids, so history can follow a person
    across seasons without publishing their ESPN id.
    If the parser starts reading a new field, add it here.
    """
    side = ("teamId", "totalPoints", "totalPointsLive", "totalProjectedPointsLive")
    team_keys = ("id", "name", "location", "nickname", "abbrev", "rankCalculatedFinal", "playoffSeed") \
        + (("owners",) if keep_members else ())
    schedule = []
    for m in raw.get("schedule", []):
        item = _pick(m, ("matchupPeriodId", "playoffTierType", "winner"))
        item["home"] = _pick(m["home"], side)
        if "away" in m:
            item["away"] = _pick(m["away"], side)
        schedule.append(item)
    out = {
        **_pick(raw, ("id", "seasonId", "scoringPeriodId")),
        "status": _pick(raw.get("status", {}), ("currentMatchupPeriod",)),
        "settings": {
            "name": raw.get("settings", {}).get("name", "Fantasy League"),
            "scheduleSettings": _pick(raw.get("settings", {}).get("scheduleSettings", {}),
                                      ("playoffTeamCount",)),
        },
        "teams": [_pick(t, team_keys) | ({"manager": managers[owner_of(t)]} if managers else {})
                  for t in raw.get("teams", [])],
        "schedule": schedule,
    }
    if keep_members:
        out["members"] = [_pick(m, ("id", "displayName", "firstName", "lastName"))
                          for m in raw.get("members", [])]
    return out


def finished_matchups(raw: dict) -> int:
    """How many matchups ESPN has marked final (used to spot a newly final week)."""
    return sum(1 for m in raw.get("schedule", [])
               if "away" in m and m.get("winner", "UNDECIDED") != "UNDECIDED")
