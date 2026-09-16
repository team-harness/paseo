import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { z } from "zod";
import { resolveExplorerFilePath } from "../file-explorer/service.js";

// Threadshare owns this contract: docs/document-sharing-guide.md and
// src/document-command.mjs in team-harness/threadshare. Markdown stays verbatim.
const MARKDOWN_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const TOTAL_LIMIT = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uploadSchema = z.object({
  id: z.string().regex(UUID),
  uploadToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const publishedSchema = z.object({
  id: z.string(),
  revision: z.string(),
  expiresAt: z.null(),
  revocable: z.literal(false),
});
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

interface DocumentInput {
  cwd: string;
  path: string;
  content: string;
}
interface Asset {
  source: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

function inspectImages(tokens: Token[]): void {
  for (const token of tokens) {
    if (
      (token.type === "html_inline" || token.type === "html_block") &&
      /<img\b/i.test(token.content)
    ) {
      throw new Error("HTML images are not supported; use Markdown images");
    }
    if (token.type === "image") {
      const source = token.attrGet("src") ?? "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^https?:\/\//i.test(source))
        throw new Error("Only relative local images and HTTP(S) images are supported");
    }
    if (token.children) inspectImages(token.children);
  }
}

function collectImages(tokens: Token[], images: Set<string>): void {
  for (const token of tokens) {
    // Match Threadshare's image renderer: alt text is not rendered recursively.
    if (token.type === "image") images.add(token.attrGet("src") ?? "");
    else if (token.children) collectImages(token.children, images);
  }
}

function imageType(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  throw new Error("Only PNG, JPEG, GIF and WebP images are supported");
}

async function readImage(file: string): Promise<Buffer> {
  const flags =
    process.platform === "win32"
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(file, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0 || before.size > BigInt(IMAGE_LIMIT))
      throw new Error("Images must be regular files of at most 4 MiB");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("Image changed while reading; retry sharing");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error("Image changed while reading; retry sharing");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function prepareDocumentShare(input: DocumentInput) {
  const markdown = Buffer.from(input.content, "utf8");
  if (!markdown.length || markdown.length > MARKDOWN_LIMIT)
    throw new Error("Markdown must be non-empty and at most 1 MiB");
  if (!/\.(md|markdown)$/i.test(input.path))
    throw new Error("Only Markdown documents can be shared");
  const file = await realpath(
    await resolveExplorerFilePath({ root: input.cwd, relativePath: input.path }),
  );
  const root = path.dirname(file);
  const inspector = new MarkdownIt({ html: true });
  // Inspect unsafe destinations too, instead of silently dropping their images.
  inspector.validateLink = () => true;
  inspectImages(inspector.parse(input.content, {}));
  // The published renderer treats HTML as text, including Markdown inside HTML blocks.
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const tokens = md.parse(input.content, {});
  const sources = new Set<string>();
  collectImages(tokens, sources);
  const assets: Asset[] = [];
  const images = new Map<string, Buffer>();
  let total = markdown.length;
  for (const source of sources) {
    if (source.length > 2048) throw new Error("Image path is too long");
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      if (url.username || url.password) throw new Error("Image URLs cannot contain credentials");
      continue;
    }
    if (assets.length >= 32) throw new Error("At most 32 local image references are supported");
    const decoded = decodeURIComponent(source);
    if (
      !decoded ||
      decoded.includes("\0") ||
      /[?#\\]/.test(decoded) ||
      /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(decoded)
    )
      throw new Error("Use relative local image paths without query strings");
    const imagePath = await realpath(path.resolve(root, decoded));
    const relative = path.relative(root, imagePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(
        "Image escapes the document directory; move it alongside the document or into a subdirectory",
      );
    const bytes = await readImage(imagePath);
    const sha256 = digest(bytes);
    const contentType = imageType(bytes);
    if (!images.has(sha256)) total += bytes.length;
    if (total > TOTAL_LIMIT) throw new Error("Document and images exceed 32 MiB");
    images.set(sha256, bytes);
    assets.push({ source, sha256, bytes: bytes.length, contentType });
  }
  return {
    declaration: {
      title: documentTitle(tokens, input.path),
      markdown: { sha256: digest(markdown), bytes: markdown.length },
      assets,
    },
    markdown,
    images,
  };
}

function documentTitle(tokens: Token[], filePath: string): string {
  const heading = tokens.findIndex((token) => token.type === "heading_open" && token.tag === "h1");
  const title = (
    (heading >= 0
      ? tokens[heading + 1]?.children
          ?.map((token) => token.content)
          .join("")
          .trim()
      : null) ||
    path.basename(filePath, path.extname(filePath)).trim() ||
    "Document"
  )
    .slice(0, 200)
    .replace(/[\uD800-\uDBFF]$/, "");
  return title;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty Threadshare response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 32768) throw new Error("Threadshare response exceeds limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function requireOk(response: Response): Promise<void> {
  if (response.ok) return;
  const payload = await readJson(response).catch(() => null);
  const parsed = z.object({ error: z.string() }).safeParse(payload);
  throw new Error(
    `Threadshare HTTP ${response.status}: ${parsed.success ? parsed.data.error.slice(0, 500) : response.statusText}`,
  );
}

export async function shareDocument(
  input: DocumentInput & { baseUrl: string; fetchImpl?: typeof fetch },
): Promise<{ url: string }> {
  const endpoint = new URL(input.baseUrl);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid Threadshare service URL");
  const prepared = await prepareDocumentShare(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  // One deadline for the whole upload, shorter than the client's RPC timeout.
  const signal = AbortSignal.timeout(120_000);
  const base = `${endpoint.origin}/api/v1/documents`;
  const request = (url: string, init: RequestInit) =>
    fetchImpl(url, { ...init, signal, redirect: "error" });
  const start = await request(`${base}/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(prepared.declaration),
  });
  await requireOk(start);
  const upload = uploadSchema.parse(await readJson(start));
  const authorization = `Bearer ${upload.uploadToken}`;
  const put = async (suffix: string, body: Buffer, type: string) => {
    const response = await request(`${base}/${upload.id}/uploads/${suffix}`, {
      method: "PUT",
      headers: { authorization, "content-type": type },
      body: new Uint8Array(body),
    });
    await requireOk(response);
    if (response.status !== 204) {
      await response.body?.cancel();
      throw new Error(`Unexpected upload response: ${response.status}`);
    }
  };
  await put("markdown", prepared.markdown, "text/markdown; charset=utf-8");
  for (const [sha256, bytes] of prepared.images) {
    const asset = prepared.declaration.assets.find((item) => item.sha256 === sha256)!;
    await put(`assets/${sha256}`, bytes, asset.contentType);
  }
  const url = `${endpoint.origin}/document.html?id=${upload.id}`;
  try {
    const response = await request(`${base}/${upload.id}/publish`, {
      method: "POST",
      headers: { authorization },
    });
    await requireOk(response);
    const published = publishedSchema.parse(await readJson(response));
    const revision = digest(
      JSON.stringify({
        markdown: prepared.declaration.markdown,
        assets: prepared.declaration.assets,
        renderer: "document-renderer@1",
        textVersion: "document-anchor-text@1",
      }),
    );
    if (published.id !== upload.id || published.revision !== revision)
      throw new Error("Publication revision mismatch");
  } catch (error) {
    // A lost response can follow a successful publish. Never create a second upload automatically.
    throw new Error(
      `Document publication was not confirmed. Check ${url} before sharing again. ${error instanceof Error ? error.message : ""}`,
      { cause: error },
    );
  }
  return { url };
}
