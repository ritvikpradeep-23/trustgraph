# Permission justifications (Chrome Web Store → Privacy practices)

**Single purpose:** Check messages the user selects for scam signals.

Paste one line per field in the dashboard.

## Permissions

| Permission | Justification |
| --- | --- |
| `contextMenus` | Adds the "Check with TrustGraph" item to the right-click menu for selected text, so a user can check a message on any site. |
| `activeTab` | When the user picks "Check with TrustGraph", grants temporary access to that one tab so the result card can be shown next to the selected text, with no standing access to other sites. |
| `scripting` | Injects the result card script into the current tab (under activeTab) after the user right-clicks "Check with TrustGraph". |
| `storage` | Saves the user's settings and daily check/flag counts on the device. No message text is stored. |

## Host permissions

| Host | Justification |
| --- | --- |
| `https://web.whatsapp.com/*` | Shows the shield button next to WhatsApp Web messages so the user can check one with a click. Nothing is read until the user clicks. |
| `https://mail.google.com/*` | Shows the shield button on an open Gmail email so the user can check it with a click. Nothing is read until the user clicks. |
| `https://www.facebook.com/*` | Facebook Messenger on the web now lives at facebook.com/messages (messenger.com redirects there). Facebook is a single-page app, so a script limited to /messages would never load when the user navigates there from the feed. The script loads on facebook.com but only activates under /messages, and reads nothing until the user clicks. |
| `https://www.instagram.com/*` | Instagram DMs live at instagram.com/direct. It's a single-page app, so the script loads on instagram.com but only activates under /direct/, and reads nothing until the user clicks. |
| `http://127.0.0.1/*`, `http://localhost/*` | Sends the text the user chose to check to the TrustGraph analysis server running on the user's own computer (default http://127.0.0.1:8000). |

## Optional host permissions

| Host | Justification |
| --- | --- |
| `https://*/*` (optional) | Requested only if the user enters a custom https:// server address in Settings, and only for that one host, so checks can be sent to the server the user chose. |

## Remote code

**No**, I am not using remote code. All JavaScript is included in the
package; the extension makes only `fetch` calls for JSON data to the
configured TrustGraph server.
