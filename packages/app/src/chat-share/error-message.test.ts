import { describe, expect, it } from "vitest";
import { formatChatShareErrorMessage } from "./error-message";
import { CHAT_SHARE_MAX_BYTES, ChatShareTooLargeError } from "./upload";

const copy = {
  failed: "Sharing failed",
  recoveryHint: "Deploy your own Threadshare for greater reliability.",
  tooLarge: "Choose a later message.",
};

describe("formatChatShareErrorMessage", () => {
  it("uses the dedicated size-limit guidance", () => {
    expect(
      formatChatShareErrorMessage(
        new ChatShareTooLargeError(CHAT_SHARE_MAX_BYTES + 1, CHAT_SHARE_MAX_BYTES),
        copy,
      ),
    ).toBe(copy.tooLarge);
  });

  it("includes the service reason and recovery guidance", () => {
    expect(formatChatShareErrorMessage(new Error("Storage is unavailable"), copy)).toBe(
      "Storage is unavailable\n\nDeploy your own Threadshare for greater reliability.",
    );
  });

  it("uses the localized fallback when no error reason is available", () => {
    expect(formatChatShareErrorMessage(null, copy)).toBe(
      "Sharing failed\n\nDeploy your own Threadshare for greater reliability.",
    );
  });
});
