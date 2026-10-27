"""Build a static standings page into site/ (used by the GitHub Action).

Reads league.json; cookies come from the ESPN_S2 / ESPN_SWID env vars.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

from standings import espn, rules

ROOT = Path(__file__).parent


def default_season(today: dt.date) -> int:
    # The NFL season runs into January/February.
    return today.year if today.month >= 3 else today.year - 1


def main():
    cfg = json.loads((ROOT / "league.json").read_text())
    season = int(cfg.get("season") or default_season(dt.date.today()))
    config = cfg.get("config") or rules.PRESETS[cfg.get("preset", "doubleheader")]
    try:
        league = espn.fetch_league(int(cfg["leagueId"]), season,
                                   os.environ.get("ESPN_S2") or None,
                                   os.environ.get("ESPN_SWID") or None)
    except espn.ESPNError as e:
        sys.exit(f"Error: {e}")

    result = rules.compute(league, config)
    # The published page is public: leave out ESPN usernames.
    for row in result["standings"]:
        row["owners"] = []
    for team in result["league"]["teams"].values():
        team["owners"] = []
    result["generatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()

    out = ROOT / "site"
    out.mkdir(exist_ok=True)
    data = json.dumps(result).replace("</", "<\\/")
    html = (ROOT / "static" / "index.html").read_text()
    html = html.replace("<script>", f"<script>window.STATIC_DATA = {data};</script>\n<script>", 1)
    (out / "index.html").write_text(html)
    (out / "standings.json").write_text(json.dumps(result, indent=2))
    print(f"Built standings for {league.name} through week "
          f"{result['weeks'][-1] if result['weeks'] else 0}.")


if __name__ == "__main__":
    main()
