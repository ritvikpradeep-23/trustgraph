# TrustGraph Chrome extension

Checks a single message, chosen by you, for scam signals. Hover a message on
a supported site and click the shield, or select text anywhere and
right-click **Check with TrustGraph**. It flags and warns; it never hides,
deletes, or blocks anything.

Manifest V3, plain JavaScript, no build step.

## Load it in Chrome (Load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `extension/` folder.
3. After changing any file, click the reload arrow on the TrustGraph card.
   Content scripts only update after you also reload the web page.

## The scoring backend

The full analysis comes from the TrustGraph Python server (default
`http://127.0.0.1:8000`, changeable in Settings). If it isn't running, the
extension falls back to an on-device **Basic check** (red-flag rules in
`shared/basic-check.js`) and labels the result as such.

No backend in this repo yet? Use the dev mock (standard library only):

```bash
python3 extension/scripts/mock_server.py          # only /api/score, like the real server today
python3 extension/scripts/mock_server.py --all    # also /api/settings, /api/status, /api/report
```

## Where to look when something breaks

| What | Where |
| --- | --- |
| Background / backend calls | `chrome://extensions` → TrustGraph → **service worker** link → Console |
| Shield button, adapters, verdict card | The web page's DevTools Console (messages start with `[TrustGraph]`) |
| Load errors | `chrome://extensions` → TrustGraph → **Errors** button |

## Tests

```bash
node extension/test/basic-check.test.js           # offline Basic check rules
cd extension/test && python3 -m http.server 5500  # then open http://localhost:5500/test-chat.html
```

## Layout

```
background.js        service worker: the only code that calls the backend
shared/              constants, Basic check, design tokens
test/                test chat page, fixtures, tests (not shipped)
scripts/             mock server, icon + zip builders (not shipped)
```
