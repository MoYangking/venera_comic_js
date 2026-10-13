# 2026-10-13: VeneraNext comic source browser/API compatibility assessment

## Scope and evidence

The observations below were collected on October 13, 2026, using the explicitly selected `js-reverse-mcp4` Chrome browser connector (navigation, DOM evaluation, Network requests, JavaScript source search and request initiators). The two existing repository adapters were compared with VeneraNext's `doc/api/comic_source.zh.md`, `doc/api/js.zh.md`, `venera-app/venera-configs`, and `handahao666-boop/venera_comic_source`.

Evidence covers **public, unauthenticated requests only**. No login credentials, cookies, tokens or private content were provided or harvested. No attempt was made to defeat Cloudflare, CAPTCHA, authentication, site quotas or other access restrictions. The named gallery ID used during inspection is intentionally not preserved here; API fixtures and tests use neutral sample data.

## nhentai.net: the website UI and the API differ

| Target | Observed HTTP outcome | Data or implication |
| --- | --- | --- |
| `https://nhentai.net/` | `403` (after initial redirect) | Cloudflare "Just a moment" / Turnstile verification rather than the gallery UI |
| `/api/v2/galleries?page=1` | `200` JSON | `result` array (25 items), `num_pages`, `per_page`, `total` |
| `/api/v2/galleries/{id}` | `200` JSON | gallery `title`, `cover`, `thumbnail`, `tags`, `pages`, `num_pages`, `upload_date` |
| `/api/v2/galleries/{id}?include=related,favorite` | `200` JSON | above gallery fields plus `related` array (observed 5 results) |
| `/api/v2/search?query=landscape&page=1&sort=date` | `200` JSON | list format matching `/galleries` |
| `/api/v2/galleries/popular` | `200` JSON | array of 5 popular gallery summaries |
| `/api/v2/galleries/tagged?tag_id=12227&page=1` | `200` JSON | same paginated list format |
| `/api/v2/favorites?page=1` | `401` JSON | `{"error":"Authentication required"}` without login |

**Observed list-item fields**: `id`, `media_id`, `english_title`, `japanese_title`, `thumbnail`, `thumbnail_width`, `thumbnail_height`, `num_pages`, `num_favorites`, `tag_ids`, `blacklisted`. These summaries **lack** rich `tags` objects and `pages` arrays. Detail responses, by contrast, include rich tags with keys `id`, `type`, `name`, `slug`, `url`, `count`, `description`; cover metadata (`path`, `width`, `height`); and page metadata (`number`, `path`, `width`, `height`, `thumbnail`, `thumbnail_width`, `thumbnail_height`). The thumbnail and page paths are relative, e.g. `galleries/{media_id}/thumb.webp` and `galleries/{media_id}/1.webp`.

**Plugin implications:** Keep public browsing on the working JSON API rather than expecting its protected website UI to load. Read list language from numeric `tag_ids` when there are no rich tags (language IDs verified against the reference adapter and a live detail response). Load actual images from the dedicated gallery detail endpoint, not listing summaries. A 401 for account favorites means authentication is required and does not imply a broken parser.

**Not proven:** Web login, authenticated favorites, dynamic tag search mappings beyond known language IDs, and the host application's HTTP networking environment.

## e-hentai.org: HTML layout and pagination

### Public landing/search pages

The homepage and a benign `?f_search=landscape` test returned `200`. The homepage displayed 25 results per visible listing. The list has a `#dnext` anchor with a `?next={cursor}` URL, rather than relying only on numeric page counts.

The five selectable display modes were navigated and inspected:

| Website mode | Query value | Verified listing container |
| --- | --- | --- |
| Minimal | `inline_set=dm_m` | `table.itg.gltm`, `.gl3m` |
| Minimal+ | `inline_set=dm_p` | `table.itg.gltm`, `.gl3m` |
| Compact | `inline_set=dm_l` | `table.itg.gltc`, `.gl3c` |
| Extended | `inline_set=dm_e` | `table.itg.glte`, `.gl2e` |
| Thumbnail | `inline_set=dm_t` | `div.gl1t`, `.gl4t.glink` |

Some covers use a lazy-loaded placeholder `img[src="data:..."]` with the real image URL in `data-src`; extension parsing must prefer `data-src`. Thumbnail layout has more than one `/g/` anchor per item, so duplicate gallery IDs should be deduplicated.

