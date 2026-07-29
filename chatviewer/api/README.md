# Paseo Chat Upload API

The FC handler exposes two endpoints:

- `GET /health`
- `POST /v1/upload-grant`

`POST /v1/upload-grant` accepts `{ "schemaVersion": 1 }` and returns a ten-minute pre-signed OSS `PUT` URL for one generated `history/<uuid>.json` object. The signature requires `Content-Type: application/json`, so it cannot write a different object path or content type. Paseo uploads the exported history directly to that URL, then opens the returned `viewerUrl`; its `id` query parameter contains only the generated UUID. The API does not receive, proxy, or persist chat contents.

## Required FC environment

```text
CHAT_SHARE_OSS_BUCKET=
CHAT_SHARE_OSS_REGION=cn-shanghai
CHAT_SHARE_OSS_ACCESS_KEY_ID=
CHAT_SHARE_OSS_ACCESS_KEY_SECRET=
CHAT_SHARE_VIEWER_ORIGIN=https://paseo-chat.bazhuayu.xyz/
```

The OSS RAM credentials must be restricted to `PutObject` for the `history/` prefix. The history bucket needs public read access for `history/` objects and CORS permission for `PUT` with the `content-type` header so Paseo clients can upload directly. The Viewer derives the object path from the share ID and reads it from OSS without going through FC.
