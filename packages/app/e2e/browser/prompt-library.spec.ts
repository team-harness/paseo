import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerVisible,
} from "../support/helpers/composer";
import { clickNewChat } from "../support/helpers/launcher";

const PROMPT_LIBRARY_STORAGE_KEY = "@paseo:prompt-library";

function readTextareaSelection(element: Element): [number | null, number | null] {
  const textarea = element as HTMLTextAreaElement;
  return [textarea.selectionStart, textarea.selectionEnd];
}

function readTextareaFocusState(element: Element): {
  start: number | null;
  end: number | null;
  focused: boolean;
} {
  const textarea = element as HTMLTextAreaElement;
  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    focused: document.activeElement === textarea,
  };
}

function readLocalStorageValue(key: string): string | null {
  return localStorage.getItem(key);
}

function installOneShotStorageFailure(input: { key: string; message: string }): void {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    if (key === input.key) {
      Storage.prototype.setItem = originalSetItem;
      throw new Error(input.message);
    }
    originalSetItem.call(this, key, value);
  };
}

async function getComposerSelection(composer: Locator): Promise<[number | null, number | null]> {
  return await composer.evaluate(readTextareaSelection);
}

async function getComposerFocusState(
  composer: Locator,
): Promise<{ start: number | null; end: number | null; focused: boolean }> {
  return await composer.evaluate(readTextareaFocusState);
}

async function getStoredPromptLibrary(page: Page): Promise<string | null> {
  return await page.evaluate(readLocalStorageValue, PROMPT_LIBRARY_STORAGE_KEY);
}

async function failNextPromptLibraryWrite(page: Page, message: string): Promise<void> {
  await page.evaluate(installOneShotStorageFailure, {
    key: PROMPT_LIBRARY_STORAGE_KEY,
    message,
  });
}

async function typeWithIme(page: Page, input: Locator, text: string): Promise<void> {
  await input.focus();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart: 0,
      replacementEnd: 0,
    });
    await session.send("Input.insertText", { text });
  } finally {
    await session.detach();
  }
}

async function openPromptLibrary(page: Page): Promise<void> {
  const trigger = page.getByTestId("prompt-library-trigger").filter({ visible: true }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  await expect(page.getByTestId("prompt-library-sheet")).toBeVisible({ timeout: 10_000 });
}

async function closePromptLibrary(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("prompt-library-sheet")).toHaveCount(0, { timeout: 10_000 });
}

async function fillNewSavedPrompt(
  page: Page,
  input: { title: string; content: string },
): Promise<void> {
  await page.getByTestId("prompt-library-new-button").click();
  await expect(page.getByTestId("prompt-library-title-input")).toBeVisible();
  await page.getByTestId("prompt-library-title-input").fill(input.title);
  await page.getByTestId("prompt-library-content-input").fill(input.content);
}

