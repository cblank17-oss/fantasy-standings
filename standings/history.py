"""Fetch every season of a league for the League History tab."""

from __future__ import annotations

from . import espn


def _aliases(raws: list[tuple[int, dict]], same_manager: list[dict]) -> dict[str, str]:
    """ESPN owner id -> the owner id it should count as.

    `same_manager` comes from league.json: groups of "season:team" slots that
    belong to one person (e.g. someone who switched ESPN accounts).
    """
    owner = {(yr, t["id"]): espn.owner_of(t) for yr, raw in raws for t in raw.get("teams", [])}
    alias = {}
    for group in same_manager:
        slots = []
        for slot in group.get("teams", []):
            yr, _, team = str(slot).partition(":")
            key = (int(yr), int(team)) if yr.isdigit() and team.isdigit() else None
            if key not in owner:
                raise ValueError(f'sameManager: no team "{slot}" (use "season:teamId", e.g. "2026:9")')
            slots.append(owner[key])
        for o in slots[1:]:
            alias[o] = slots[0]
    return alias


def manager_ids(raws: list[tuple[int, dict]], same_manager: list[dict] = ()) -> dict[str, str]:
    """Opaque, stable-within-a-build ids per person, in order of first appearance."""
    alias = _aliases(raws, list(same_manager))
    ids: dict[str, str] = {}
    for _, raw in raws:
        for team in sorted(raw.get("teams", []), key=lambda t: t["id"]):
            o = espn.owner_of(team)
            ids.setdefault(alias.get(o, o), f"m{len(ids) + 1}")
    for o, canonical in alias.items():
        ids[o] = ids[canonical]
    return ids


def build(league_id: int, current_raw: dict, espn_s2: str | None = None,
          swid: str | None = None, same_manager: list[dict] = ()) -> dict:
    """All seasons (past ones plus the current one), trimmed, with manager ids.

    `current_raw` is the untrimmed current-season response; it lists the past seasons.
    """
    past = sorted(set(current_raw.get("status", {}).get("previousSeasons", [])))
    raws = [(yr, espn.fetch_raw(league_id, yr, espn_s2, swid)) for yr in past]
    raws.append((current_raw["seasonId"], current_raw))
    ids = manager_ids(raws, same_manager)
    return {"seasons": [{"season": yr, "data": espn.trim(raw, managers=ids)} for yr, raw in raws]}
