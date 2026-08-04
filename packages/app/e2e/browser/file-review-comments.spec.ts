import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import {
  expectFileTabOpen,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";

async function selectPreviewText(page: Page, text: string, occurrence = 0): Promise<void> {
  const filePane = page.getByTestId("workspace-file-pane").filter({ visible: true });
  await filePane.evaluate(
    (element, selectionTarget) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const content = nodes.map((textNode) => textNode.textContent ?? "").join("");
      let start = -1;
      let searchFrom = 0;
      for (let index = 0; index <= selectionTarget.occurrence; index += 1) {
        start = content.indexOf(selectionTarget.text, searchFrom);
        if (start < 0) {
          throw new Error(
            `Could not find preview text occurrence ${selectionTarget.occurrence}: ${selectionTarget.text}`,
          );
        }
        searchFrom = start + selectionTarget.text.length;
      }
      const end = start + selectionTarget.text.length;
      let offset = 0;
      let startNode: Node | null = null;
      let startOffset = 0;
      let endNode: Node | null = null;
      let endOffset = 0;
      for (const textNode of nodes) {
        const length = textNode.textContent?.length ?? 0;
        if (!startNode && start >= offset && start <= offset + length) {
          startNode = textNode;
          startOffset = start - offset;
        }
        if (end >= offset && end <= offset + length) {
          endNode = textNode;
          endOffset = end - offset;
          break;
        }
        offset += length;
      }
      if (!startNode || !endNode) {
        throw new Error(`Could not map preview selection: ${selectionTarget.text}`);
      }
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { text, occurrence },
  );
}

async function addVisibleReviewComment(page: Page, body: string): Promise<void> {
  const input = page.getByTestId("selection-review-input");
  await expect(input).toBeVisible();
  await input.fill(body);
  await page.getByTestId("selection-review-save").click();
  await expect(input).not.toBeVisible();
}

test("file selection comments persist and remain available from Changes", async ({
  context,
  page,
  withWorkspace,
}) => {
  const workspace = await withWorkspace({ prefix: "file-review-comments-" });
  const fileName = "review-notes.md";
  const previewQuote = "Selected preview passage.";
  const previewComment = "Explain why this distinction matters.";
  const repeatedQuote = "Repeated visible phrase.";
  const repeatedComment = "This comment belongs to the formatted occurrence.";
  const sourceComment = "Tighten the document heading.";
  const diffComment = "Cover the new diff line as well.";
  await writeFile(
    path.join(workspace.repoPath, fileName),
    `# Review fixture\n\n${previewQuote}\n\n${repeatedQuote}\n\n**Repeated** visible phrase.\n`,
    "utf8",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await workspace.navigateTo();
  await openFileExplorer(page);
  await openFileFromExplorer(page, fileName);
  await expectFileTabOpen(page, fileName);

  await selectPreviewText(page, previewQuote);
  await page.getByTestId("review-selection-comment").click();
  await addVisibleReviewComment(page, previewComment);

  await selectPreviewText(page, repeatedQuote, 1);
  await page.getByTestId("review-selection-comment").click();
  await expect(page.getByTestId("selection-review-sheet")).toContainText("Selected text");
  await addVisibleReviewComment(page, repeatedComment);

  const summaryTrigger = page
    .getByTestId("review-summary-trigger")
    .filter({ visible: true })
    .first();
  await expect(summaryTrigger).toHaveAccessibleName("Open review comments (2)");
  await summaryTrigger.click();
  await page.getByTestId("review-summary-copy").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      [
        "Review comments",
        "",
        `## ${fileName}`,
        "Selected text",
        `> ${previewQuote}`,
        "",
        previewComment,
        "",
        "Selected text",
        `> ${repeatedQuote}`,
        "",
        repeatedComment,
      ].join("\n"),
    );
  await page.keyboard.press("Escape");

  await page.getByTestId("file-mode-source").click();
  const sourceEditor = page
    .getByTestId("file-source-editor")
    .filter({ visible: true })
    .locator(".cm-content");
  await sourceEditor.click();
  await sourceEditor.press("ControlOrMeta+a");
  await page.getByTestId("source-selection-review-trigger").click();
  await addVisibleReviewComment(page, sourceComment);
  await expect(summaryTrigger).toHaveAccessibleName("Open review comments (3)");

  await page.reload();
  await expectFileTabOpen(page, fileName);
  await expect(
    page.getByTestId("review-summary-trigger").filter({ visible: true }).first(),
  ).toHaveAccessibleName("Open review comments (3)");

  await page.getByTestId("explorer-tab-changes").click();
  await expect(page.getByTestId("git-diff-scroll")).toBeVisible({ timeout: 30_000 });
  const visibleSummaryTriggers = page
    .getByTestId("review-summary-trigger")
    .filter({ visible: true });
  await expect(visibleSummaryTriggers).toHaveCount(2);
  await visibleSummaryTriggers.last().click();
  await expect(page.getByText(previewComment, { exact: true })).toBeVisible();
  await expect(page.getByText(repeatedComment, { exact: true })).toBeVisible();
  await expect(page.getByText(sourceComment, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const diffBody = page.getByTestId("diff-file-0-body");
  if (!(await diffBody.isVisible())) {
    await page.getByTestId("diff-file-0").click();
  }
  await expect(diffBody).toBeVisible();
  const addDiffComment = page.getByLabel("Add review comment").filter({ visible: true }).first();
  await addDiffComment.click();
  const inlineEditor = page.getByTestId("inline-review-editor-input");
  await inlineEditor.fill(diffComment);
  await page.getByTestId("inline-review-editor-save").click();

  const changesSummaryTrigger = visibleSummaryTriggers.last();
  await expect(changesSummaryTrigger).toHaveAccessibleName("Open review comments (4)");
  await changesSummaryTrigger.click();
  await page.getByTestId("review-summary-copy").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(diffComment);
  const summarySheet = page.getByTestId("review-summary-sheet");
  await expect(summarySheet.getByText(diffComment, { exact: true })).toBeVisible();
  await page
    .getByTestId(/^review-summary-delete-/)
    .last()
    .click();
  await expect(summarySheet.getByText(diffComment, { exact: true })).not.toBeVisible();
  await expect(changesSummaryTrigger).toHaveAccessibleName("Open review comments (3)");
});
