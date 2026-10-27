"""Build the published site into site/ (used by the GitHub Action).

Copies static/ and writes trimmed ESPN data next to it: site/data.json (this
season) and site/history.json (every season, for the League History tab). The
page computes everything from these in the browser. Reads league.json; cookies
come from the ESPN_S2 / ESPN_SWID env vars.

    python build.py                      full rebuild
    python build.py --projections-only SITE_URL
        keep the standings and history published at SITE_URL and only refresh
        this week's projections. Falls back to a full rebuild if the published
        files are missing or a new week has gone final.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

from standings import espn, history

ROOT = Path(__file__).parent


def default_season(today: dt.date) -> int:
    # The NFL season runs into January/February.
    return today.year if today.month >= 3 else today.year - 1


def fetch_published(site_url: str, name: str) -> dict | None:
    url = f"{site_url.rstrip('/')}/{name}?t={dt.datetime.now().timestamp():.0f}"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r)
    except Exception as e:  # first deploy, Pages hiccup, etc.
        print(f"Could not load published {name} ({e}); doing a full rebuild.")
        return None


def stamp_assets(site: Path) -> str:
    """Add ?v=<content hash> to every CSS/JS reference, including imports between
    modules, so browsers never mix files from different deploys."""
    files = sorted(p for p in site.rglob("*") if p.suffix in (".html", ".css", ".js"))
    version = hashlib.sha256(b"".join(p.read_bytes() for p in files)).hexdigest()[:10]
    ref = re.compile(r'((?:src|href)="|from ")((?:\./)?[\w./-]+\.(?:js|css))"')
    for p in files:
        if p.suffix != ".css":
            p.write_text(ref.sub(rf'\1\2?v={version}"', p.read_text()))
    return version


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projections-only", metavar="SITE_URL")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "league.json").read_text())
    season = int(cfg.get("season") or default_season(dt.date.today()))
    league_id = int(cfg["leagueId"])
    cookies = (os.environ.get("ESPN_S2") or None, os.environ.get("ESPN_SWID") or None)
    try:
        raw = espn.fetch_raw(league_id, season, *cookies)
    except espn.ESPNError as e:
        sys.exit(f"Error: {e}")
    live = espn.trim(raw)

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    base = hist = None
    if args.projections_only:
        base = fetch_published(args.projections_only, "data.json")
        hist = base and fetch_published(args.projections_only, "history.json")
    if base and hist and "standings" in base and \
            espn.finished_matchups(base["standings"]) == espn.finished_matchups(live):
        data = {**base, "live": live, "liveAt": now}
        mode = "projections"
    else:
        if base and hist:
            print("A new week has gone final; doing a full rebuild.")
        data = {"standings": live, "live": live, "generatedAt": now, "liveAt": now}
        try:
            hist = {**history.build(league_id, raw, *cookies, cfg.get("sameManager", [])),
                    "generatedAt": now}
        except espn.ESPNError as e:
            sys.exit(f"Error fetching past seasons: {e}")
        except ValueError as e:
            sys.exit(f"Error in league.json: {e}")
        mode = "full"
    data["preset"] = cfg.get("preset", "doubleheader")
    data["config"] = cfg.get("config")

    out = ROOT / "site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "static", out)
    stamp_assets(out)
    (out / "data.json").write_text(json.dumps(data))
    (out / "history.json").write_text(json.dumps(hist))
    print(f"Built ({mode}) site for {live['settings']['name']}, "
          f"{len(hist['seasons'])} seasons of history.")


if __name__ == "__main__":
    main()
