"""Build the published site into site/ (used by the GitHub Action).

Copies static/ and writes site/data.json with trimmed ESPN data; the page
computes the standings from it in the browser. Reads league.json; cookies come
from the ESPN_S2 / ESPN_SWID env vars.

    python build.py                      full rebuild
    python build.py --projections-only URL
        keep the standings data at URL (the published data.json) and only
        refresh this week's projections. Falls back to a full rebuild if the
        published data is missing or a new week has gone final.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

from standings import espn

ROOT = Path(__file__).parent


def default_season(today: dt.date) -> int:
    # The NFL season runs into January/February.
    return today.year if today.month >= 3 else today.year - 1


def fetch_published(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}?t={dt.datetime.now().timestamp():.0f}", timeout=20) as r:
            return json.load(r)
    except Exception as e:  # first deploy, Pages hiccup, etc.
        print(f"Could not load published data ({e}); doing a full rebuild.")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projections-only", metavar="DATA_JSON_URL")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "league.json").read_text())
    season = int(cfg.get("season") or default_season(dt.date.today()))
    try:
        live = espn.trim(espn.fetch_raw(int(cfg["leagueId"]), season,
                                        os.environ.get("ESPN_S2") or None,
                                        os.environ.get("ESPN_SWID") or None))
    except espn.ESPNError as e:
        sys.exit(f"Error: {e}")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    base = fetch_published(args.projections_only) if args.projections_only else None
    if base and "standings" in base and \
            espn.finished_matchups(base["standings"]) == espn.finished_matchups(live):
        data = {**base, "live": live, "liveAt": now}
        mode = "projections"
    else:
        if base:
            print("A new week has gone final; doing a full rebuild.")
        data = {"standings": live, "live": live, "generatedAt": now, "liveAt": now}
        mode = "full"
    data["preset"] = cfg.get("preset", "doubleheader")
    data["config"] = cfg.get("config")

    out = ROOT / "site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "static", out)
    (out / "data.json").write_text(json.dumps(data))
    print(f"Built ({mode}) site for {live['settings']['name']}.")


if __name__ == "__main__":
    main()
