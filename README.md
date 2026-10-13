# VeneraNext Comic Source Repository

A lightweight, independently maintained source catalog for [Venera-Next](https://github.com/CyrilPeng/Venera-Next). It currently contains **two JavaScript extensions**: `nhentai` and `E-Hentai`.

This repository distributes source scripts only. It does not store or redistribute any comics or images and is not affiliated with VeneraNext or either website.

## Install

In VeneraNext, open the comic source manager and import the repository using this catalog URL:

```text
https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/index.json
```

If your app version only accepts individual JavaScript sources, import the raw source URLs directly:

- [nhentai.js](https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/nhentai.js)
- [ehentai.js](https://raw.githubusercontent.com/MoYangking/venera_comic_js/main/ehentai.js)

VeneraNext's unreleased main branch supports the repository catalog interface described in its current documentation. Older stable builds may use a different import screen. The catalog's `fileName` entries resolve relative to the catalog URL.

## Supported features

| Feature | nhentai.net | e-hentai.org |
| --- | --- | --- |
| Latest galleries | Yes | Yes |
| Popular | Search sort options | Yes |
| Search | Yes, paged | Yes, cursor-paged |
| Gallery details and tags | Yes | Yes |
| Reading and image request headers | Yes | Yes |
| Account login / online favorites | Not implemented | Not implemented |
| Reader-provided local favorites and downloads | Supported by reader | Supported by reader |

Both scripts use Venera's stable keys (`nhentai` and `ehentai`). You cannot install them side-by-side with another source using the same key: review existing source versions before replacing them.

## Files

- `index.json` - source catalog for repository-based import.
- `nhentai.js` - nhentai API v2 adapter.
- `ehentai.js` - E-Hentai HTML adapter with lazy full-image resolution.
- `tests/` - deterministic, offline source-contract tests.

## Troubleshooting

- **403 / 429 / HTML challenge:** the remote website denied a request; scripts do not bypass CAPTCHAs, rate limits, paywalls, or access restrictions. Check ordinary site availability in the app network environment, or configure the app's own permitted proxy settings.
- **Empty listings:** HTML markup/API response may have changed. Open a GitHub issue with the operation name, HTTP status, and a redacted, non-sensitive error message.
- **Images fail:** check the app's image cache and connectivity; E-Hentai resolves each image's actual URL from its image page when requested.
- **Existing script not updating:** compare `key`, `version`, and update URLs. These new adapters deliberately begin at `1.0.0` and are not claimed to replace every feature in older official scripts.

## Development

Requirements for offline checks: Node.js 18+ (no npm dependencies).

```sh
npm test
```

Before publishing updates, verify *on an actual VeneraNext build* the source import, listing, search, detail, the first and last gallery pages, thumbnail rendering, and full image loading. Website access may differ across networks and accounts. Update `version` in both the `.js` and `index.json` files together.

Useful references: [VeneraNext comic source guide](https://github.com/CyrilPeng/Venera-Next/blob/main/doc/api/comic_source.zh.md), [VeneraNext JavaScript API](https://github.com/CyrilPeng/Venera-Next/blob/main/doc/api/js.zh.md), [upstream example catalog](https://github.com/venera-app/venera-configs), [community catalog](https://github.com/handahao666-boop/venera_comic_source).

## Notice

Use these scripts only where you are legally permitted to access the remote services and content. Websites and their operators are solely responsible for the material they serve. Do not file website-content issues with the VeneraNext reader project.