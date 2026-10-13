# Changelog

## 2.1.0 - 2026-10-13

- Correct gallery preview extraction for current CSS-sprite layouts.
- Preserve thumbnails and reading order across multiple gallery pages.
- Improve handling of list-language metadata and unavailable account-only pages.
- Align search rating options with the inspected website.
- Add nine browser-evidence-based regression tests (29 total).
- Document HTTP, DOM, pagination and client limitations in `docs/live-site-findings.md`.


## 2.0.0 — 2026-10-13

- Keep stable source keys `nhentai` and `ehentai` and stable existing gallery IDs.
- nhentai: add popular exploration, rankings, language-filtered search, tag navigation, optional API authentication, web login and network favorites.
- E-Hentai: support all four upstream gallery list modes, cursor paging, advanced search, ranking, watched galleries, alternate domain, account login, multi-folder favorites, paginated thumbnails and image re-resolution.
- VeneraNext: use plain-object `ComicDetails.tags`, null chapters for galleries and VeneraNext-compatible catalog/updating metadata.
- Improve URL origin validation, image referers, HTTP error messages and offline test coverage.
- Verification: offline tests; full live site and app integration not verified in this environment.

## 1.0.0 — 2026-10-13

- Initial two-source catalog and minimal search/detail/reading support.
