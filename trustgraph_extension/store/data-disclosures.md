# Data disclosures (draft answers for the Privacy practices tab)

Review these before submitting; you are certifying them.

## What user data does the item collect?

Tick these:

- [x] **Personal communications**: the text of the messages the user chooses
  to check (one message via the shield, right-click or "Check current
  selection"; or the loaded messages of the open conversation via the
  TrustGraph button or, if the user turns it on, auto-scan). Messages the
  user sent themselves are not checked. The text is processed in memory on
  the device (on-device engine) or sent to the TrustGraph scoring server the
  user configures, by default `http://127.0.0.1:8000` on the user's own
  computer. It is never stored, synced or logged.
- [x] **Website content**: the same message text, read from the page the
  user is on.

Leave these unticked (TrustGraph doesn't collect them):

- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Authentication information (pairing gives the extension a token from
  the web app; it never sees a password)
- [ ] Location
- [ ] Web history (history records keep a host name such as
  "mail.google.com" for a check the user made, never full URLs)
- [ ] User activity (no click, mouse, scroll or keystroke logging)

> The extension reads a sender name/address only inside the page, to weigh
> an unsaved number, and never sends or stores it.

## Certifications

- [x] I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to
  my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or
  for lending purposes.

## Supporting details (if asked)

- **Single purpose:** Check messages the user selects for scam signals.
- **Stored on device** (`chrome.storage.local`): settings, daily counts per
  verdict and site, and history records with the fields id, timestamp,
  riskLevel, score, signalIds, channel, domain and an optional salted hash.
  No message text (`test/result.test.js` enforces this). Export or delete
  from the popup; uninstalling deletes everything.
- **Network:**
  - Scoring server (`backend_url`, remote engine only): `POST /api/score`
    with the text being checked; optional `GET /api/settings` (no data sent)
    and `POST /api/status`, a heartbeat every 15 s while a supported chat
    page is open that sends only the site name and a timestamp.
  - Web app (`webapp_url`, only when the user signs in): `POST/GET
    /api/results`, `DELETE /api/results/:id`, `GET /api/export` with history
    records only, `POST /api/feedback` with a verdict id, `POST
    /api/extension/pair` with the pairing code.
  - No analytics or third-party requests.
- **Privacy policy URL:** _[the public URL where you host store/privacy-policy.md]_
