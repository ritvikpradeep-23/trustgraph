# Site compatibility checklist: click-to-check on any website

How to check that the universal click-to-check (`trustgraph_extension/content/universal.js`)
works on a site, and what has been checked so far.

## The seven checks

| # | Check | How to verify |
|---|---|---|
| a | The shield appears on content | Hover an image, video, canvas, background image or a paragraph. A small blue shield appears at its top-left (media) or top-right (text). |
| b | Clicking it works | Click the shield. A card appears at the bottom-right of the page saying "Checking…", then the result. |
| c | Capture works | The card's last line says how it was read: *Read directly from the page*, *Downloaded from its address*, or *Screenshot of the page*. |
| d | A result comes back from the backend | Media: the card shows "Deepfake model: …" and a database line ("Matches a known fake" / "No match"). Text: a verdict chip and a database line. |
| e | Layout and scrolling unaffected | The page doesn't shift when the shield appears; scrolling, clicking links and video controls behave normally. |
| f | No new console errors | DevTools → Console, with TrustGraph on and off: no new red errors. |
| g | Works after SPA navigation / scrolling | Open another post or chat without reloading, scroll to load more content, then repeat a–d on the new content. |

**Setup for a manual run:** start the server (`python run_server.py`), seed demo items
(`python scripts/seed_fingerprints.py --demo`), reload TrustGraph in `chrome://extensions`, and in
the site's DevTools console run `localStorage.setItem("trustgraph-debug-scan", "1")`. Each shield
and result is then logged as `[TrustGraph universal] …` (summaries only, never content).
`GET http://127.0.0.1:8000/health/fingerprint` should answer `{"ok": true, …}`.

## Real sites

**None of these could be tested from the build environment.** Its network policy blocks
outbound connections to all of them (checked with `curl`: every request was rejected by the
egress proxy), and most also need a logged-in account. Please run the checks above on each
and fill in the table.

| Site | a | b | c | d | e | f | g | Notes |
|---|---|---|---|---|---|---|---|---|
| WhatsApp Web | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; needs a phone-linked login. Text stays with the existing chat shield; the universal shield is for images/videos. Chat media are `blob:` URLs: expect "Read directly". |
| Instagram | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; login wall. Photos sit under an overlay (handled, see simulated feed). |
| Messenger | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; login wall. |
| Facebook | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; login wall. |
| X | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; most pages need a login. |
| YouTube | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access. Videos are MSE `blob:` streams from the same origin: expect "Read directly". |
| Telegram Web | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access; login wall. |
| A news article | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | No network access. |

## Simulated site patterns (tested)

What *was* tested: local pages that reproduce the patterns these sites use, with the real
extension loaded in Chromium and the real backend (temporary database seeded with one
known image and two known scam texts). Run it with
`node trustgraph_extension/test/universal-e2e.js` (needs Playwright; it starts
`tests/universal_e2e_server.py` itself). The pages are in
`trustgraph_extension/test/fixtures/universal/`, served from a real HTTP server that sends no
CORS headers, on separate origins (`news.test`, `cdn.other.test`, `embed.other.test`,
`social.test`, `video.test`). 41/41 checks passed on 2026-10-06.

A screenshot-captured seeded image coming back as `db_match: true` proves the crop landed
on the element: a misaligned crop does not match.

| Pattern (like) | a | b | c (how) | d | e | f | g |
|---|---|---|---|---|---|---|---|
| Paragraph text (news article) | Pass | Pass | Pass (direct) | Pass (verdict + no match) | Pass | Pass | n/a |
| Known scam text (forwarded message) | Pass | Pass | Pass (direct) | Pass (High risk + db_match) | Pass | Pass | n/a |
| Same-origin image | Pass | Pass | Pass (direct) | Pass (db_match) | Pass | Pass | n/a |
| Cross-origin image, no CORS (CDN) | Pass | Pass | Pass (downloaded by the background) | Pass (no match, as expected) | Pass | Pass | n/a |
| CSS background image, cross-origin | Pass | Pass | Pass (downloaded) | Pass (db_match) | Pass | Pass | n/a |
| Thumbnail under 120 px | Pass (no shield, as intended) | n/a | n/a | n/a | Pass | Pass | n/a |
| Canvas | Pass | Pass | Pass (direct) | Pass (db_match) | Pass | Pass | n/a |
| Same-origin video (8 frames / 4 s) | Pass | Pass | Pass (direct) | Pass (db_match) | Pass | Pass | n/a |
| Cross-origin video, no CORS | Pass | Pass | Pass (screenshot) | Pass (db_match) | Pass | Pass | n/a |
| Cross-origin iframe: image (embed) | Pass | Pass | Pass (downloaded) | Pass (db_match) | Pass | Pass | n/a |
| Cross-origin iframe: unreadable canvas | Pass | Pass | Pass (screenshot + frame offset) | Pass (db_match) | Pass | Pass | n/a |
| Open shadow DOM component | Pass | Pass | Pass (direct) | Pass (db_match) | Pass | Pass | n/a |
| Infinite scroll / lazy image | Pass | Pass | Pass (direct) | Pass (db_match) | Pass | Pass | Pass |
| Photo under a transparent overlay (Instagram) | Pass | Pass | Pass (downloaded) | Pass (db_match) | Pass | Pass | n/a |
| SPA navigation (pushState, new post) | Pass | Pass | Pass (downloaded) | Pass (no match, as expected) | Pass | Pass | Pass |
| Video player with overlay + control bar (YouTube) | Pass | Pass | Pass (screenshot) | Pass (db_match) | Pass (player's own button works) | Pass | n/a |
| WhatsApp Web fixture (site adapter active) | Pass (no universal text shields; chat shield unchanged) | n/a | n/a | n/a | Pass | Pass | n/a |
| Extension → backend → database round trip | n/a | n/a | n/a | Pass (`Universal.health()`) | n/a | n/a | n/a |

## Known limits

- **Protected (DRM) video** (Netflix, some players) can't be read and also shows up black in
  screenshots, so it can't be checked.
- **Screenshots only see what's on screen**: scroll the item into view first. The tab must be
  the visible one; the background refuses to capture any other tab.
- **The screenshot fallback briefly hides elements stacked over the picture** (a player's
  control bar, an overlay) for the capture frame, then restores them. You may see the controls
  flicker during a video check.
- **Text matching finds copies, not quotes inside longer text.** SimHash matches the same message
  re-typed (case, punctuation, spacing), but a known scam pasted inside a longer paragraph with
  other text may not match. Hover the quoted part itself.
- **The database only knows what you seed.** A new deepfake still needs the model's answer.
  The two are shown separately and never blended.
