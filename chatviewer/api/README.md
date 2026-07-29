# Paseo Chat Upload API

The FC handler exposes two endpoints:

- `GET /health`
- `POST /v1/upload-grant`

`POST /v1/upload-grant` accepts `{ "schemaVersion": 1 }` and returns a five-minute pre-signed OSS `PUT` URL for one generated `history/<uuid>.json` object. Paseo uploads the exported history directly to that URL, then opens the returned `viewerUrl`; its `id` query parameter contains only the generated UUID. `GET /v1/history?id=<uuid>` is a CORS-safe read proxy that maps the UUID to its object key. `GET /v1/history?key=...` remains available for existing links. The API does not receive or persist chat contents.

## Required FC environment

```text
CHAT_SHARE_OSS_BUCKET=
CHAT_SHARE_OSS_REGION=cn-shanghai
CHAT_SHARE_OSS_ACCESS_KEY_ID=
CHAT_SHARE_OSS_ACCESS_KEY_SECRET=
CHAT_SHARE_VIEWER_ORIGIN=https://paseo-chat.bazhuayu.xyz/
```

The OSS RAM credentials must be restricted to `PutObject` for the `history/` prefix. The history bucket needs CORS permission for `PUT` with the `content-type` header so Paseo clients can upload directly; the viewer reads through the API's restricted proxy.
