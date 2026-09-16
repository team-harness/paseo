import { createHash } from "node:crypto";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { prepareDocumentShare, shareDocument } from "./service.js";

const roots: string[] = [];
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z9sAAAAASUVORK5CYII=",
  "base64",
);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "paseo-document-share-"));
  roots.push(cwd);
  await writeFile(path.join(cwd, "review.md"), "old disk content");
  await writeFile(path.join(cwd, "image.png"), image);
  return { cwd, path: "review.md" };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Threadshare document integration", () => {
  test.each([
    "<!-- ![old](image.png) -->",
    '<p align="center">\n![logo](image.png)\n</p>',
    "<details>\n![x](image.png)\n</details>",
    "![![alt](missing.png)](image.png)",
  ])(
    "matches Threadshare image rendering for HTML blocks and nested alt text: %s",
    async (content) => {
      const prepared = await prepareDocumentShare({ ...(await fixture()), content });
      expect(prepared.declaration.assets.map((asset) => asset.source)).toEqual(["image.png"]);
    },
  );

  test("freezes the visible Markdown and deduplicates inline/reference images, leaving remote images unfetched", async () => {
    const file = await fixture();
    const content =
      "# 当前编辑内容\n![a](image.png)\n![b][pic]\n[pic]: image.png\n![c](https://example.com/image.png)\n`![code](missing.png)`";
    const prepared = await prepareDocumentShare({ ...file, content });
    await writeFile(path.join(file.cwd, "image.png"), "changed after snapshot");
    expect(prepared.markdown.toString()).toBe(content);
    expect(prepared.declaration).toEqual({
      title: "当前编辑内容",
      markdown: { sha256: hash(content), bytes: Buffer.byteLength(content) },
      assets: [
        { source: "image.png", sha256: hash(image), bytes: image.length, contentType: "image/png" },
      ],
    });
    expect([...prepared.images.values()]).toEqual([image]);
  });

  test.each([
    "../outside.png",
    "%2e%2e/outside.png",
    "file:///tmp/image.png",
    "data:image/png;base64,AAAA",
    "image.png?token=x",
    "https://user:pass@example.com/x.png",
  ])("rejects unsafe image source %s before uploading", async (source) => {
    await expect(
      prepareDocumentShare({ ...(await fixture()), content: `![x](${source})` }),
    ).rejects.toThrow();
  });

  test("rejects symlinks escaping the document directory", async () => {
    const file = await fixture();
    const outside = await fixture();
    await symlink(path.join(outside.cwd, "image.png"), path.join(file.cwd, "escape.png"));
    await expect(prepareDocumentShare({ ...file, content: "![x](escape.png)" })).rejects.toThrow(
      /outside|escape/i,
    );
  });

  test.each([
    "![x](missing.png)",
    "<img src='image.png'>",
    "![x](bad.svg)",
    "x".repeat(1024 * 1024 + 1),
  ])("rejects missing or unsupported content", async (content) => {
    const file = await fixture();
    await writeFile(path.join(file.cwd, "bad.svg"), "<svg/>");
    await expect(prepareDocumentShare({ ...file, content })).rejects.toThrow();
  });

  test("uploads binary snapshots in order then verifies publication revision", async () => {
    const file = await fixture();
    const content = "# Review\n![x](image.png)";
    const prepared = await prepareDocumentShare({ ...file, content });
    const id = "7b853015-bf1a-4c4c-b969-14e1247aef85";
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/uploads"))
        return Response.json({ id, uploadToken: "a".repeat(43) });
      if (init.method === "PUT") return new Response(null, { status: 204 });
      return Response.json({
        id,
        expiresAt: null,
        revocable: false,
        revision: hash(
          JSON.stringify({
            markdown: prepared.declaration.markdown,
            assets: prepared.declaration.assets,
            renderer: "document-renderer@1",
            textVersion: "document-anchor-text@1",
          }),
        ),
      });
    };
    await expect(
      shareDocument({ ...file, content, baseUrl: "https://share.example.com/", fetchImpl }),
    ).resolves.toEqual({ url: `https://share.example.com/document.html?id=${id}` });
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ["https://share.example.com/api/v1/documents/uploads", "POST"],
      [`https://share.example.com/api/v1/documents/${id}/uploads/markdown`, "PUT"],
      [`https://share.example.com/api/v1/documents/${id}/uploads/assets/${hash(image)}`, "PUT"],
      [`https://share.example.com/api/v1/documents/${id}/publish`, "POST"],
    ]);
    expect(calls[1].init.body).toEqual(new Uint8Array(Buffer.from(content)));
    expect(calls[2].init.body).toEqual(new Uint8Array(image));
    expect(calls.every((c) => c.init.redirect === "error")).toBe(true);
  });

  test("enforces byte and local image count limits before making requests", async () => {
    const file = await fixture();
    await expect(prepareDocumentShare({ ...file, content: "字".repeat(400000) })).rejects.toThrow(
      "1 MiB",
    );
    await writeFile(path.join(file.cwd, "large.png"), Buffer.alloc(4 * 1024 * 1024 + 1));
    await expect(prepareDocumentShare({ ...file, content: "![x](large.png)" })).rejects.toThrow(
      "4 MiB",
    );
    const names = Array.from({ length: 33 }, (_, i) => `image-${i}.png`);
    await Promise.all(names.map((name) => writeFile(path.join(file.cwd, name), image)));
    await expect(
      prepareDocumentShare({ ...file, content: names.map((name) => `![x](${name})`).join("\n") }),
    ).rejects.toThrow("32 local image");
  });

  test("preserves the candidate URL and never retries an uncertain publish", async () => {
    const calls: string[] = [];
    const id = "7b853015-bf1a-4c4c-b969-14e1247aef85";
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/uploads"))
        return Response.json({ id, uploadToken: "a".repeat(43) });
      if (String(url).endsWith("/markdown")) return new Response(null, { status: 204 });
      throw new Error("Connection lost");
    };
    await expect(
      shareDocument({
        ...(await fixture()),
        content: "# Review",
        baseUrl: "https://share.example.com",
        fetchImpl,
      }),
    ).rejects.toThrow(
      `Check https://share.example.com/document.html?id=${id} before sharing again`,
    );
    expect(calls).toHaveLength(3);
  });

  test("does not publish or retry when an image upload fails", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/uploads"))
        return Response.json({
          id: "7b853015-bf1a-4c4c-b969-14e1247aef85",
          uploadToken: "a".repeat(43),
        });
      if (String(url).endsWith("/markdown")) return new Response(null, { status: 204 });
      return Response.json({ error: "Image rejected" }, { status: 413 });
    };
    await expect(
      shareDocument({
        ...(await fixture()),
        content: "![x](image.png)",
        baseUrl: "https://share.example.com",
        fetchImpl,
      }),
    ).rejects.toThrow("Image rejected");
    expect(calls).toHaveLength(3);
  });
});
