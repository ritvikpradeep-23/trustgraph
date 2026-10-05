# Handoff: TrustGraph extension UI redesign

Context for a new Claude Code session continuing this work on the owner's
computer. The extension lives in `trustgraph_extension/` (Manifest V3, plain
JavaScript, no build step). Branch: `claude/new-session-xom8fy`.

## Where things stand

Done and pushed (see `git log`):
- M1–M7: the original extension (service worker, right-click check, options,
  popup, onboarding, store docs, `scripts/build_zip.py`).
- Job 1: WhatsApp reader (`adapters/whatsapp/reader.js`) and chat store
  (`content/chat-store.js`). The owner confirmed on live WhatsApp that
  "parsed" equals "message containers".
- Job 2: docked side panel (`content/panel.js`) that pushes the page aside,
  draggable launcher, chat scan in `content/core.js`.
- Job 3: multilingual rules engine (`shared/rules/normalize.js`, `rules.js`,
  `engine.js`).
- Redesign step 1 started: bundled fonts in `fonts/` (Space Grotesk, DM Sans,
  JetBrains Mono; licence in `fonts/OFL.txt`) and 57 Lucide icons as data in
  `shared/icons.js`. Neither is wired into the UI yet.

## The task

Apply the owner's UI prompt ("TrustGraph browser extension, UI matched to the
web app": dark design tokens, Space Grotesk / DM Sans / JetBrains Mono,
Lucide icons, 400px popup with Overview / History / Settings, welcome page,
privacy-first Result type). Ask the owner to attach that prompt file again
if you need the exact token values and screen list.

## Decisions the owner already made (do not re-ask)

1. **Restyle and extend the current plain-JS code.** No Vite, TypeScript or
   React, and no build step. Use JSDoc types plus runtime checks. "Build" means
   `python3 trustgraph_extension/scripts/build_zip.py` plus the test suites.
2. **Keep the docked side panel**, restyled in the new design: score ring
   gauge, signal rows with icons and severity dots, a continuity and
   similarity section, actions Save to history (on by default), Mark as wrong
   verdict, Open in workspace, and mono footer "No message text stored ·
   Results only". Single-message (shield) checks use the same panel. Do not
   switch to an anchored popover.
3. **Remove "Report as scam"** and everything behind it (`/api/report`, the
   REPORT message, privacy copy, store docs). Replace it with "Mark as wrong
   verdict", which sends only the verdict id.
4. **No web app or backend exists yet: mock it.** Build an `ApiClient` for
   `POST /api/results`, `GET /api/results`, `DELETE /api/results/:id` and
   `GET /api/export` that falls back to a local mock. Add demo-data mode, a
   configurable web app URL in Settings, and pairing-code sign-in that works
   against the mock. Never handle a password.

## Planned steps (step 1 is half done)

1. **Design system:** shared tokens, `@font-face` for the bundled fonts, icons,
   and a `dev/` gallery page showing every component in Low / Caution / High
   (excluded from the zip).
2. **Toolbar popup (400px):**
   - status chip and settings gear
   - signed-out pitch with Sign in / Create account / Use without account
   - Overview: verdict tiles, 7-day sparkline, channel bars, "Check current
     selection"
   - History: filters, search, details, delete, export JSON/CSV, delete all
     with confirm, empty/loading/error states
   - Settings
3. **In-page UI** in the new design:
   - shield button with a pulsing scan ring
   - restyled panel and launcher
   - Gmail first, then config-driven selectors for WhatsApp, Messenger,
     Instagram, LinkedIn, Telegram, Discord and Slack
   - a generic fallback for any text block, registered with
     `chrome.scripting.registerContentScripts` only after the user grants the
     optional "all sites" permission
4. **Engine interface:** `scoreMessage(input) -> Verdict {riskLevel:
   "low"|"caution"|"high", score 0-100, explanation, signals}` with
   `LocalEngine` (the existing rules) and `RemoteEngine` (configurable URL,
   also accepting the old `{band, score 0..1}` shape), selected in Settings.
   Map rule ids to the eight signal types in the prompt.
5. **Privacy in code:** a `Result` record with a fixed whitelist (id, timestamp,
   riskLevel, score, signalIds, channel, domain, optional salted hash) and a
   node unit test that fails if any text-like field is added.
6. **Settings, history, account and pages:**
   - Settings: sites, click-to-scan vs auto-scan (auto-scan off by default;
     when on it only opens the collapsed rail, and expands for High), shield
     position, sensitivity Relaxed / Balanced / Strict, high-risk
     notifications (optional `notifications` permission, requested on
     toggle), retention 7/30/90/forever, account, theme (dark default)
   - history retention, export and delete
   - Welcome/Options page in a split layout: "Read the signal. Keep the
     trust.", a 3-step onboarding and the privacy promise screen
7. **Wrap-up:** README with how to swap engines and a QA checklist, then a
   screenshot of each surface compared against the tokens.

## Rules to keep

- Message text only in memory: never stored, synced or logged.
- No `innerHTML` with message text; all in-page UI in closed shadow roots.
- Minimum permissions; tell the owner exactly why if any are added.
- Small commits per step, in plain English.
- After each step, run:
  - `node trustgraph_extension/test/rules.test.js`
  - `test/reader-tests.html` and `test/adapter-tests.html`, served with
    `cd trustgraph_extension && python -m http.server 5500`
  - `python trustgraph_extension/scripts/build_zip.py`
