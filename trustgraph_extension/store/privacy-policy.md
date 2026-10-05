# TrustGraph privacy policy

_Last updated: 5 October 2026_

<!-- Host this page at a public URL (e.g. GitHub Pages) and paste that URL
     into the Chrome Web Store dashboard. Keep it in sync with
     trustgraph_extension/ui/privacy.html, the copy shipped inside the extension. -->

**Only the verdict comes home. The message stays where it was detected.**

TrustGraph is a browser extension that checks a message you choose for signs
of a scam. It reads only what you ask it to check, and it never stores, syncs
or logs message text.

- No message text in detection history.
- No scam reports or public submission database.
- Delete or export your data anytime.

## What TrustGraph reads, and when

- **The shield** on a single message, **Check with TrustGraph** in the
  right-click menu, or **Check current selection** in the toolbar popup reads
  just that message or the text you selected.
- **The round TrustGraph button** next to a chat reads the messages of the
  conversation you have open that are already loaded on the page, and keeps
  reading new ones only while its panel is open. It reads older messages only
  if you click **Scan earlier messages**.
- **Auto-scan** (off unless you switch it on in Settings) reads the open chat
  on supported sites the same way, without a click.
- It never checks your own messages, and does nothing when you only hover or
  scroll. It does not read your other conversations, contacts or browsing
  history.

## Where the text goes

- With the **on-device** engine, the text never leaves your browser.
- With the **remote** engine (the default), the text is sent to the
  TrustGraph scoring server address in Settings, by default
  `http://127.0.0.1:8000` on your own computer. If you set a different server,
  that server operator's policies apply. If it can't be reached, the
  on-device rules are used and nothing is sent.
- The text lives only in memory for the length of the check (and, for a
  chat, while its panel is open, so it can quote evidence and "Jump to
  message"). It is never written to disk, synced or logged.

## What TrustGraph stores

- **History** (if "Save to history" is on): for each check, a random id, the
  time, the verdict, the 0–100 score, the signal types (for example
  "urgency"), the site (for example "Gmail"), the website's host name, and an
  optional salted hash used only to avoid duplicates. No message text, no
  sender, no explanation.
- **Counts**: how many checks were Low, Caution or High each day, per site.
- **Settings**, and whether you're signed in.
- History is kept for 7, 30 or 90 days, or until you delete it (your choice
  in Settings).

## Your TrustGraph workspace

If you sign in, the same history records (never text) are synced to the
TrustGraph web app. You sign in on the web app itself; the extension never
sees your password. "Mark as wrong verdict" sends only the verdict's id.

## What TrustGraph doesn't do

- No scam reports or public submission database: nothing you check is shared.
- No analytics, tracking or advertising, and no selling or sharing of data.
- No remote code: all of TrustGraph's code ships inside the extension.

## Export and delete

In the toolbar popup's History tab you can export everything as JSON or CSV,
delete one result, or delete all history. Removing the extension deletes
everything it stored in your browser.

## Contact

Questions about this policy: [CONTACT EMAIL].
