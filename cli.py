"""Print custom standings in the terminal.

    python3 cli.py --league 123456 --season 2026 [--s2 ... --swid ...]
                   [--preset doubleheader | --config my_rules.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from standings import espn, rules


def fmt(n: float) -> str:
    return f"{n:g}"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", type=int, required=True)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--s2", default=os.environ.get("ESPN_S2"))
    ap.add_argument("--swid", default=os.environ.get("ESPN_SWID"))
    ap.add_argument("--preset", default="doubleheader", choices=rules.PRESETS)
    ap.add_argument("--config", help="Path to a JSON rules config")
    ap.add_argument("--start-week", type=int)
    ap.add_argument("--end-week", type=int)
    ap.add_argument("--playoffs", action="store_true", help="Include playoff weeks")
    ap.add_argument("--json", action="store_true", help="Output raw JSON")
    a = ap.parse_args()

    config = json.load(open(a.config)) if a.config else rules.PRESETS[a.preset]
    try:
        league = espn.fetch_league(a.league, a.season, a.s2, a.swid, a.playoffs)
    except espn.ESPNError as e:
        sys.exit(f"Error: {e}")
    res = rules.compute(league, config, a.start_week, a.end_week)

    if a.json:
        print(json.dumps(res, indent=2))
        return

    weeks = res["weeks"]
    span = f"weeks {weeks[0]}-{weeks[-1]}" if weeks else "no completed weeks"
    print(f"\n{league.name} ({league.season}), {span}\n")
    rule_cols = res["rules"]
    width = max((len(r["name"]) for r in res["standings"]), default=4)
    header = f"{'#':>3}  {'Team':<{width}}  {'Pts':>5}  " + "  ".join(
        f"{r['label']:>9}" for r in rule_cols) + f"  {'Shotguns':>8}  {'Record':>8}  {'PF':>8}"
    print(header)
    print("-" * len(header))
    for r in res["standings"]:
        rec = f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r["ties"] else "")
        print(f"{r['rank']:>3}  {r['name']:<{width}}  {fmt(r['total']):>5}  "
              + "  ".join(f"{fmt(r['byRule'][c['id']]):>9}" for c in rule_cols)
              + f"  {r['shotguns']:>8}  {rec:>8}  {r['pf']:>8.2f}")


if __name__ == "__main__":
    main()
