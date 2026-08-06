import { expect, test } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerVisible,
  fillComposerDraft,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("ArrowUp recalls the latest user message into an empty composer", async ({ page }) => {
  test.setTimeout(60_000);
  const prompt = "Recall this latest session message.";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-message-history-",
    title: "Composer message history",
    initialPrompt: prompt,
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);

    const composer = composerLocator(page);
    await expect(composer).toHaveValue("");
    await composer.press("ArrowUp");
    await expectComposerDraft(page, prompt);

    await fillComposerDraft(page, "draft in progress");
    await composer.press("ArrowUp");
    await expectComposerDraft(page, "draft in progress");
  } finally {
    await agent.cleanup();
  }
});
