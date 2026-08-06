export interface MessageHistoryNavigationResult {
  value: string;
  index: number | null;
  selection: { start: number; end: number };
}

export function collectUserMessageHistory(
  prompts: readonly { text?: string }[] | undefined,
): string[] {
  return (prompts ?? []).flatMap((prompt) =>
    prompt.text === undefined || prompt.text.length === 0 ? [] : [prompt.text],
  );
}

export function resolveMessageHistoryNavigation(input: {
  key: string;
  value: string;
  history: readonly string[];
  index: number | null;
}): MessageHistoryNavigationResult | null {
  if ((input.key !== "ArrowUp" && input.key !== "ArrowDown") || input.history.length === 0) {
    return null;
  }

  const lastIndex = input.history.length - 1;
  let nextIndex: number | null;
  if (input.key === "ArrowUp") {
    if (input.index === null) {
      if (input.value.length > 0) return null;
      nextIndex = lastIndex;
    } else {
      nextIndex = Math.max(0, Math.min(input.index - 1, lastIndex));
    }
  } else {
    if (input.index === null) return null;
    nextIndex = input.index >= lastIndex ? null : input.index + 1;
  }

  const value = nextIndex === null ? "" : (input.history[nextIndex] ?? "");
  const cursor = value.length;
  return {
    value,
    index: nextIndex,
    selection: { start: cursor, end: cursor },
  };
}
