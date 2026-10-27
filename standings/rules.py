"""Configurable standings engine.

A config is a list of rules, each awarding points per team per week, plus
tiebreakers. Example (the "doubleheader" format):

    {
      "rules": [
        {"id": "h2h", "type": "h2h", "label": "H2H", "win": 1, "tie": 0.5},
        {"id": "top", "type": "weekly_rank", "label": "Top half",
         "side": "top", "count": "half", "points": 1, "tieMode": "all"}
      ],
      "tiebreakers": ["points_for", "h2h_wins"]
    }

Rule types:
  h2h          win / tie / loss / bye points for the head-to-head matchup.
  weekly_rank  `points` to the top (or bottom) `count` scorers of the week.
               `count` is an integer or "half". `tieMode` decides what happens
               when teams are tied exactly at the cutoff: "all" (each gets full
               points), "split" (remaining points shared), or "none".
  all_play     `perWin` points for every team you outscored that week
               (`perTie` for exact ties).
"""

from __future__ import annotations

from .espn import League

PRESETS = {
    "doubleheader": {
        "name": "Doubleheader (H2H + top half)",
        "rules": [
            {"id": "h2h", "type": "h2h", "label": "H2H win",
             "win": 1, "tie": 0.5, "loss": 0, "bye": 0},
            {"id": "tophalf", "type": "weekly_rank", "label": "Top half",
             "side": "top", "count": "half", "points": 1, "tieMode": "all"},
        ],
        "tiebreakers": ["points_for", "h2h_wins"],
    },
    "standard": {
        "name": "Standard H2H",
        "rules": [
            {"id": "h2h", "type": "h2h", "label": "H2H win",
             "win": 1, "tie": 0.5, "loss": 0, "bye": 0},
        ],
        "tiebreakers": ["points_for"],
    },
    "allplay": {
        "name": "All-play",
        "rules": [
            {"id": "allplay", "type": "all_play", "label": "All-play",
             "perWin": 1, "perTie": 0.5},
        ],
        "tiebreakers": ["points_for"],
    },
}

TIEBREAKERS = {
    "points_for": "Points for",
    "h2h_wins": "H2H wins",
    "all_play_wins": "All-play wins",
    "points_against": "Points against (fewer is better)",
}


class ConfigError(ValueError):
    pass


def _resolve_count(count, n: int) -> int:
    if count == "half":
        return n // 2
    try:
        return max(0, min(int(count), n))
    except (TypeError, ValueError):
        raise ConfigError(f"Invalid count: {count!r}")


def _weekly_rank(scores: dict[int, float], rule: dict) -> dict[int, float]:
    points = float(rule.get("points", 1))
    k = _resolve_count(rule.get("count", "half"), len(scores))
    if k == 0:
        return {}
    reverse = rule.get("side", "top") != "bottom"
    ordered = sorted(scores.values(), reverse=reverse)
    cutoff = ordered[k - 1]
    clear = [t for t, s in scores.items() if (s > cutoff if reverse else s < cutoff)]
    at = [t for t, s in scores.items() if s == cutoff]
    out = {t: points for t in clear}
    slots = k - len(clear)
    if len(at) <= slots:
        out.update({t: points for t in at})
    else:
        mode = rule.get("tieMode", "all")
        if mode == "all":
            out.update({t: points for t in at})
        elif mode == "split":
            out.update({t: points * slots / len(at) for t in at})
        elif mode != "none":
            raise ConfigError(f"Unknown tieMode: {mode!r}")
    return out


def _all_play_record(scores: dict[int, float]) -> dict[int, tuple[int, int, int]]:
    rec = {}
    for t, s in scores.items():
        others = [o for u, o in scores.items() if u != t]
        rec[t] = (sum(s > o for o in others), sum(s < o for o in others),
                  sum(s == o for o in others))
    return rec


def validate(config: dict) -> None:
    rules = config.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ConfigError("Config needs at least one rule.")
    seen = set()
    for r in rules:
        if r.get("type") not in ("h2h", "weekly_rank", "all_play"):
            raise ConfigError(f"Unknown rule type: {r.get('type')!r}")
        if not r.get("id") or r["id"] in seen:
            raise ConfigError("Each rule needs a unique id.")
        seen.add(r["id"])
    for tb in config.get("tiebreakers", []):
        if tb not in TIEBREAKERS:
            raise ConfigError(f"Unknown tiebreaker: {tb!r}")


