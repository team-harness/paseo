const { createHmac, randomUUID } = require("node:crypto");

const MAX_REQUEST_BYTES = 16 * 1024;
const UPLOAD_TTL_SECONDS = 5 * 60;

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function json(status, value) {
  return {
    statusCode: status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(value),
  };
}

function empty(status) {
  return {
    statusCode: status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  };
}

function readJson(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new Error("Request body is too large");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function createPresignedPutUrl({ bucket, region, key, accessKeyId, accessKeySecret, expiresAt }) {
  const resource = `/${bucket}/${key}`;
  const stringToSign = ["PUT", "", "application/json", String(expiresAt), resource].join("\n");
  const signature = createHmac("sha1", accessKeySecret).update(stringToSign).digest("base64");
  const query = new URLSearchParams({
    OSSAccessKeyId: accessKeyId,
    Expires: String(expiresAt),
    Signature: signature,
  });
  return `https://${bucket}.oss-${region}.aliyuncs.com/${encodeObjectKey(key)}?${query.toString()}`;
}

function isHistoryKey(key) {
  return /^history\/(?:\d{4}-\d{2}-\d{2}\/)?[0-9a-f-]+\.json$/i.test(key);
}

function isHistoryId(id) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
}

function historyKeyForId(id) {
  return `history/${id}.json`;
}

function historyKeyFromQuery(query) {
  const id = query?.id;
  if (id) return isHistoryId(id) ? historyKeyForId(id) : "";
  return query?.key ?? "";
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

async function handleHistory(key) {
  if (!isHistoryKey(key)) return json(400, { error: "Invalid history key" });
  try {
    const bucket = env("CHAT_SHARE_OSS_BUCKET");
    const region = env("CHAT_SHARE_OSS_REGION");
    const historyUrl = `https://${bucket}.oss-${region}.aliyuncs.com/${encodeObjectKey(key)}`;
    const response = await fetch(historyUrl);
    if (!response.ok)
      return json(response.status === 404 ? 404 : 502, { error: "History unavailable" });
    return json(200, await response.json());
  } catch (error) {
    return json(500, { error: errorMessage(error, "Unable to load history") });
  }
}

function createViewerUrl(key) {
  const id = key.match(/^history\/([0-9a-f-]+)\.json$/i)?.[1];
  const viewer = new URL(env("CHAT_SHARE_VIEWER_ORIGIN"));
  if (id && isHistoryId(id)) viewer.searchParams.set("id", id);
  else viewer.searchParams.set("history", key);
  return viewer.toString();
}

function createUploadGrant(request) {
  const body = readJson(request);
  if (body.schemaVersion !== 1) return json(400, { error: "Unsupported history schema" });

  const bucket = env("CHAT_SHARE_OSS_BUCKET");
  const region = env("CHAT_SHARE_OSS_REGION");
  const key = historyKeyForId(randomUUID());
  const expiresAt = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
  const historyUrl = `https://${bucket}.oss-${region}.aliyuncs.com/${encodeObjectKey(key)}`;
  const uploadUrl = createPresignedPutUrl({
    bucket,
    region,
    key,
    accessKeyId: env("CHAT_SHARE_OSS_ACCESS_KEY_ID"),
    accessKeySecret: env("CHAT_SHARE_OSS_ACCESS_KEY_SECRET"),
    expiresAt,
  });
  return json(200, {
    upload: {
      method: "PUT",
      url: uploadUrl,
      headers: { "content-type": "application/json" },
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    },
    historyUrl,
    viewerUrl: createViewerUrl(key),
  });
}

async function handler(request) {
  const path = request.rawPath ?? request.path ?? "/";
  const method = request.httpMethod ?? request.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") return empty(204);
  if (method === "GET" && (path === "/health" || path === "/healthz"))
    return json(200, { ok: true });
  if (method === "GET" && path === "/v1/history") {
    return handleHistory(historyKeyFromQuery(request.queryParameters));
  }
  if (method !== "POST" || path !== "/v1/upload-grant") return json(404, { error: "Not found" });
  try {
    return createUploadGrant(request);
  } catch (error) {
    return json(500, { error: errorMessage(error, "Unable to create upload grant") });
  }
}

module.exports = {
  handler,
  createPresignedPutUrl,
  createViewerUrl,
  historyKeyForId,
  historyKeyFromQuery,
  isHistoryId,
  isHistoryKey,
};
