import { describe, expect, it } from "vitest";
import {
  isRenderedMarkdownFile,
  shouldRenderMarkdownPreview,
} from "@/components/file-pane-render-mode";

describe("isRenderedMarkdownFile", () => {
  it("detects .md files", () => {
    expect(isRenderedMarkdownFile("README.md")).toBe(true);
    expect(isRenderedMarkdownFile("docs/guide.MD")).toBe(true);
  });

  it("detects .markdown files", () => {
    expect(isRenderedMarkdownFile("notes.markdown")).toBe(true);
    expect(isRenderedMarkdownFile("docs/CHANGELOG.MARKDOWN")).toBe(true);
  });

  it("renders markdown in preview mode by default", () => {
    expect(
      shouldRenderMarkdownPreview({
        filePath: "README.md",
        mode: "preview",
      }),
    ).toBe(true);
  });

  it("does not treat .mdx files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("page.mdx")).toBe(false);
  });

  it("does not treat other text files as rendered markdown", () => {
    expect(isRenderedMarkdownFile("src/index.ts")).toBe(false);
    expect(isRenderedMarkdownFile("README.md.txt")).toBe(false);
  });

  it("renders markdown source when the user switches away from preview", () => {
    expect(
      shouldRenderMarkdownPreview({
        filePath: "README.md",
        mode: "source",
      }),
    ).toBe(false);
  });

  it("keeps line-targeted markdown in the source view", () => {
    expect(
      shouldRenderMarkdownPreview({
        filePath: "README.md",
        lineStart: 12,
        mode: "preview",
      }),
    ).toBe(false);
  });
});
