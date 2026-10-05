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

## Status (5 October 2026, second session)

All seven planned steps are done and pushed on `claude/awesome-hawking-fzvsex`:

1. Design system: `shared/design.js` (tokens, fonts, component CSS),
   `shared/ui.js` (components), `dev/gallery.html`.
2. Toolbar popup: `ui/popup.*`, `ui/settings-form.js`.
3. In-page UI: `content/panel.js`, `content/core.js`; LinkedIn, Telegram,
   Discord and Slack via `adapters/config.js` + `adapters/sites.js`;
   `adapters/generic.js` behind the optional all-sites permission.
4. Engine interface: `shared/verdict.js` (LocalEngine, RemoteEngine, the
   eight signal types, `aggregate()` for chats).
5. Privacy: `shared/result.js` + `test/result.test.js`.
6. Settings, history, account: `background.js`, `shared/api-client.js`
   (mock web app when no URL is set), `shared/demo-data.js`,
   `ui/options.*` (welcome tour + settings), `ui/webapp.*` (demo web app),
   `ui/privacy.*`.
7. README (engines, QA checklist), store docs, screenshots in
   `docs/screenshots/`, `test/tokens.test.js` (tokens + contrast).

Open items for the owner:
- The new site adapters (LinkedIn, Telegram, Discord, Slack) and Gmail,
  Messenger, Instagram are hint-based: calibrate each with a real sample.
- A real web app needs the endpoints in `TG.WEBAPP` (shared/constants.js)
  and a pairing-code flow; set its URL in Settings.
- `[CONTACT EMAIL]` in the privacy policy.

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
