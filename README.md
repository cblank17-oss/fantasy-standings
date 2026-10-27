# ESPN Custom Standings

Doubleheader standings for ESPN fantasy football: 1 pt per H2H win + 1 pt for a top-half score each week.

```bash
python3 app.py   # opens http://127.0.0.1:8000
```

Enter your league ID (from your ESPN league URL) and season. Private league: also paste the `espn_s2` and `SWID` cookies from espn.com (DevTools → Application → Cookies).

Rules are editable in the page. Tests: `python3 -m unittest discover -s tests -t .`
