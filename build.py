"""Build a static standings page into site/ (used by the GitHub Action).

Reads league.json; cookies come from the ESPN_S2 / ESPN_SWID env vars.

    python build.py                      full rebuild
    python build.py --projections-only URL
        keep the standings at URL (the published standings.json) and only
        refresh this week's projections. Falls back to a full rebuild if the
        published standings are missing or a new week has gone final.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

from standings import espn, rules

ROOT = Path(__file__).parent


def default_season(today: dt.date) -> int:
    # The NFL season runs into January/February.
    return today.year if today.month >= 3 else today.year - 1


def fetch_published(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}?t={dt.datetime.now().timestamp():.0f}", timeout=20) as r:
            return json.load(r)
    except Exception as e:  # first deploy, Pages hiccup, etc.
        print(f"Could not load published standings ({e}); doing a full rebuild.")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projections-only", metavar="STANDINGS_JSON_URL")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "league.json").read_text())
    season = int(cfg.get("season") or default_season(dt.date.today()))
    config = cfg.get("config") or rules.PRESETS[cfg.get("preset", "doubleheader")]
    try:
        league = espn.fetch_league(int(cfg["leagueId"]), season,
                                   os.environ.get("ESPN_S2") or None,
                                   os.environ.get("ESPN_SWID") or None)
    except espn.ESPNError as e:
        sys.exit(f"Error: {e}")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    base = fetch_published(args.projections_only) if args.projections_only else None
    if base and base.get("weeks") == sorted(league.weeks):
        result = base
        result["projection"] = league.projection
        mode = "projections"
    else:
        if base:
            print("A new week has gone final; doing a full rebuild.")
        result = rules.compute(league, config)
        # The published page is public: leave out ESPN usernames.
        for row in result["standings"]:
            row["owners"] = []
        for team in result["league"]["teams"].values():
            team["owners"] = []
        result["generatedAt"] = now
        mode = "full"
    if result["projection"]:
        result["projection"]["asOf"] = now

    out = ROOT / "site"
    out.mkdir(exist_ok=True)
    data = json.dumps(result).replace("</", "<\\/")
    html = (ROOT / "static" / "index.html").read_text()
    html = html.replace("<script>", f"<script>window.STATIC_DATA = {data};</script>\n<script>", 1)
    (out / "index.html").write_text(html)
    (out / "standings.json").write_text(json.dumps(result, indent=2))
    print(f"Built ({mode}) standings for {league.name} through week "
          f"{result['weeks'][-1] if result['weeks'] else 0}.")


if __name__ == "__main__":
    main()
