export function isRenderedMarkdownFile(filePath: string): boolean {
  const normalizedPath = filePath.trim().toLowerCase();
  return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

export type MarkdownRenderMode = "preview" | "source";

export function shouldRenderMarkdownPreview(input: {
  filePath: string;
  lineStart?: number;
  mode: MarkdownRenderMode;
}): boolean {
  return input.mode === "preview" && !input.lineStart && isRenderedMarkdownFile(input.filePath);
}
