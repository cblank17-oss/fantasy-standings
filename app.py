"""Local web app: python3 app.py [--port 8000]

Serves static/ and proxies ESPN (browsers can't send your ESPN cookies
themselves). Standings are computed in the browser by static/js/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from standings import espn, history

STATIC = (Path(__file__).parent / "static").resolve()
LEAGUE_JSON = Path(__file__).parent / "league.json"
CACHE_TTL = 300
_cache: dict[str, tuple[float, dict]] = {}


def _cached(key: str, fresh: bool, make) -> dict:
    key = hashlib.sha256(key.encode()).hexdigest()
    hit = _cache.get(key)
    if hit and not fresh and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    data = make()
    _cache[key] = (time.time(), data)
    return data


def get_league(league_id: int, season: int, s2: str | None, swid: str | None,
               fresh: bool = False) -> dict:
    return _cached(f"league|{league_id}|{season}|{s2}|{swid}", fresh, lambda:
                   espn.trim(espn.fetch_raw(league_id, season, s2, swid), keep_members=True))


def league_cfg(league_id: int) -> dict:
    """league.json's settings, when the app is showing that league."""
    try:
        cfg = json.loads(LEAGUE_JSON.read_text())
    except (OSError, ValueError):
        return {}
    return cfg if cfg.get("leagueId") == league_id else {}


def get_history(league_id: int, season: int, s2: str | None, swid: str | None) -> dict:
    cfg = league_cfg(league_id)
    return _cached(f"history|{league_id}|{season}|{s2}|{swid}", False, lambda: {
        **history.build(league_id, espn.fetch_raw(league_id, season, s2, swid), s2, swid,
                        cfg.get("sameManager", [])),
        "shotgunsSince": cfg.get("shotgunsSince"),
    })


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        path = (STATIC / rel).resolve()
        if not path.is_relative_to(STATIC) or not path.is_file():
            return self._json(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, path.read_bytes(), ctype)

    def do_POST(self):
        if self.path not in ("/api/league", "/api/history"):
            return self._json(404, {"error": "Not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            args = (int(body["leagueId"]), int(body["season"]),
                    body.get("espnS2") or None, body.get("swid") or None)
            if self.path == "/api/history":
                self._json(200, get_history(*args))
            else:
                self._json(200, get_league(*args, bool(body.get("fresh"))))
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            self._json(400, {"error": str(e) or "Bad request"})
        except espn.ESPNError as e:
            self._json(502, {"error": str(e)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    mimetypes.add_type("text/javascript", ".js")
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
