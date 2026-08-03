import { describe, expect, it } from "vitest";
import { filterSavedPrompts, insertSavedPrompt, type SavedPrompt } from "./model";

const PROMPTS: SavedPrompt[] = [
  {
    id: "prompt-review",
    title: "Code review",
    content: "Review the current diff and report correctness risks first.",
  },
  {
    id: "prompt-release",
    title: "Release notes",
    content: "Summarize user-visible changes for the next desktop release.",
  },
];

describe("insertSavedPrompt", () => {
  it("replaces the selected text and places the cursor after the inserted prompt", () => {
    expect(
      insertSavedPrompt({
        value: "Please OLD before sending",
        prompt: "review the diff",
        selection: { start: 7, end: 10 },
      }),
    ).toEqual({
      value: "Please review the diff before sending",
      selection: { start: 22, end: 22 },
    });
  });

  it("inserts at a collapsed cursor without changing the surrounding draft", () => {
    expect(
      insertSavedPrompt({
        value: "Start  finish",
        prompt: "and verify",
        selection: { start: 6, end: 6 },
      }),
    ).toEqual({
      value: "Start and verify finish",
      selection: { start: 16, end: 16 },
    });
  });

  it("clamps reversed or out-of-range selections before inserting", () => {
    expect(
      insertSavedPrompt({
        value: "draft",
        prompt: "final",
        selection: { start: 99, end: -4 },
      }),
    ).toEqual({
      value: "final",
      selection: { start: 5, end: 5 },
    });
  });
});

describe("filterSavedPrompts", () => {
  it("matches title and body case-insensitively while preserving order", () => {
    expect(filterSavedPrompts(PROMPTS, "REVIEW")).toEqual([PROMPTS[0]]);
    expect(filterSavedPrompts(PROMPTS, "desktop")).toEqual([PROMPTS[1]]);
    expect(filterSavedPrompts(PROMPTS, "  ")).toEqual(PROMPTS);
  });
});
