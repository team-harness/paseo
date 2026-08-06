import type { StreamItem } from "@/types/stream";

export interface LastMessageRecall {
  value: string;
  selection: { start: number; end: number };
}

function findLastUserMessageInLane(items: readonly StreamItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "user_message" && item.text.length > 0) {
      return item.text;
    }
  }
  return null;
}

export function findLastUserMessageText(
  tail: readonly StreamItem[] | undefined,
  head: readonly StreamItem[] | undefined = undefined,
): string | null {
  return findLastUserMessageInLane(head ?? []) ?? findLastUserMessageInLane(tail ?? []);
}

export function resolveLastMessageRecall(input: {
  key: string;
  value: string;
  lastUserMessage: string | null;
}): LastMessageRecall | null {
  if (input.key !== "ArrowUp" || input.value.length > 0 || !input.lastUserMessage) {
    return null;
  }
  const cursor = input.lastUserMessage.length;
  return {
    value: input.lastUserMessage,
    selection: { start: cursor, end: cursor },
  };
}
