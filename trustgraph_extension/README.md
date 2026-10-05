# TrustGraph Chrome extension

Checks messages you choose for scam signals. On a supported chat site, click
the round TrustGraph button to scan the open conversation: a side panel
docks on the right (narrowing the page instead of covering it) with the
verdict, each red flag and "Jump to message". Or hover one message and click
the shield, or select text anywhere and right-click **Check with
TrustGraph**. It flags and warns; it never hides, deletes, or blocks
anything.

Manifest V3, plain JavaScript, no build step.

## Load it in Chrome (Load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `trustgraph_extension/` folder.
3. After changing any file, click the reload arrow on the TrustGraph card.
   Content scripts only update after you also reload the web page.

## The scoring backend

The full analysis comes from the TrustGraph Python server (default
`http://127.0.0.1:8000`, changeable in Settings). If it isn't running, the
extension falls back to an on-device **Basic check** (red-flag rules in
`shared/basic-check.js`) and labels the result as such.

No backend in this repo yet? Use the dev mock (standard library only):

```bash
python3 trustgraph_extension/scripts/mock_server.py          # only /api/score, like the real server today
python3 trustgraph_extension/scripts/mock_server.py --all    # also /api/settings, /api/status, /api/report
```

## Where to look when something breaks

| What | Where |
| --- | --- |
| Background / backend calls | `chrome://extensions` → TrustGraph → **service worker** link → Console |
| Shield button, adapters, verdict card | The web page's DevTools Console (messages start with `[TrustGraph]`) |
| Load errors | `chrome://extensions` → TrustGraph → **Errors** button |

## Tests

```bash
node trustgraph_extension/test/basic-check.test.js           # offline Basic check rules
cd trustgraph_extension && python3 -m http.server 5500       # serve the extension folder, then open:
#   http://localhost:5500/test/test-chat.html      fake chat: hover a bubble, click the shield
#   http://localhost:5500/test/adapter-tests.html  every adapter vs. its saved HTML sample
#   http://localhost:5500/test/reader-tests.html   WhatsApp reader: parsing, every message
#                                                  type, virtualised scrolling, chat switch
```

**Checking message reading on the live site:** open a WhatsApp chat, click
the TrustGraph toolbar icon, and read the grey line under "Recognizing N
messages": `Rows 36 · message containers 16 · parsed 16`. *parsed* should
equal *message containers*; anything skipped is listed with the reason.
With Debug mode on, the same counts are logged to the page console (never
message text).

**Debug mode** (Settings → Debug) outlines every element the current site's
adapter recognizes as a message and logs which selector strategy matched.
Use it to calibrate an adapter after a site changes its HTML.

## Site adapters: status and calibration

| Site | Adapter | Status |
| --- | --- | --- |
| WhatsApp Web | `adapters/whatsapp/adapter.js` + `reader.js` | Rebuilt from live-site observations (Oct 2026); confirm with the popup counts |
| Gmail | `adapters/gmail.js` | Hint-based, **not verified** (experimental) |
| Facebook Messenger (facebook.com/messages) | `adapters/messenger.js` + `meta-chat.js` | Hint-based, **not verified** (experimental) |
| Instagram DMs | `adapters/instagram.js` + `meta-chat.js` | Hint-based, **not verified** (experimental) |
| Any other site | right-click menu | Works anywhere text can be selected |

The `*.synthetic.html` fixtures are hand-written from selector hints. They prove
the adapter code works on that structure, **not** that the live site still
looks like that. To calibrate a site:

1. Open a **test chat** (the HTML contains message text).
2. Right-click a message → **Inspect**. In DevTools, right-click the element
   for the whole message row → **Copy → Copy outerHTML**. A couple of
   neighbouring messages (copy their shared parent) is even better.
3. Save it as `test/fixtures/<site>.html` and add an entry to
   `test/fixtures/expected.json` with `"origin": "real"` and the text you
   expect `extractText()` to return.
4. Run `test/adapter-tests.html`. If a check fails, adjust that adapter's
   `strategies` (attribute-based selectors first) until it passes, then
   confirm on the live site with Debug mode on.

## QA checklist (before a demo or a store upload)

Run in a **fresh Chrome profile** (chrome://settings/manageProfile → Add) so
nothing is left over from development.

| # | Test | Expect | Where to look |
| --- | --- | --- | --- |
| 1 | Load unpacked (or unzip `dist/…zip` and load that) | No **Errors** button; onboarding opens | chrome://extensions |
| 2 | Onboarding → **Check this message** | "likely scam" card, "Basic check (offline)" label | page |
| 3 | Select text on any site → right-click **Check with TrustGraph** | Card next to the selection | page; service-worker console |
| 4 | Same, with `mock_server.py` running | "[mock server]" explanation, no offline label | mock server terminal |
| 5 | `mock_server.py --fail`, check again | "server returned an error … (HTTP 500)" label; popup says **Basic check mode** | page; popup |
| 6 | Service worker asleep: chrome://serviceworker-internals → TrustGraph → **Stop**, then check again | Still works (worker restarts) | service-worker console |
| 7 | Each live site with a test chat: hover → shield → click | Card anchored to the message; popup says "Recognizing N messages" | page console (`[TrustGraph]` lines) |
| 8 | Popup → Pause | Shield disappears; right-click still works | page |
| 9 | Keyboard only: Tab to the card buttons, Enter on **Why?**, Esc | Visible focus rings; Esc closes and focus returns | page |
| 10 | OS dark mode and "reduce motion" on | Card, popup, and pages readable; no animation | all |
| 11 | Settings → Clear local data | Counts back to 0, settings back to defaults | popup |

Automated checks: `node trustgraph_extension/test/basic-check.test.js` and
`test/adapter-tests.html` (see Tests above).

## Build the Web Store package

```bash
pip install pillow                       # only needed to redraw icons
python3 trustgraph_extension/scripts/make_icons.py  # icons/*.png + store/assets/promo-440x280.png
python3 trustgraph_extension/scripts/build_zip.py   # -> dist/trustgraph-0.1.0.zip
```

`build_zip.py` strips the dev-only test-page entry and leaves out `test/`,
`store/`, `scripts/`, and `adapters/stub.js`. It stops if the manifest
references a missing file or any script uses `eval`. Store copy, privacy policy,
permission justifications, and data disclosures are in `store/`.

## Layout

```
background.js        service worker: the only code that calls the backend
content/             core.js (shield, hover, heartbeat) and popup.js (verdict card)
adapters/            one file per site + kit.js (shared helpers, adapter contract)
shared/              constants, Basic check, design tokens
ui/                  toolbar popup, options, onboarding, privacy pages
icons/               extension icons
test/                test chat page, fixtures, tests (not shipped)
store/               Web Store listing, privacy policy, justifications (not shipped)
scripts/             mock server, icon + zip builders (not shipped)
```
