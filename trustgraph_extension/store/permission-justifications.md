# Permission justifications (Chrome Web Store → Privacy practices)

**Single purpose:** Check messages the user selects for scam signals.

Paste one line per field in the dashboard.

## Permissions

| Permission | Justification |
| --- | --- |
| `contextMenus` | Adds the "Check with TrustGraph" item to the right-click menu for selected text, so a user can check a message on any site. |
| `activeTab` | When the user picks "Check with TrustGraph" or "Check current selection", grants temporary access to that one tab so the result panel can be shown, with no standing access to other sites. |
| `scripting` | Injects the result panel into the current tab (under activeTab) after the user asks for a check, and registers the optional "any other site" script only after the user grants that permission. |
| `storage` | Saves settings, daily counts and the verdict history on the device. No message text is stored. |

## Optional permissions

| Permission | Justification |
| --- | --- |
| `notifications` (optional) | Requested only when the user turns on "Notify me on high risk". The notification names the site, never the message. |

## Host permissions

| Host | Justification |
| --- | --- |
| `https://web.whatsapp.com/*` | Shows the TrustGraph button and shield so the user can check the open WhatsApp Web chat, or one message, with a click. Nothing is read until the user clicks (or turns on auto-scan). |
| `https://mail.google.com/*` | The same for the open Gmail thread or one email. |
| `https://www.facebook.com/*` | Facebook Messenger on the web lives at facebook.com/messages (messenger.com redirects there). Facebook is a single-page app, so a script limited to /messages would never load when the user navigates there from the feed. The script loads on facebook.com but only activates under /messages. |
| `https://www.instagram.com/*` | Instagram DMs live at instagram.com/direct; same single-page-app reason. Only activates under /direct/. |
| `https://www.linkedin.com/*` (content script) | LinkedIn messaging lives at linkedin.com/messaging inside a single-page app. Only activates under /messaging. |
| `https://web.telegram.org/*` (content script) | Telegram Web chats (/k/ and /a/). |
| `https://discord.com/*`, `ptb.` and `canary.` (content script) | Discord channels and DMs (/channels/). |
| `https://app.slack.com/*` (content script) | Slack in the browser (/client/). |
| `http://127.0.0.1/*`, `http://localhost/*` | Sends the text the user chose to check to the TrustGraph scoring server running on the user's own computer (default http://127.0.0.1:8000). |

## Optional host permissions

| Host | Justification |
| --- | --- |
| `https://*/*` (optional) | Requested only if (a) the user enters a custom https:// scoring server or web app address in Settings, and then only for that one host; or (b) the user turns on "Any other site", so the shield can appear on any page with text. Never requested at install. |

## Web-accessible resources

`fonts/*.woff2` (with `use_dynamic_url`), so the in-page panel can use the
bundled fonts without requesting fonts from the web.

## Remote code

**No**, I am not using remote code. All JavaScript is included in the
package; the extension makes only `fetch` calls for JSON data to the
configured scoring server and web app.