The actual category form uses `f_search` and a bit-mask `f_cats`; categories correspond to powers of two from 1 to 512. Expanding advanced search shows `f_srdd` rating values **0, 2, 3, 4, 5**, not 1. A query using `f_srdd=5` was accepted even without an explicit `advsearch=1` flag, so the source need not add that flag. Search with a rating filter changes the resulting list.

### Gallery details and reading

The inspected public gallery had 62 image pages and four overview pages: `p=0`, `p=1`, `p=2`, `p=3`. The last overview page contained two image-page links. The gallery included:

- `#gn` and `#gj` for titles, `#gd1` with a CSS `background: url(...)` cover, `#taglist` for named tags, `#gdd` for page count/dates, `#rating_label` for rating, and `#favoritelink` for the favorite action.
- `#gdt.gt200` containing **20 `/s/{key}/{galleryId}-{page}` links**, each with a child `<div style="width:...;height:...;background:transparent url(https://...webp) -Xpx 0 no-repeat">`. The source's former selector `#gdt .gt100 > a > div` cannot match a `#gdt` element that itself has class `gt200`.
- An actual reader page `/s/{imageKey}/{galleryId}-{page}` whose `#img[src]` points at an image hosted on a H@H network host, with image HTTP `200`. This confirms the normal GET-per-image-page method is usable in the observed browser session.
- The site ships `ehg_show.c.js`. Source inspection found `api_call` issuing an `XMLHttpRequest` with JSON for method `showpage`; a tested Next click instead navigated by document GET. Therefore the AJAX request format is **source-code evidence**, not a captured successful `showpage` POST in this browser session. Our extension does not depend on that dynamic API.

**Plugin implications:** Extract a sprite thumbnail and its crop offset from each `#gdt a > div[style]` regardless of the container's own class, keeping page order. Expose `@x=left-right&y=top-bottom` crop keys to VeneraNext as documented by its comic-source guide. Continue to resolve full-size image URLs lazily per `/s/` page, with its own Referer. Do not download the full gallery upfront. Keep multipart overview pages in original reading order.

### ExHentai without authentication

Visiting `https://exhentai.org/` without a session went through HTTP `302` redirects involving the forum's remote API and `?poni=no`. It ultimately responded with HTTP `200` but the browser displayed an **empty HTML body** (`<html><head></head><body></body></html>`). A `200` status by itself is therefore not proof of permission to view ExHentai. The updated adapter reports an actionable login/access-permission error rather than silently presenting an empty list. No attempt was made to log in or alter access controls.

## Applied source changes (v2.1.0)

1. `nhentai.js`: interpret live `tag_ids` for known language identifiers while preserving existing `key`, IDs and browsing routes.
2. `ehentai.js`: normalize CSS-sprite gallery thumbnails across observed gallery modes; expose gallery-detail thumbnails using the same extractor; preserve crop position and page ordering.
3. `ehentai.js`: detect unauthenticated/blank ExHentai pages, correct rating options to values actually present in site UI, and support favorite-folder sprite metadata on `#fav` itself.
4. Reject unsupported `data:`, `blob:`, etc. pseudo-URLs rather than turning them into incorrect relative HTTP URLs.
5. `index.json` and docs: synchronize source versions and record this evidence; keep source keys stable.
6. Regression tests: add sanitized fixture tests for the actual nhentai list schema, CSS sprite positions and boundaries, ExHentai blank pages and real rating options.

## Validation and remaining gaps

- `node --check` of both sources and the test file, plus all **29 offline tests**, passed locally (20 earlier tests + 9 new cases).
- Real browser evidence covers API, document DOM, navigation, request statuses, and JS source; it does **not** prove the VeneraNext QuickJS/HtmlDocument runtime behaves identically to Chrome for every selector.
- Need to test installation, search options, page-thumbnails crop rendering, first/last reading page, download, image failures, language sorting, account login, online favorites, and source-update behaviour **inside the actual VeneraNext app**.
- The remote sites may change their markup, CDN, security rules, routes or authorization. A site-side 403/429/401 is a distinct diagnosis from a parser bug.

For reported failures, capture a redacted network response status, source version, relevant route (strip cookies, tokens and private query values), and a minimal redacted DOM fragment. Do not commit media files, copyrighted image bytes, credentials, CAPTCHA responses or session tokens.
