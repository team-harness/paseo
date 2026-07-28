# Paseo Chat Viewer

This is a standalone, static, read-only viewer for `paseo-chat-history@v1` files. It has no dependency on the Paseo daemon, Electron, or a local CLI.

## Contract

The public contract is [schema/paseo-chat-history.v1.schema.json](./schema/paseo-chat-history.v1.schema.json). A viewer URL accepts the public history object URL as an encoded query parameter:

```text
https://paseo-chat.bazhuayu.xyz/?history=https%3A%2F%2Fexample.oss-cn-shanghai.aliyuncs.com%2Fchat%2Fabc.json
```

When the Paseo upload API is used, the returned viewer URL reads through its restricted history proxy, so the viewer does not need direct cross-origin access to the history object. The viewer treats all transcript text as untrusted and never inserts exported values as HTML.

## Deployment

Run `npm run build` before uploading `dist/` to the viewer bucket. The
`paseo-chat` FC API issues a short-lived, single-object upload URL to the Paseo
client; the client uploads the JSON directly to OSS and then opens the returned
viewer URL.
