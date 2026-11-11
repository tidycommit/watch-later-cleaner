# Chrome Web Store readiness

This note is a checklist for a possible Chrome Web Store listing. It does not publish the extension. Nothing in this repository is submitted to the store from here.

The extension has one job: help you remove videos from your own YouTube **Watch Later** playlist, after a dry-run preview. It does not block ads, hide recommendations, theme YouTube, or run on other sites.

## Single-purpose wording

Use language like this in the store listing name, summary, and description. Do not add other purposes.

**Name:** Watch Later Cleaner

**Short description:** Preview and remove videos from your YouTube Watch Later playlist.

**Longer description (starting point):**

> Watch Later Cleaner adds a panel on your YouTube Watch Later page (`playlist?list=WL`). Choose what to remove — watched, old, unavailable, keywords, or everything — preview the matches, then confirm. Removal runs in your browser. Settings stay in `chrome.storage`. Requests go only to `www.youtube.com`, the same site you already have open. There is no account, no analytics, and no remotely hosted code.

If a listing draft starts talking about ad blocking, recommendation filters, or a general YouTube toolkit, cut it. That would no longer be a single purpose.

## Privacy policy template

Publish this on a page you control, then paste that page's URL into the store listing. Replace the bracketed listing URL. Do not add a contact address to the extension package.

---

**Privacy policy — Watch Later Cleaner**

Watch Later Cleaner is a browser extension that removes videos from your YouTube Watch Later playlist after you preview and confirm.

**Data the extension stores.** Your criteria and options (thresholds, keywords, delays, removal mode) are saved with `chrome.storage.sync` so the popup and the on-page panel share them. That data stays in your browser's extension storage. The extension does not operate its own server and does not send those settings anywhere.

**Data the extension does not collect.** It does not collect analytics, crash reports, advertising identifiers, or account information. It does not ask you to sign in to a developer account. It does not read or transmit your cookies, your `Authorization` header, or your Watch Later list to anyone but YouTube.

**YouTube.** While you use the extension on `https://www.youtube.com`, it reads the Watch Later page and, in Fast mode, makes the same kind of same-origin requests the YouTube page makes (`/youtubei/v1/browse` and `/youtubei/v1/browse/edit_playlist`). Those requests are sent by your browser to `www.youtube.com` only, using the YouTube session you already have. Cookies and the authorization header are used inside the page script and are not passed to the rest of the extension, stored, or logged. The copyable debug log is redacted before it is copied.

**Permissions.** `storage` remembers your settings. Host access is limited to `https://www.youtube.com/*` so the panel can run on Watch Later and Fast mode can talk to YouTube from that page. There are no other hosts and no remote code.

**Changes.** If this policy changes, the new text will be posted at the same URL before the corresponding extension update is listed.

This extension is not affiliated with YouTube or Google.

---

## Permission justification

| Permission | Why it is needed | What it is not used for |
| --- | --- | --- |
| `storage` | Save the options you set in the popup and the on-page panel (`chrome.storage.sync`). | Analytics, accounts, or syncing to a developer server. |
| `https://www.youtube.com/*` | Inject the panel on the Watch Later page, read playlist rows, and (Fast mode) call YouTube's own web endpoints from that page. | Any other site. The manifest has no other host permission. |

The extension has no `tabs`, `scripting`, `cookies`, `webRequest`, `identity`, or `<all_urls>` permission. Fast mode does not add a host. The background service worker only paces a timer while a tab is hidden. It does not make network requests.

## Screenshot checklist

Capture these on a Watch Later page loaded with the unpacked extension. Use fake or your own playlist. Do not include cookies, the debug log if it has not been redacted, or a network panel showing an `Authorization` header.

The repo already has reference shots under `docs/` from local fixtures (`panel.png`, `age-preview.png`, `analytics.png`, `added-order.png`, `fast-mode.png`, `preview-analytics.png`). Retake them in a real browser window before uploading, and confirm the size the store form asks for (commonly 1280×800 PNG or JPEG, no transparency).

- [ ] Panel open on Watch Later with criteria visible and the dry-run list.
- [ ] Preview that shows a parsed publish age, including a kept video whose age is unknown.
- [ ] Confirm step (the second click) or the progress line during removal. Do not show a half-removed real playlist you cannot restore.
- [ ] Analytics tab with charts. No account name if the YouTube header is in frame, or crop it.
- [ ] Added-order control and match-all, if you mention that feature.
- [ ] Options showing Fast vs Classic.
- [ ] Small promo tile (440×280) and, if you want one, a marquee, using the existing red cleaner mark. No extra product claims.

## MV3 remote-code compliance

The package is self-contained. `extension/` is plain JavaScript loaded by the manifest. There is no bundler step that pulls code from the network, no `eval`, no `new Function`, and no `<script src="https://...">`.

`scripts/build.mjs` refuses to zip the extension if a `.js` or `.html` file under `extension/` matches a remote script URL, a dynamic `import()` of an `http(s)` URL, `eval(`, or `new Function(`. Keep that check. Do not add a CDN script, an update URL that downloads code, or a remotely hosted configuration that changes behavior.

`world: "MAIN"` in the manifest is the page bridge that calls `www.youtube.com`. It is packaged with the extension. It is not remote code. The bridge posts playlist JSON and video ids back to the content script. It does not post cookies or the `Authorization` header.

## Firefox

Not a port. Notes only, for someone who tries the same folder later:

- Firefox MV3 still uses the `browser` namespace. This extension calls `chrome.*` (`chrome.storage`, `chrome.runtime`, `chrome.tabs`). Current Firefox builds also expose `chrome` as an alias for most of those APIs, which is why a shim was not added here. If a Firefox build does not provide that alias, the calls need a `globalThis.chrome = globalThis.browser` line in the popup, the service worker, and the content script.
- Content script `world: "MAIN"` (used by `content/page-bridge.js`) is supported in Firefox 128 and newer. Older Firefox will not install a manifest that sets `world`.
- `chrome.storage.sync` and a module-free service worker match what this extension already uses. There is still no automated Firefox run in this repo.

## Out of scope here

- Submitting the zip, paying the store fee, or filling the privacy-practice form in the dashboard.
- A YouTube Data API client or an OAuth client. Watch Later is not available that way.
- Copying matched videos into another playlist before removal.
- New host permissions, telemetry, or remote configuration.
