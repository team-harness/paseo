export function collectUserMessageHistory(
  prompts: readonly { text?: string }[] | undefined,
): string[] {
  return (prompts ?? []).flatMap((prompt) =>
    prompt.text === undefined || prompt.text.length === 0 ? [] : [prompt.text],
  );
}
