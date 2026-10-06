# TrustGraph Chrome extension

Checks the messages you choose for scam signals, right where they are.
**Only the verdict comes home. The message stays where it was detected.**

Hover a message on a supported site and click the shield, click the round
TrustGraph button to scan the open chat, or select text anywhere and
right-click **Check with TrustGraph**. A side panel docks on the right
(narrowing the page instead of covering it) with the verdict, a 0-100 score,
the signals and the words that matched. It flags and warns; it never hides,
deletes or blocks anything.

Manifest V3, plain JavaScript, **no build step**. Styles and components come
from one design system (`shared/design.js`, `shared/ui.js`) matched to the
TrustGraph web app: dark tokens, Space Grotesk / DM Sans / JetBrains Mono
(bundled, never fetched), Lucide icons.

## Load it in Chrome (Load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `trustgraph_extension/` folder.
3. After changing any file, click the reload arrow on the TrustGraph card.
   Content scripts only update after you also reload the web page.

The welcome page opens on first install (`ui/options.html#welcome`). To look
around without real checks: toolbar icon → **Use without account** →
Settings → History → **Demo data**.

## Surfaces

| Surface | Files |
| --- | --- |
| Shield, side panel, launcher (in-page, closed shadow roots) | `content/core.js`, `content/panel.js`, `content/chat-store.js` |
| Toolbar popup (400px): signed-out pitch, Overview, History, Settings | `ui/popup.*`, `ui/settings-form.js` |
| Welcome tour + full settings (split layout) | `ui/options.*` |
| Privacy policy | `ui/privacy.*` (keep in sync with `store/privacy-policy.md`) |
| Demo web app (used while no web app URL is set) | `ui/webapp.*` |
| Component gallery, every component in Low / Caution / High, both themes | `dev/gallery.html` (not shipped) |

## Architecture

```
content script ──typed messages (TG.MSG)──▶ background.js (service worker)
  shield / panel                              ├─ engine: LocalEngine | RemoteEngine   shared/verdict.js
  text in memory only                         ├─ history: Result records only         shared/result.js
                                              ├─ counts per verdict and site
popup / options ──typed messages──────────▶   └─ ApiClient: web app | mock           shared/api-client.js
```

- **Verdict** (`shared/verdict.js`): `scoreMessage(input) -> Verdict
  {id, riskLevel: "low"|"caution"|"high", score 0-100, explanation, signals,
  continuity, similarity}`. Every rule maps to one of eight signal types:
  urgency pressure; request for money, gift cards or crypto; credential or
  OTP request; suspicious link or lookalike domain; sender mismatch;
  impersonation of a contact or brand; unusual continuity break; similarity
  to known scam patterns. Thresholds: Caution from 35, High from 70
  (Balanced); Relaxed 45 / 80, Strict 25 / 60.
- **Result** (`shared/result.js`): the only thing stored or synced: `id,
  timestamp, riskLevel, score, signalIds, channel, domain, hash?`. No text
  field; `validate()` rejects anything else, and `test/result.test.js` fails
  if a field is added.
- **ApiClient** (`shared/api-client.js`): `POST /api/results`, `GET
  /api/results`, `DELETE /api/results/:id`, `GET /api/export`, `POST
  /api/feedback` (Mark as wrong verdict: the verdict id only), `POST
  /api/extension/pair`. With no web app URL in Settings it uses a mock in
  `chrome.storage.local`, which the demo web app page reads too.
- **Auth**: Sign in / Create account open the web app's login or register
  page; the web app shows a one-time pairing code that you paste into the
  popup (the demo web app also has a "Connect this browser" button that
  messages the extension directly). The extension stores only the token it
  gets back and never handles a password.

## How to swap engines

Settings → Engine and web app → **Scoring engine**:

- **On-device**: `LocalEngine`, the rules in `shared/rules/`. Works offline;
  text never leaves the browser.
