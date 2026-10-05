# TrustGraph privacy policy

_Last updated: 5 October 2026_

<!-- Host this page at a public URL (e.g. GitHub Pages) and paste that URL
     into the Chrome Web Store dashboard. Keep it in sync with
     extension/ui/privacy.html, the copy shipped inside the extension. -->

TrustGraph is a browser extension that checks a message you choose for signs
of a scam. This policy explains what it does with your data. In short: it
reads only what you ask it to check, sends it only to the server you choose,
and stores no message text.

## What TrustGraph reads, and when

- TrustGraph reads a message only after you click its shield button next to
  that message, or select text and choose **Check with TrustGraph** from the
  right-click menu.
- It reads only that one message's text. It does not read your other
  messages, contacts, or browsing history, and does nothing when you only
  hover or scroll.
- On WhatsApp Web, Gmail, Facebook, and Instagram, TrustGraph's script is
  present on the page so it can show the shield button, but it reads no
  content until you click.

## Where the text goes

- The text you check is sent to the TrustGraph server address in Settings.
  By default this is `http://127.0.0.1:8000`, which is your own computer.
- If that server can't be reached, the text is checked on your device by the
  built-in Basic check and is not sent anywhere.
- If you change the server address to another server, the text you check is
  sent to that server, under that server operator's own policies.

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
