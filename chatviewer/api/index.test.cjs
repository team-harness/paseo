const test = require("node:test");
const assert = require("node:assert/strict");
const { createPresignedPutUrl, createViewerUrl, handler, isHistoryKey } = require("./index.cjs");

test("returns a Licell HTTP response from the health endpoint", async () => {
  const response = await handler({ rawPath: "/health", httpMethod: "GET" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("creates a time-limited PUT URL for exactly one history object", () => {
  const url = new URL(
    createPresignedPutUrl({
      bucket: "paseo-chat-history",
      region: "cn-shanghai",
      key: "history/2026-07-28/share id.json",
      accessKeyId: "test-key",
      accessKeySecret: "test-secret",
      expiresAt: 1_785_198_400,
    }),
  );

  assert.equal(url.hostname, "paseo-chat-history.oss-cn-shanghai.aliyuncs.com");
  assert.equal(url.pathname, "/history/2026-07-28/share%20id.json");
  assert.equal(url.searchParams.get("OSSAccessKeyId"), "test-key");
  assert.equal(url.searchParams.get("Expires"), "1785198400");
  assert.ok(url.searchParams.get("Signature"));
});

test("only accepts generated history object keys for the read proxy", () => {
  assert.equal(isHistoryKey("history/2026-07-28/7b853015-bf1a-4c4c-b969-14e1247aef85.json"), true);
  assert.equal(isHistoryKey("history/../../private.json"), false);
  assert.equal(isHistoryKey("other/2026-07-28/7b853015-bf1a-4c4c-b969-14e1247aef85.json"), false);
});

test("returns a Viewer URL containing only the history object key", () => {
  const previousViewerOrigin = process.env.CHAT_SHARE_VIEWER_ORIGIN;
  process.env.CHAT_SHARE_VIEWER_ORIGIN = "https://paseo-chat.bazhuayu.xyz/";
  try {
    const url = new URL(createViewerUrl("history/2026-07-28/example.json"));
    assert.equal(url.origin, "https://paseo-chat.bazhuayu.xyz");
    assert.equal(url.searchParams.get("history"), "history/2026-07-28/example.json");
  } finally {
    if (previousViewerOrigin === undefined) delete process.env.CHAT_SHARE_VIEWER_ORIGIN;
    else process.env.CHAT_SHARE_VIEWER_ORIGIN = previousViewerOrigin;
  }
});