- **Remote** (default): `RemoteEngine` POSTs `{message_text, channel}` to
  `<Scoring server URL>/api/score` (default `http://127.0.0.1:8000`) with a
  3 s timeout and one quiet retry. It accepts either

  ```json
  {"riskLevel": "high", "score": 86, "explanation": "...", "signals": [{"name": "similarity", "score": 0.9}]}
  {"band": "High", "score": 0.86, "explanation": "...", "signals": [...]}
  ```

  The on-device rules still run; the higher verdict wins. If the server is
  down or errors, the on-device verdict is shown with "Server offline ·
  on-device rules only".

To plug in a different engine, give it the same shape (`scoreMessage(input,
{sensitivity}) -> Promise<Verdict>`, see `LocalEngine` in
`shared/verdict.js`) and return it from `engineFor()` in `background.js`.

Dev mock of the scoring server (standard library only):

```bash
python3 trustgraph_extension/scripts/mock_server.py              # old {band, score 0..1} answers
python3 trustgraph_extension/scripts/mock_server.py --new-shape  # {riskLevel, score 0-100} answers
python3 trustgraph_extension/scripts/mock_server.py --fail       # HTTP 500 (error path)
python3 trustgraph_extension/scripts/mock_server.py --all        # also /api/settings and /api/status
```

## Tests

```bash
node trustgraph_extension/test/rules.test.js       # scam rules: 52 fixtures + engine checks
node trustgraph_extension/test/verdict.test.js     # engine interface, signal mapping, chat verdicts
node trustgraph_extension/test/result.test.js      # privacy: Result has no text field, nothing leaks
node trustgraph_extension/test/background.test.js  # service worker flows against a fake chrome API
node trustgraph_extension/test/tokens.test.js      # tokens match the spec; contrast on every chip
cd trustgraph_extension && python3 -m http.server 5500       # then open:
#   http://localhost:5500/test/test-chat.html      fake chat: hover a bubble, click the shield
#   http://localhost:5500/test/adapter-tests.html  every adapter vs. its saved HTML sample
#   http://localhost:5500/test/reader-tests.html   WhatsApp reader
#   http://localhost:5500/test/fallback-tests.html every platform after a simulated redesign; page-sample anonymiser
#   http://localhost:5500/dev/gallery.html         component gallery
python3 trustgraph_extension/scripts/build_zip.py
```

**Checking message reading on the live site:** open a chat, click the
TrustGraph toolbar icon, and read the line under "This page": `Rows 36 ·
message containers 16 · parsed 16`. *parsed* should equal *message
containers*. With Debug mode on, the same counts are logged to the page
console (never message text).

## Where to look when something breaks

| What | Where |
| --- | --- |
| Background / server / web app calls | `chrome://extensions` → TrustGraph → **service worker** link → Console |
| Shield, adapters, panel | The web page's DevTools Console (messages start with `[TrustGraph]`) |
| Load errors | `chrome://extensions` → TrustGraph → **Errors** button |

## Site adapters: status and calibration

| Site | Adapter | Status |
| --- | --- | --- |
| WhatsApp Web | `adapters/whatsapp/adapter.js` + `reader.js` | Rebuilt from live-site observations (Oct 2026) |
| Gmail | `adapters/gmail.js` | Hint-based, **not verified** |
| LinkedIn messaging, Telegram Web (K and A), Discord, Slack | `adapters/sites.js` (selector configs) + `adapters/config.js` | Hint-based, **not verified** |
| Facebook Messenger, Instagram DMs | `adapters/messenger.js`, `instagram.js` + `meta-chat.js` | Hint-based, **not verified** |
| Any other https site | `adapters/generic.js`, registered only after Settings → Sites → **Any other site** grants the optional all-sites permission | Single messages (any block of text) |
| Anywhere | right-click menu, popup "Check current selection" | Works wherever text can be selected |

**If a site changes its HTML**, the precise selectors can stop matching. The
shield then falls back to any message-sized block of text in the chat area
(`kit.textBlock()`, used by `content/core.js` for every site adapter), so
single-message checks keep working while the adapter is fixed; only
whole-chat scans need the adapter. `test/fallback-tests.html` strips every
class, id, role and `data-*` attribute from each platform's sample and checks
each message is still found.

**Checking each platform on the live site (2 minutes each).** Log in, open a
conversation, then:

1. Click the TrustGraph toolbar icon. "This page" should say
   `<Site>: recognising N messages` with N > 0.
