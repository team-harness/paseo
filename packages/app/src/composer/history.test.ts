import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { findLastUserMessageText, resolveLastMessageRecall } from "./history";

function streamItem(kind: StreamItem["kind"], text?: string): StreamItem {
  return { kind, text } as StreamItem;
}

describe("composer message history", () => {
  it("finds the latest user message in the current session stream", () => {
    expect(
      findLastUserMessageText(
        [
          streamItem("user_message", "first prompt"),
          streamItem("assistant_message", "first answer"),
        ],
        [
          streamItem("user_message", "latest prompt"),
          streamItem("assistant_message", "latest answer"),
        ],
      ),
    ).toBe("latest prompt");
  });

  it("recalls the last message when ArrowUp is pressed in an empty composer", () => {
    expect(
      resolveLastMessageRecall({
        key: "ArrowUp",
        value: "",
        lastUserMessage: "latest prompt\nwith context",
      }),
    ).toEqual({
      value: "latest prompt\nwith context",
      selection: { start: 26, end: 26 },
    });
  });

  it("keeps normal cursor navigation when the composer already has text", () => {
    expect(
      resolveLastMessageRecall({
        key: "ArrowUp",
        value: "draft in progress",
        lastUserMessage: "latest prompt",
      }),
    ).toBeNull();
  });

  it("does not handle other keys or sessions without a previous text message", () => {
    expect(
      resolveLastMessageRecall({ key: "ArrowDown", value: "", lastUserMessage: "latest prompt" }),
    ).toBeNull();
    expect(
      resolveLastMessageRecall({ key: "ArrowUp", value: "", lastUserMessage: null }),
    ).toBeNull();
    expect(findLastUserMessageText([streamItem("assistant_message", "answer")])).toBeNull();
  });
});
