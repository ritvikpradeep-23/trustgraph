# Data disclosures (draft answers for the Privacy practices tab)

Review these before submitting; you are certifying them.

## What user data does the item collect?

Tick these:

- [x] **Personal communications**: the text of the messages the user chooses
  to check: the loaded messages of the open conversation (after a click on the
  TrustGraph button), or one message (shield / "Check with TrustGraph").
  Messages the user sent themselves are not transmitted.
  Processed on the user's device (offline Basic check) or sent to the
  TrustGraph server the user configures, by default `http://127.0.0.1:8000`
  on the user's own computer. Only sent to the shared scam database when the
  user clicks "Report as scam" and confirms.
- [x] **Website content**: the same message text, read from the page the
  user is on.

Leave these unticked (TrustGraph doesn't collect them):

- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Authentication information
- [ ] Location
- [ ] Web history
- [ ] User activity (no click, mouse, scroll, or keystroke logging; the
  daily counts are numbers stored only on the device)

> Note: the extension reads a sender name/address for a message only inside
> the page and does not send or store it.

## Certifications

- [x] I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to
  my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or
  for lending purposes.

## Supporting details (if asked)

- **Single purpose:** Check messages the user selects for scam signals.
- **Stored on device:** settings and daily counts only (`chrome.storage.local`).
  No message text. "Clear local data" in Settings, or uninstalling, deletes it.
- **Network:** only to the configured TrustGraph server: `/api/score` (the
  text being checked), `/api/report` (only after confirmation),
  `/api/settings` (no data sent) and `/api/status`, a heartbeat every 15 s
  while a supported chat page is open that sends only the site name (e.g.
  "whatsapp") and a timestamp. No analytics or third-party requests.
- **Privacy policy URL:** _[the public URL where you host store/privacy-policy.md]_
