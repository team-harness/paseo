import { expect, test } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerVisible,
  fillComposerDraft,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("ArrowUp and ArrowDown navigate the current session message history", async ({ page }) => {
  test.setTimeout(90_000);
  const firstPrompt = "Recall this first session message.";
  const latestPrompt = "Recall this latest session message.";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-message-history-",
    title: "Composer message history",
    initialPrompt: firstPrompt,
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await agent.client.sendAgentMessage(agent.agentId, latestPrompt);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);

    const composer = composerLocator(page);
    await expect(composer).toHaveValue("");
    await composer.press("ArrowUp");
    await expectComposerDraft(page, latestPrompt);
    await composer.press("ArrowUp");
    await expectComposerDraft(page, firstPrompt);
    await composer.press("ArrowUp");
    await expectComposerDraft(page, firstPrompt);
    await composer.press("ArrowDown");
    await expectComposerDraft(page, latestPrompt);
    await composer.press("ArrowDown");
    await expectComposerDraft(page, "");

    await fillComposerDraft(page, "draft in progress");
    await composer.press("ArrowUp");
    await expectComposerDraft(page, "draft in progress");
  } finally {
    await agent.cleanup();
  }
});
