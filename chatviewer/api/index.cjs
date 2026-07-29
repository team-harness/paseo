const { createHmac, randomUUID } = require("node:crypto");

const MAX_REQUEST_BYTES = 16 * 1024;
const UPLOAD_TTL_SECONDS = 10 * 60;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES)
    throw new HttpError(413, "Request body is too large");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function requireJsonContentType(request) {
  const headers = request.headers ?? {};
  const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, "Content-Type must be application/json");
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

function isHistoryId(id) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
}

function historyKeyForId(id) {
  return `history/${id}.json`;
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

function createViewerUrl(key) {
  const id = key.match(/^history\/([0-9a-f-]+)\.json$/i)?.[1];
  const viewer = new URL(env("CHAT_SHARE_VIEWER_ORIGIN"));
  if (id && isHistoryId(id)) viewer.searchParams.set("id", id);
  else viewer.searchParams.set("history", key);
  return viewer.toString();
}

function createUploadGrant(request) {
  requireJsonContentType(request);
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
  if (method !== "POST" || path !== "/v1/upload-grant") return json(404, { error: "Not found" });
  try {
    return createUploadGrant(request);
  } catch (error) {
    return json(error instanceof HttpError ? error.status : 500, {
      error: errorMessage(error, "Unable to create upload grant"),
    });
  }
}

module.exports = {
  handler,
  createPresignedPutUrl,
  createViewerUrl,
  historyKeyForId,
  isHistoryId,
};