test.describe("Saved prompts", () => {
  test("accepts Chinese IME composition in the prompt editor", async ({ page, withWorkspace }) => {
    const workspace = await withWorkspace({ prefix: "prompt-library-ime-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await openPromptLibrary(page);
    await page.getByTestId("prompt-library-new-button").click();

    const titleInput = page.getByTestId("prompt-library-title-input");
    const contentInput = page.getByTestId("prompt-library-content-input");
    const title = "中文标题";
    const content = "请审查当前变更，并只返回可执行的问题。";

    await typeWithIme(page, titleInput, title);
    await expect(titleInput).toHaveValue(title);
    await typeWithIme(page, contentInput, content);
    await expect(contentInput).toHaveValue(content);

    await page.getByTestId("prompt-library-save-button").click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("supports CRUD, persistence, search, and exact selection insertion", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(120_000);
    const workspace = await withWorkspace({ prefix: "prompt-library-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    const initialTitle = "Review current diff";
    const updatedTitle = "Review staged changes";
    const initialContent = "Review the current diff.\nReturn only actionable findings.";
    const updatedContent = "Review the staged changes.\nReturn only actionable findings.";

    await openPromptLibrary(page);
    await expect(page.getByText("No saved prompts yet", { exact: true })).toBeVisible();
    await fillNewSavedPrompt(page, { title: initialTitle, content: initialContent });

    const saveFailureMessage = "Injected saved prompt write failure";
    await failNextPromptLibraryWrite(page, saveFailureMessage);
    await page.getByTestId("prompt-library-save-button").click();
    await expect(page.getByTestId("prompt-library-submit-error")).toHaveText(saveFailureMessage);
    await expect(page.getByTestId("prompt-library-title-input")).toHaveValue(initialTitle);
    await expect(page.getByTestId("prompt-library-content-input")).toHaveValue(initialContent);
    await expect(getStoredPromptLibrary(page)).resolves.toBeNull();

    await page.getByTestId("prompt-library-save-button").click();
    await expect(page.getByText(initialTitle, { exact: true })).toBeVisible();

    const searchInput = page.getByTestId("prompt-library-search-input");
    await searchInput.fill("ACTIONABLE");
    await expect(page.getByText(initialTitle, { exact: true })).toBeVisible();
    await searchInput.fill("does not exist");
    await expect(page.getByText("No matching prompts", { exact: true })).toBeVisible();
    await searchInput.fill("");

    await page.locator('[data-testid^="prompt-library-menu-"]').click();
    await page.locator('[data-testid^="prompt-library-edit-"]').click();
    await expect(page.getByTestId("prompt-library-title-input")).toBeVisible();
    await page.getByTestId("prompt-library-title-input").fill(updatedTitle);
    await page.getByTestId("prompt-library-content-input").fill(updatedContent);
    await page.getByTestId("prompt-library-save-button").click();
    await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();

    await closePromptLibrary(page);
    await page.reload();
    await expectComposerVisible(page, { timeout: 30_000 });
    await openPromptLibrary(page);
    await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();
    await closePromptLibrary(page);

    const composer = composerLocator(page);
    await composer.fill("Before AFTER");
    await composer.focus();
    await composer.press("End");
    for (let index = 0; index < "AFTER".length; index += 1) {
      await composer.press("Shift+ArrowLeft");
    }
    await expect.poll(() => getComposerSelection(composer)).toEqual([7, 12]);

    const routeBeforeInsert = page.url();
    await openPromptLibrary(page);
    await page.locator('[data-testid^="prompt-library-use-"]').click();
    const insertedValue = `Before ${updatedContent}`;
    await expectComposerDraft(page, insertedValue);
    await expect
      .poll(() => getComposerFocusState(composer))
      .toEqual({ start: insertedValue.length, end: insertedValue.length, focused: true });
    expect(page.url()).toBe(routeBeforeInsert);

    await openPromptLibrary(page);
    await page.locator('[data-testid^="prompt-library-menu-"]').click();
    const deleteFailureMessage = "Injected saved prompt delete failure";
    await failNextPromptLibraryWrite(page, deleteFailureMessage);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-testid^="prompt-library-delete-"]').click();
    await expect(page.getByTestId("prompt-library-action-error")).toHaveText(deleteFailureMessage);
    await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();
    await expect(getStoredPromptLibrary(page)).resolves.toContain(updatedTitle);

    await page.locator('[data-testid^="prompt-library-menu-"]').click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-testid^="prompt-library-delete-"]').click();
    await expect(page.getByText(updatedTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText("No saved prompts yet", { exact: true })).toBeVisible();
    await expect.poll(() => getStoredPromptLibrary(page)).toBe(JSON.stringify({ items: [] }));
  });

  test("preserves corrupt storage until an explicit reset is confirmed", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(120_000);
    const workspace = await withWorkspace({ prefix: "prompt-library-corrupt-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: PROMPT_LIBRARY_STORAGE_KEY,
      value: "not-json",
    });
    await page.reload();
    await expectComposerVisible(page, { timeout: 30_000 });
    await openPromptLibrary(page);

    await expect(page.getByText(/saved prompt data is damaged/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("prompt-library-new-button")).toBeDisabled();
    await expect(getStoredPromptLibrary(page)).resolves.toBe("not-json");

    await page.getByTestId("prompt-library-retry-button").click();
    await expect(page.getByText(/saved prompt data is damaged/i)).toBeVisible({ timeout: 20_000 });
    await expect(getStoredPromptLibrary(page)).resolves.toBe("not-json");

    const resetFailureMessage = "Injected saved prompt reset failure";
    await failNextPromptLibraryWrite(page, resetFailureMessage);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("prompt-library-reset-button").click();
    await expect(page.getByTestId("prompt-library-reset-error")).toHaveText(
      "Couldn't reset saved prompts",
    );
    await expect(page.getByText(/saved prompt data is damaged/i)).toBeVisible();
    await expect(getStoredPromptLibrary(page)).resolves.toBe("not-json");
    await expect(page.getByTestId("prompt-library-reset-button")).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("prompt-library-reset-button").click();
    await expect(page.getByText("No saved prompts yet", { exact: true })).toBeVisible();
    await expect.poll(() => getStoredPromptLibrary(page)).toBe(JSON.stringify({ items: [] }));
  });
});
