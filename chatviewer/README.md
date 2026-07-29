# Paseo Chat Viewer

`chatviewer` is a self-hostable, read-only viewer and upload API for
`paseo-chat-history@v1`. It is intentionally independent of the Paseo daemon,
desktop app, Licell, credentials, and any specific cloud vendor.

It has one portable API contract and three deployment targets: Void file-based
routes with Void Object Storage, a Cloudflare Worker with R2, or Alibaba Cloud
Function Compute with OSS. Paseo clients only need the deployed public URL and
do not need to distinguish the provider.

## Deploy with Void

```bash
cd chatviewer
npm install
npx void init
npm run deploy:void
```

During Void setup, bind Object Storage as `STORAGE`. The API uses only this
binding; storage credentials never reach Paseo clients. `void deploy` prints
the application URL, for example `https://my-paseo-share.void.app`.

## Deploy with Cloudflare

Cloudflare uses Workers Assets for the Vite viewer and R2 for shared JSON. The
first login opens a browser and authorizes Wrangler for the Cloudflare account
that will own the Worker and bucket:

```bash
cd chatviewer
npm install
npx wrangler login
npx wrangler whoami
npx wrangler r2 bucket create paseo-chat-shares
npm run deploy:cloudflare
```

`wrangler.jsonc` binds `paseo-chat-shares` as `CHAT_SHARES`; use another bucket
name only if you update that binding before deployment. The final command prints
the public `*.workers.dev` URL. To use a custom domain, add it to the Worker in
the Cloudflare dashboard after deployment. Do not put an API token, account ID,
or bucket credential in this repository.

## Deploy with Alibaba Cloud FC and OSS

The FC target packages the Viewer into the HTTP function and stores histories in
a private OSS bucket. FC serves both the viewer and API from one origin, so the
same `baseUrl` configuration works without exposing an OSS endpoint.

```bash
cd chatviewer
npm install
npm run build:fc
cd fc
licell login
licell workspace init --type api --app paseo-chat-fc --runtime nodejs22 \
  --entry dist/index.cjs --target prod --disable-vpc --region cn-shanghai
licell oss create paseo-chat-shares-your-name --acl private --public-access-block on
licell env set CHAT_SHARE_OSS_BUCKET paseo-chat-shares-your-name
licell env set CHAT_SHARE_OSS_REGION cn-shanghai
licell env set CHAT_SHARE_OSS_ACCESS_KEY_ID <ram-access-key-id>
licell env set CHAT_SHARE_OSS_ACCESS_KEY_SECRET <ram-access-key-secret>
cd ..
npm run deploy:fc
```

Use a dedicated RAM principal with only `GetObject` and `PutObject` permission
for the `shares/` prefix of that bucket. The function validates each history
before it writes to OSS and proxies reads, so the bucket must remain private.
Licell saves local deployment state under `fc/.licell/`; it is ignored by Git.
`npm run deploy:fc` prints the FC URL. A custom domain can be bound with Licell
after the first deployment; configure that public function domain as `baseUrl`.

## Configure Paseo

Paseo uses `https://paseo-share.team-harness.com` when no sharing service is
configured. To use any self-hosted deployment instead, add its public URL to
the host daemon configuration at `~/.paseo/config.json`, then restart the
daemon through your normal host workflow:

```json
{
  "version": 1,
  "daemon": {
    "chatShare": {
      "baseUrl": "https://my-paseo-share.workers.dev"
    }
  }
}
```

The daemon publishes only this public base URL to connected clients. It never
publishes a cloud credential, an object-storage URL, or a deployment secret.
An explicit `chatShare` entry always overrides the hosted default.

## API Contract

The app and the viewer use the same origin:

```text
POST /api/v1/shares       -> { "id": "<uuid>" }
GET  /api/v1/shares/:id   -> paseo-chat-history@v1 JSON
Viewer                    -> /?id=<uuid>
```

`POST` accepts only `application/json` requests up to 5 MiB that strictly
match [the portable history schema](./schema/paseo-chat-history.v1.schema.json).
The API stores each history as `shares/<uuid>.json`; it cannot be used to
write an arbitrary object key or file type. Configure request-rate limits at
your hosting edge when the service is exposed beyond a trusted audience.

The viewer treats transcript text as untrusted: Markdown escapes raw HTML,
unsafe links are labels, and assistant copy actions copy the original Markdown.
User-message anchors use `#message-<entry-id>`.

This template deliberately does not resolve the old fork-specific `?history=`
URLs. Existing deployments can continue serving those historic links, while
new self-hosted deployments use only stable `?id=<uuid>` links.
