"""Fetch every season of a league for the League History tab."""

from __future__ import annotations

from . import espn


def manager_ids(raws: list[tuple[int, dict]]) -> dict[str, str]:
    """Opaque, stable-within-a-build ids per ESPN owner, in order of first appearance."""
    ids: dict[str, str] = {}
    for _, raw in raws:
        for team in sorted(raw.get("teams", []), key=lambda t: t["id"]):
            ids.setdefault(espn.owner_of(team), f"m{len(ids) + 1}")
    return ids


def build(league_id: int, current_raw: dict, espn_s2: str | None = None,
          swid: str | None = None) -> dict:
    """All seasons (past ones plus the current one), trimmed, with manager ids.

    `current_raw` is the untrimmed current-season response; it lists the past seasons.
    """
    past = sorted(set(current_raw.get("status", {}).get("previousSeasons", [])))
    raws = [(yr, espn.fetch_raw(league_id, yr, espn_s2, swid)) for yr in past]
    raws.append((current_raw["seasonId"], current_raw))
    ids = manager_ids(raws)
    return {"seasons": [{"season": yr, "data": espn.trim(raw, managers=ids)} for yr, raw in raws]}