2. Hover a message from someone else: the blue shield appears at its corner.
   Click it: the panel opens with a verdict.
3. Click the round scan button (right edge): "Read N messages from this chat".
4. If step 1 says "no messages recognised" or step 3 reads nothing: turn on
   Settings → Engine and web app → **Debug mode**, reload the page, open the
   popup and click **Save anonymised page sample**. The file has every letter
   replaced by `x` and every digit by `0` (structure only, no messages,
   names or numbers); check it, then send it to whoever maintains the
   adapters. It becomes a real fixture in `test/fixtures/`.

| Platform | Where it works | Own messages |
| --- | --- | --- |
| WhatsApp Web | any chat | marked by WhatsApp, skipped |
| Gmail | an open email thread (not the inbox list). Reads only what you can see: skips hidden preview text, quoted replies (Gmail, Outlook, "On … wrote:"), signatures and legal disclaimers. Also checks the sender's name against their address, and each link's visible text against where it really goes | your own address, skipped |
| LinkedIn | /messaging and the chat pop-ups on any LinkedIn page | marked by LinkedIn, skipped |
| Telegram Web | /k/ and /a/ chats | marked by Telegram, skipped |
| Discord | channels and DMs | not marked: everything is checked |
| Slack | channels and DMs in the browser (app.slack.com) | not marked: everything is checked |
| Messenger, Instagram | facebook.com/messages, instagram.com/direct | by bubble position |
| Any other site | after allowing "Any other site" in Settings | single checks only |

Adding a chat site is a config entry in `adapters/sites.js` (row, body,
sender, time and pane selectors; see the comment in `adapters/config.js`),
its URL in `manifest.json` `content_scripts`, a fixture and an entry in
`test/fixtures/expected.json`.

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

## Scam rules (`shared/rules/`)

`normalize.js` cleans text (Unicode, case, zero-width characters, Malayalam
chillu spellings, leetspeak like "0tp", stretched words, spaced letters like
"O T P") while keeping a map back to the original, so evidence quotes exactly
what the message said. `rules.js` has the named rules, each with a weight and
a plain-language reason, in English, Malayalam script, Manglish, Hinglish and
Hindi. `engine.js` turns hits into a score:

- weights combine as `1 - product(1 - w)`; combinations add their own weight
  (link + urgency + money, "new number" + money, secrecy + payment, threat +
  money demand, official warning + bad link)
- negation before the match ("we will **never** ask for your OTP") and after
  it ("OTP aarodum share **cheyyaruthu**", "**mat** batana")
- developer conversations (repo, deploy, API, staging…) damp OTP/code rules
- sender context: an unsaved number or a first message raises the score; a
  saved contact with history lowers it
- runs of messages from one sender are also scored together
- **one sign can never produce High** (capped at 0.69)
- bands: High from 0.70, Caution from 0.35

| Rule | Weight | | Rule | Weight |
|---|---|---|---|---|
| otp_request (OTP/PIN/CVV/password) | 0.60 | | job_offer (task / like-and-earn) | 0.50 |
| blackmail (sextortion) | 0.60 | | upfront_fee (pay to get) | 0.50 |
| upi_collect (PIN/QR to "receive") | 0.55 | | investment (guaranteed/double/crypto) | 0.50 |
| authority_threat (CBI, customs, digital arrest) | 0.55 | | kyc_block (KYC/PAN/Aadhaar, account blocked) | 0.50 |
| power_cut (electricity disconnection) | 0.55 | | link_lookalike / punycode / IP / shortener / odd TLD | 0.50 / 0.45 / 0.45 / 0.30 / 0.25 |
| remote_access (AnyDesk…) | 0.55 | | prize (lottery, KBC, cashback) | 0.45 |
| gift_card | 0.55 | | new_number_family ("Hi Mum, new number") | 0.45 |
| legal_threat (arrest, warrant) | 0.40 | | secrecy / money_request / urgency | 0.30 / 0.20 / 0.15 |

`node trustgraph_extension/test/rules.test.js` runs 27 scam and 25 benign
fixtures (student chat, dev chat about OTP flows and deploys, a genuine bank
alert, …) and prints precision and recall.

