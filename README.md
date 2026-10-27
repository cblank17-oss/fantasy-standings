# ESPN Custom Standings

Doubleheader standings for ESPN fantasy football: 1 pt per H2H win + 1 pt for a top-half score each week, plus shotguns (last-place weeks), projected standings for the week in progress, and a League History tab covering every season since 2017.

**Live page:** https://cblank17-oss.github.io/fantasy-standings/

## How it works

- `standings/espn.py` fetches league data from ESPN and trims it to the fields the page needs.
- `build.py` (run by GitHub Actions) writes that data next to a copy of `static/`: `site/data.json` (this season) and `site/history.json` (every season; managers are tracked by an anonymous id, never their ESPN account).
- The page parses and scores the data in the browser. The scoring engine exists once, in `static/js/`:
  - `espn.js` parses ESPN data into weeks and this week's projection
  - `scoring.js` holds the rules, presets and tiebreakers. Projected standings use the same `compute()` with the projected week added.
  - `history.js` rolls every season up per manager (titles, finishes, lifetime points and shotguns, records); `history-view.js` draws the League History tab.
  - `render.js` draws the standings tables, `editor.js` is the rule editor (local app only), `main.js` wires up the tabs.

## Schedule

`.github/workflows/standings.yml`: standings rebuild Tuesday mornings ET (after MNF goes final); projections refresh every 15 min on Sundays 1 PM–midnight ET. Needs repo secrets `ESPN_S2` and `ESPN_SWID`, and Settings → Pages → Source set to "GitHub Actions". The league ID is in `league.json`.

## Local app

```bash
python3 app.py   # opens http://127.0.0.1:8000 with a rule editor
```

Enter the league ID and season. Private league: also paste the `espn_s2` and `SWID` cookies from espn.com (DevTools → Application → Cookies).

## Tests

```bash
npm test        # or: node --test tests/scoring.test.js tests/history.test.js
python3 -m unittest discover -s tests -t .
```
