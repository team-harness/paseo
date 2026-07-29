# Chatviewer Maintenance

`chatviewer` is a standalone, read-only web viewer and upload API for Paseo
shared transcripts. Keep it deployable without the Paseo daemon, desktop app,
Licell, credentials, or a personal domain.

## Public contract

- Viewer URLs are `/?id=<uuid>` and optional message anchors are
  `#message-<entry-id>`.
- `POST /api/v1/shares` accepts exactly one `paseo-chat-history@v1` JSON value
  and returns `{ "id": "<uuid>" }`.
- `GET /api/v1/shares/:id` returns that value or 404.
- Objects are always stored under `shares/<uuid>.json`. Do not accept client
  object keys, filenames, MIME types, redirects, or arbitrary files.
- Preserve the 5 MiB limit, strict Zod validation, JSON-only content type, and
  `no-store` responses. The viewer renders transcript text as untrusted input.

`src/share-schema.ts` and `src/share-api.ts` are shared by every deployment
target. Provider adapters may only implement routing and storage:

- Void routes live in `routes/api/v1/shares/` and use `void/storage`.
- Cloudflare uses `worker.ts`, Workers Assets, and the `CHAT_SHARES` R2 binding.
- Alibaba Cloud FC uses `fc/handler.ts`, packages the Viewer into the function,
  and accesses a private OSS bucket with its FC environment credentials.

Keep both adapters behaviorally equivalent. Any schema or API change must also
be reflected in `schema/paseo-chat-history.v1.schema.json`, the README, and
Paseo's export code and tests when applicable.

## Commands

```bash
cd chatviewer
npm install
npm run build:void
npm run build:cloudflare
npm run build:fc
npm run deploy:void
npm run deploy:cloudflare
npm run deploy:fc
```

Cloudflare deployment requires a logged-in Wrangler account and an existing R2
bucket whose name matches `wrangler.jsonc`. Create it once with
`npx wrangler r2 bucket create paseo-chat-shares`. Never commit Cloudflare API
tokens, account IDs, Void credentials, generated `.void/`, `.wrangler/`, or
deployment output.

For FC, `fc/.licell/`, `fc/dist/`, and `fc/static-assets.ts` are generated and
must remain untracked. The FC environment needs a least-privilege RAM key with
only `GetObject` and `PutObject` on `shares/`; keep the OSS bucket private.

## Verification

Run the target build after edits. For Cloudflare, use `npm run dev:cloudflare`
with a valid JSON upload, then verify the returned `id` can be read through the
same local API. Verify invalid content type, malformed JSON, oversized payloads,
and invalid IDs are rejected. Do not change the Paseo client to branch by cloud
provider: `daemon.chatShare.baseUrl` is the only deployment-specific setting.
When it is absent, Paseo uses the hosted `https://paseo-share.team-harness.com`
default; an explicit setting always overrides it.

For FC, run `npm run test:fc`; it builds the bundled function and verifies the
same-origin viewer plus strict upload and OSS read/write behavior using an
in-memory OSS transport.
