# Paseo Chat Viewer

This is a standalone, static, read-only viewer for `paseo-chat-history@v1` files. It has no dependency on the Paseo daemon, Electron, or a local CLI.

## Contract

The public contract is [schema/paseo-chat-history.v1.schema.json](./schema/paseo-chat-history.v1.schema.json). New Viewer URLs accept the generated history UUID as a query parameter:

```text
https://paseo-chat.bazhuayu.xyz/?id=7b853015-bf1a-4c4c-b969-14e1247aef85
```

The Viewer resolves this ID through the restricted share API. Previously issued URLs
that contain a `history` object key or a full read URL remain supported.

User messages can be linked directly by appending their anchor id to the URL. The
Viewer scrolls to the message after loading the history and briefly highlights it:

```text
https://paseo-chat.bazhuayu.xyz/?id=7b853015-bf1a-4c4c-b969-14e1247aef85#message-user-123
```

The `#` button beside a user message copies this URL.

When the Paseo upload API is used, the returned viewer URL contains only the generated
UUID and the Viewer reads through its restricted history proxy, so it does not need
direct cross-origin access to the history object. The viewer treats all transcript
text as untrusted and never inserts exported values as HTML.

## Deployment

Run `npm run build` before uploading `dist/` to the viewer bucket. The
`paseo-chat` FC API issues a short-lived, single-object upload URL to the Paseo
client; the client uploads the JSON directly to OSS and then opens the returned
viewer URL.
