# Leaflet 1.9.4 (vendored)

`leaflet.js` and `leaflet.css` are the unmodified `dist/` files of
[Leaflet](https://leafletjs.com) 1.9.4, served from this repo so the page no
longer depends on unpkg being up (a failed CDN load used to stop the whole
forecast from loading). `LICENSE` is Leaflet's BSD 2-Clause license.

Provenance, checked 2026-10-01: byte-identical copies from
`https://unpkg.com/leaflet@1.9.4/dist/` and
`https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/`.

| File | Bytes | md5 |
|---|---|---|
| `leaflet.js` | 147552 | `35b48eb991f383702f153452506e07b2` |
| `leaflet.css` | 14806 | `c02c12fe5e21d2493070649584ca38b7` |

The app only uses `L.divIcon` markers, so Leaflet's `images/` folder is not
needed. `tests/unit/w1-boot.test.js` checks these hashes.
