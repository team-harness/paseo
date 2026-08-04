export function formatComposerQuote(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  const quoted = trimmed
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n\n`;
}

interface TextSelection {
  start: number;
  end: number;
}

interface InsertComposerQuoteInput {
  value: string;
  markdown: string;
  selection: TextSelection;
}

interface InsertComposerQuoteResult {
  value: string;
  selection: TextSelection;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.max(0, Math.min(Math.trunc(index), length));
}

export function insertComposerQuote(input: InsertComposerQuoteInput): InsertComposerQuoteResult {
  const first = clampIndex(input.selection.start, input.value.length);
  const second = clampIndex(input.selection.end, input.value.length);
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const quote = formatComposerQuote(input.markdown);
  if (!quote) {
    return { value: input.value, selection: { start, end } };
  }

  const before = input.value.slice(0, start);
  const leadingNewline = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const insertion = `${leadingNewline}${quote}`;
  const value = `${before}${insertion}${input.value.slice(end)}`;
  const cursor = before.length + insertion.length;
  return { value, selection: { start: cursor, end: cursor } };
}
