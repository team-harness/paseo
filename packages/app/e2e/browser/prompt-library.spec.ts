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

async function seedLegacyPromptLibrary(
  page: Page,
  items: Array<{ id: string; title: string; content: string }>,
): Promise<void> {
  await page.evaluate(
    ({ key, prompts }) => localStorage.setItem(key, JSON.stringify({ items: prompts })),
    { key: PROMPT_LIBRARY_STORAGE_KEY, prompts: items },
  );
}

async function seedCorruptLegacyPromptLibrary(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.setItem(key, "not-json"), PROMPT_LIBRARY_STORAGE_KEY);
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
  test.beforeEach(async ({ e2eWorkerClient }) => {
    await e2eWorkerClient.clearSavedPrompts();
  });

  test.afterEach(async ({ e2eWorkerClient }) => {
    await e2eWorkerClient.clearSavedPrompts();
  });

  test("accepts Chinese IME composition in the prompt editor", async ({
    page,
    withWorkspace,
    e2eWorkerClient,
  }) => {
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
    await expect
      .poll(async () => (await e2eWorkerClient.listSavedPrompts()).items)
      .toEqual([expect.objectContaining({ title, content })]);
  });

  test("supports Host-backed CRUD, reload, search, and exact selection insertion", async ({
    page,
    withWorkspace,
    e2eWorkerClient,
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
    await page.getByTestId("prompt-library-save-button").click();
    await expect(page.getByText(initialTitle, { exact: true })).toBeVisible();
    await expect(getStoredPromptLibrary(page)).resolves.toBeNull();
    await expect
      .poll(async () => (await e2eWorkerClient.listSavedPrompts()).items)
      .toEqual([expect.objectContaining({ title: initialTitle, content: initialContent })]);

    const searchInput = page.getByTestId("prompt-library-search-input");
    await searchInput.fill("ACTIONABLE");
    await expect(page.getByText(initialTitle, { exact: true })).toBeVisible();
    await searchInput.fill("does not exist");
    await expect(page.getByText("No matching prompts", { exact: true })).toBeVisible();
    await searchInput.fill("");

    await page.locator('[data-testid^="prompt-library-menu-"]').click();
    await page.locator('[data-testid^="prompt-library-edit-"]').click();
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
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-testid^="prompt-library-delete-"]').click();
    await expect(page.getByText(updatedTitle, { exact: true })).toHaveCount(0);
    await expect(page.getByText("No saved prompts yet", { exact: true })).toBeVisible();
    await expect.poll(async () => (await e2eWorkerClient.listSavedPrompts()).items).toEqual([]);
  });

  test("asks once, merges legacy prompts into the Host, and removes the legacy key", async ({
    page,
    withWorkspace,
    e2eWorkerClient,
  }) => {
    test.setTimeout(120_000);
    const workspace = await withWorkspace({ prefix: "prompt-library-migration-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    const hostPrompt = {
      id: "shared-id",
      title: "Host prompt",
      content: "Already stored on the Host",
    };
    const exactDuplicate = { ...hostPrompt, id: "legacy-duplicate" };
    const idCollision = {
      id: "shared-id",
      title: "Legacy collision",
      content: "Keep this legacy prompt with a new ID",
    };
    const legacyUnique = {
      id: "legacy-unique",
      title: "Legacy unique",
      content: "Move this prompt to the Host",
    };
    await e2eWorkerClient.mergeSavedPrompts([hostPrompt]);
    await seedLegacyPromptLibrary(page, [exactDuplicate, idCollision, legacyUnique]);

    let migrationDialogCount = 0;
    page.on("dialog", async (dialog) => {
      migrationDialogCount += 1;
      expect(dialog.message()).toContain("Merge old saved prompts?");
      await dialog.accept();
    });
    await openPromptLibrary(page);

    await expect(page.getByText(hostPrompt.title, { exact: true })).toBeVisible();
    await expect(page.getByText(idCollision.title, { exact: true })).toBeVisible();
    await expect(page.getByText(legacyUnique.title, { exact: true })).toBeVisible();
    await expect.poll(() => getStoredPromptLibrary(page)).toBeNull();
    await expect
      .poll(async () => (await e2eWorkerClient.listSavedPrompts()).items)
      .toEqual([
        hostPrompt,
        expect.objectContaining({
          title: idCollision.title,
          content: idCollision.content,
        }),
        legacyUnique,
      ]);
    expect(migrationDialogCount).toBe(1);

    await closePromptLibrary(page);
    await openPromptLibrary(page);
    await expect(page.getByText(legacyUnique.title, { exact: true })).toBeVisible();
    expect(migrationDialogCount).toBe(1);
  });

  test("keeps legacy prompts after cancel and asks again on the next open", async ({
    page,
    withWorkspace,
    e2eWorkerClient,
  }) => {
    const workspace = await withWorkspace({ prefix: "prompt-library-migration-cancel-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    const legacyPrompt = {
      id: "legacy-cancelled",
      title: "Migrate after retry",
      content: "Keep this until migration succeeds",
    };
    await seedLegacyPromptLibrary(page, [legacyPrompt]);

    page.once("dialog", (dialog) => dialog.dismiss());
    await openPromptLibrary(page);
    await expect(page.getByText("No saved prompts yet", { exact: true })).toBeVisible();
    await expect(getStoredPromptLibrary(page)).resolves.toContain(legacyPrompt.title);
    await expect.poll(async () => (await e2eWorkerClient.listSavedPrompts()).items).toEqual([]);

    await closePromptLibrary(page);
    page.once("dialog", (dialog) => dialog.accept());
    await openPromptLibrary(page);
    await expect(page.getByText(legacyPrompt.title, { exact: true })).toBeVisible();
    await expect.poll(() => getStoredPromptLibrary(page)).toBeNull();
    await expect
      .poll(async () => (await e2eWorkerClient.listSavedPrompts()).items)
      .toEqual([legacyPrompt]);
  });

  test("can discard corrupt legacy data without changing Host prompts", async ({
    page,
    withWorkspace,
    e2eWorkerClient,
  }) => {
    const workspace = await withWorkspace({ prefix: "prompt-library-corrupt-migration-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    const hostPrompt = {
      id: "host-prompt",
      title: "Host prompt survives cleanup",
      content: "Keep this prompt on the Host",
    };
    await e2eWorkerClient.mergeSavedPrompts([hostPrompt]);
    await seedCorruptLegacyPromptLibrary(page);

    let cleanupDialogCount = 0;
    page.on("dialog", async (dialog) => {
      cleanupDialogCount += 1;
      expect(dialog.message()).toContain("Old saved prompts cannot be read");
      await dialog.accept();
    });
    await openPromptLibrary(page);

    await expect(page.getByText(hostPrompt.title, { exact: true })).toBeVisible();
    await expect.poll(() => getStoredPromptLibrary(page)).toBeNull();
    await expect
      .poll(async () => (await e2eWorkerClient.listSavedPrompts()).items)
      .toEqual([hostPrompt]);
    expect(cleanupDialogCount).toBe(1);

    await closePromptLibrary(page);
    await openPromptLibrary(page);
    await expect(page.getByText(hostPrompt.title, { exact: true })).toBeVisible();
    expect(cleanupDialogCount).toBe(1);
  });
});
