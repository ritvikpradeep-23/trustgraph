"""Dev-only stand-in for the TrustGraph server. Standard library only.

The real backend (src/trustgraph/web/server.py) isn't in this repo yet, so
this lets you test the extension's "server is up" path.

    python3 extension/scripts/mock_server.py          # only /api/score
    python3 extension/scripts/mock_server.py --all    # also settings/status/report

By default only POST /api/score exists, like the real server today, so the
extension's "not available yet" paths (report, settings, heartbeat) get a 404.
With --all those endpoints answer too, so you can test their success paths.

Scores are canned answers from a few keywords. They are NOT the real engine.
Never ship this; build_zip.py leaves scripts/ out of the package.
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HIGH_WORDS = re.compile(r"gift ?card|otp|verification code|anydesk|teamviewer|bitcoin|arrest|warrant", re.I)
CAUTION_WORDS = re.compile(r"urgent|fee|prize|suspend|password|crypto|won\b", re.I)

ALL_ENDPOINTS = False


def score(text):
    if HIGH_WORDS.search(text):
        band, value = "High", 0.86
        why = "Matches patterns seen in known scam messages."
    elif CAUTION_WORDS.search(text):
        band, value = "Caution", 0.55
        why = "Some wording is common in scams; double-check the sender."
    else:
        band, value = "Low", 0.12
        why = "Nothing unusual found."
    return {
        "band": band,
        "score": value,
        "explanation": "[mock server] " + why,
        "signals": [
            {"name": "continuity", "score": round(value * 0.8, 2), "explanation": "Sender history is short (mock)."},
            {"name": "similarity", "score": value, "explanation": "Similar to reported scams (mock)."},
            {"name": "precedent", "score": 0.0, "explanation": "stub: not built yet"},
            {"name": "anomaly", "score": 0.0, "explanation": "stub: not built yet"},
        ],
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return None

    def do_GET(self):
        if self.path == "/":
            html = b"<!doctype html><title>TrustGraph mock</title><h1>TrustGraph mock server</h1><p>Dashboard placeholder.</p>"
            return self._send(200, html, "text/html; charset=utf-8")
        if self.path == "/api/settings" and ALL_ENDPOINTS:
            return self._send(200, {"minutes_per_check": 3})
        self._send(404, {"detail": "Not Found"})

    def do_POST(self):
        data = self._read_json()
        if data is None:
            return self._send(400, {"detail": "invalid JSON"})
        if self.path == "/api/score":
            text = str(data.get("message_text", ""))
            print(f"  score  channel={data.get('channel')!r} chars={len(text)}")
            return self._send(200, score(text))
        if self.path == "/api/status" and ALL_ENDPOINTS:
            print(f"  heartbeat source={data.get('source')!r}")
            return self._send(200, {"ok": True})
        if self.path == "/api/report" and ALL_ENDPOINTS:
            print(f"  report chars={len(str(data.get('message_text', '')))}")
            return self._send(200, {"ok": True})
        self._send(404, {"detail": "Not Found"})

    def log_message(self, fmt, *args):
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


def main():
    global ALL_ENDPOINTS
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="also serve /api/settings, /api/status, /api/report")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    ALL_ENDPOINTS = args.all
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    extras = "score, settings, status, report" if ALL_ENDPOINTS else "score only"
    print(f"Mock TrustGraph server on http://127.0.0.1:{args.port} ({extras}). Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
