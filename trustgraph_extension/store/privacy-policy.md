# TrustGraph privacy policy

_Last updated: 5 October 2026_

<!-- Host this page at a public URL (e.g. GitHub Pages) and paste that URL
     into the Chrome Web Store dashboard. Keep it in sync with
     trustgraph_extension/ui/privacy.html, the copy shipped inside the extension. -->

TrustGraph is a browser extension that checks a message you choose for signs
of a scam. This policy explains what it does with your data. In short: it
reads only what you ask it to check, sends it only to the server you choose,
and stores no message text.

## What TrustGraph reads, and when

TrustGraph reads nothing until you click one of its controls:

- **The TrustGraph button** next to a chat on WhatsApp Web, Gmail, Facebook
  Messenger or Instagram reads the messages of the conversation you have
  open that are already loaded on the page. It reads older messages only if
  you click **Scan earlier messages**, and it keeps reading new messages in
  that conversation only while its side panel is open.
- **The shield** next to a single message, or **Check with TrustGraph** in
  the right-click menu, reads just that message or the text you selected.
- It does not read your other conversations, contacts, or browsing history,
  and does nothing when you only hover or scroll. On the four supported
  sites its script is present so it can show its buttons, but it reads no
  content until you click.

## Where the text goes

- Messages from other people in the conversation (not your own) are sent to
  the TrustGraph server address in Settings to be checked. By default this
  is `http://127.0.0.1:8000`, which is your own computer.
- If that server can't be reached, messages are checked on your device by
  the built-in Basic check and are not sent anywhere.
- If you change the server address to another server, the text you check is
  sent to that server, under that server operator's own policies.
- While the side panel is open, the messages it read are kept only in the
  page's memory, so it can show evidence and "Jump to message". They are
  forgotten when you close the panel, switch conversations, or leave the
  page. They are never saved to disk or logged.

## Reporting a scam

If you click **Report as scam** and then confirm, the message text is sent to
your configured server's shared scam database so similar messages can be
flagged. Nothing is reported unless you confirm.

## What TrustGraph stores

- Your settings (for example, which sites are on and the server address).
- Daily counts: how many messages you checked and how many were flagged, per
  site. These are numbers only.
- TrustGraph never stores message text, sender names, or addresses.
  Everything it stores stays in your browser on this device.

## What TrustGraph doesn't do

- No analytics, tracking, or advertising.
- No selling, renting, or sharing of your data with anyone.
- No use of your data for anything other than checking the messages you
  choose.
- No remote code: all of TrustGraph's code ships inside the extension.

## Deleting your data

Open TrustGraph's Settings and click **Clear local data**, or remove the
extension from Chrome. Either one deletes everything TrustGraph stored in
your browser.

## Contact

Questions about this policy: [CONTACT EMAIL].
