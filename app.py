"""Local web app: python3 app.py [--port 8000]"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from standings import espn, rules

STATIC = Path(__file__).parent / "static"
CACHE_TTL = 300
_cache: dict[str, tuple[float, dict]] = {}


def get_raw(league_id: int, season: int, s2: str | None, swid: str | None,
            fresh: bool = False) -> dict:
    key = hashlib.sha256(f"{league_id}|{season}|{s2}|{swid}".encode()).hexdigest()
    hit = _cache.get(key)
    if hit and not fresh and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    data = espn.fetch_raw(league_id, season, s2, swid)
    _cache[key] = (time.time(), data)
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/presets":
            self._json(200, {"presets": rules.PRESETS, "tiebreakers": rules.TIEBREAKERS})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/standings":
            return self._json(404, {"error": "Not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            league_id = int(body["leagueId"])
            season = int(body["season"])
            config = body.get("config") or rules.PRESETS["doubleheader"]
            raw = get_raw(league_id, season, body.get("espnS2") or None,
                          body.get("swid") or None, bool(body.get("fresh")))
            league = espn.parse_league(raw, bool(body.get("includePlayoffs")))
            result = rules.compute(league, config,
                                   _opt_int(body.get("startWeek")),
                                   _opt_int(body.get("endWeek")))
            self._json(200, result)
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            self._json(400, {"error": str(e) or "Bad request"})
        except espn.ESPNError as e:
            self._json(502, {"error": str(e)})


def _opt_int(v):
    return int(v) if v not in (None, "") else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Custom standings running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