def compute(league: League, config: dict, start_week: int | None = None,
            end_week: int | None = None) -> dict:
    validate(config)
    rules = config["rules"]
    weeks = [w for w in sorted(league.weeks)
             if (start_week is None or w >= start_week)
             and (end_week is None or w <= end_week)]

    rows = {
        tid: {
            "teamId": tid, "name": t.name, "abbrev": t.abbrev, "owners": t.owners,
            "total": 0.0, "byRule": {r["id"]: 0.0 for r in rules},
            "wins": 0, "losses": 0, "ties": 0,
            "apWins": 0, "apLosses": 0, "apTies": 0,
            "pf": 0.0, "pa": 0.0, "shotguns": 0, "weekly": {},
        }
        for tid, t in league.teams.items()
    }
    history: dict[int, list[int]] = {tid: [] for tid in rows}

    for w in weeks:
        games = league.weeks[w]
        scores = {g.team_id: g.points for g in games}
        ranks = {t: 1 + sum(o > s for o in scores.values()) for t, s in scores.items()}
        ap = _all_play_record(scores)
        low = min(scores.values())

        earned: dict[int, dict[str, float]] = {t: {} for t in scores}
        for r in rules:
            if r["type"] == "h2h":
                key = {"W": "win", "L": "loss", "T": "tie", "BYE": "bye"}
                defaults = {"win": 1, "loss": 0, "tie": 0.5, "bye": 0}
                for g in games:
                    k = key[g.result]
                    earned[g.team_id][r["id"]] = float(r.get(k, defaults[k]))
            elif r["type"] == "weekly_rank":
                got = _weekly_rank(scores, r)
                for t in scores:
                    earned[t][r["id"]] = got.get(t, 0.0)
            elif r["type"] == "all_play":
                pw, pt = float(r.get("perWin", 1)), float(r.get("perTie", 0.5))
                for t, (wn, _, tie) in ap.items():
                    earned[t][r["id"]] = wn * pw + tie * pt

        for g in games:
            row = rows.get(g.team_id)
            if row is None:
                continue
            e = earned[g.team_id]
            week_total = sum(e.values())
            row["total"] += week_total
            for rid, p in e.items():
                row["byRule"][rid] += p
            row["wins"] += g.result == "W"
            row["losses"] += g.result == "L"
            row["ties"] += g.result == "T"
            a = ap[g.team_id]
            row["apWins"] += a[0]
            row["apLosses"] += a[1]
            row["apTies"] += a[2]
            row["pf"] += g.points
            row["shotguns"] += g.points == low  # last in scoring (ties all count)
            row["pa"] += g.opp_points or 0.0
            row["weekly"][w] = {
                "points": g.points, "oppId": g.opp_id, "oppPoints": g.opp_points,
                "result": g.result, "rank": ranks[g.team_id],
                "earned": e, "total": week_total,
            }

        for tid, rank in _rank(list(rows.values()), config).items():
            history[tid].append(rank)

    ranked = _rank(list(rows.values()), config)
    standings = sorted(rows.values(), key=lambda r: (ranked[r["teamId"]], r["name"]))
    for r in standings:
        r["rank"] = ranked[r["teamId"]]
        r["rankHistory"] = history[r["teamId"]]
        r["total"] = round(r["total"], 4)
        r["pf"] = round(r["pf"], 2)
        r["pa"] = round(r["pa"], 2)

    return {
        "league": league.to_dict(),
        "weeks": weeks,
        "rules": [{"id": r["id"], "label": r.get("label", r["id"])} for r in rules],
        "tiebreakers": config.get("tiebreakers", []),
        "standings": standings,
    }


def _sort_key(row: dict, tiebreakers: list[str]) -> tuple:
    key = [-round(row["total"], 6)]
    for tb in tiebreakers:
        if tb == "points_for":
            key.append(-round(row["pf"], 6))
        elif tb == "h2h_wins":
            key.append(-(row["wins"] + row["ties"] / 2))
        elif tb == "all_play_wins":
            key.append(-(row["apWins"] + row["apTies"] / 2))
        elif tb == "points_against":
            key.append(round(row["pa"], 6))
    return tuple(key)


def _rank(rows: list[dict], config: dict) -> dict[int, int]:
    """Competition ranking (1, 2, 2, 4) after tiebreakers."""
    tbs = config.get("tiebreakers", [])
    keyed = sorted(rows, key=lambda r: _sort_key(r, tbs))
    out, prev, prev_rank = {}, None, 0
    for i, r in enumerate(keyed, 1):
        k = _sort_key(r, tbs)
        rank = prev_rank if k == prev else i
        out[r["teamId"]] = rank
        prev, prev_rank = k, rank
    return out