**Please review:** the Malayalam, Manglish and Hinglish vocabulary and fixtures
were written without a native speaker. Add real (anonymised) examples to
`test/rules.test.js` and adjust `rules.js` until they pass.


## QA checklist (before a demo or a store upload)

Run in a **fresh Chrome profile** (chrome://settings/manageProfile → Add).

| # | Test | Expect |
| --- | --- | --- |
| 1 | Load unpacked (or the `dist/` zip) | No **Errors** button; the welcome page opens |
| 2 | Welcome → Next ×3 → Get started → **Check this message** | Panel: High risk, score ring, 3-4 signals, "Server offline · on-device rules only"; no Save / Mark wrong (it's a sample) |
| 3 | Popup → **Use without account** | Status chip "Local only"; Overview / History / Settings tabs; arrow keys move between tabs |
| 4 | Settings → History → **Demo data** on | Overview tiles, sparkline and channel bars fill; History lists 42 results; banner "Showing demo data" |
| 5 | History: search "gmail", filter High, open a result | Signals listed; Open in workspace opens the demo web app; Mark as wrong shows "Marked as wrong verdict" |
| 6 | Export JSON and CSV | Files contain only id, timestamp, riskLevel, score, signalIds, channel, domain |
| 7 | **Delete all history** | Confirmation dialog, focus on Cancel; after Delete all, the empty state |
| 8 | Test chat (`test/test-chat.html`): hover the gift-card bubble, click the shield | Pulsing ring, then the panel; the page narrows instead of being covered |
| 9 | In the panel: switch **Save to history** off | The result disappears from History; Open in workspace greys out |
| 10 | Click the round button (launcher) | Chat verdict "Across the N messages…", signals with "Jump to message", Continuity and similarity |
| 11 | Select text on any site → right-click **Check with TrustGraph** | Panel overlays the page |
| 12 | Popup → **Sign in** → demo web app → **Connect this browser** | Status chip "Signed in"; new checks appear in the demo web app |
| 13 | `mock_server.py` (then `--new-shape`, then `--fail`) and check again | "TrustGraph server + on-device rules"; with --fail, "Server error · on-device rules only" |
| 14 | Settings: Sensitivity Strict, Shield position Top left, Theme Light, Auto-scan | Thresholds and copy change; shield moves; light theme everywhere; auto-scan shows only the rail, opening for High |
| 15 | Settings → **Notify me on high risk** | Chrome asks for the notifications permission; a High check notifies with the site only |
| 16 | Each platform: the 4 steps in "Checking each platform on the live site" | Recognising N > 0, shield, verdict, chat scan |
| 17 | Keyboard only, OS reduced motion | Visible focus rings (primary blue); Esc closes the panel and focus returns; no animation |

## Build the Web Store package

```bash
pip install pillow                       # only needed to redraw icons
python3 trustgraph_extension/scripts/make_icons.py  # icons/*.png + store/assets/promo-440x280.png
python3 trustgraph_extension/scripts/build_zip.py   # -> dist/trustgraph-0.1.0.zip
```

`build_zip.py` strips the dev-only test-page entry and leaves out `test/`,
`store/`, `scripts/`, `dev/` and `adapters/stub.js`. It stops if the
manifest references a missing file or any script uses `eval`. Store copy,
privacy policy, permission justifications and data disclosures are in
`store/`.

## Layout

```
background.js        service worker: engines, history, counts, account, every network call
content/             core.js (shield, chat scan), panel.js (side panel, launcher), chat-store.js
adapters/            one file per site, config.js + sites.js (selector configs), generic.js, kit.js
shared/              constants, design.js + ui.js + icons.js (design system), verdict.js,
                     result.js, api-client.js, demo-data.js, rules/ (on-device engine)
ui/                  popup, welcome + settings, settings form, privacy, demo web app
fonts/               Space Grotesk, DM Sans, JetBrains Mono (SIL OFL, see fonts/OFL.txt)
dev/                 component gallery (not shipped)
test/                tests and fixtures (not shipped)
store/               Web Store listing, privacy policy, justifications (not shipped)
scripts/             mock server, icon + zip builders (not shipped)
```
