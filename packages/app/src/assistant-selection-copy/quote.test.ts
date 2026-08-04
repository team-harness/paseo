import { describe, expect, it } from "vitest";
import { formatComposerQuote, insertComposerQuote } from "./quote";

describe("formatComposerQuote", () => {
  it("formats every selected Markdown line as one blockquote and leaves the cursor on a new line", () => {
    expect(formatComposerQuote("First line\n\n- second line")).toBe(
      "> First line\n>\n> - second line\n\n",
    );
  });

  it("trims selection-only whitespace and ignores empty selections", () => {
    expect(formatComposerQuote("  selected text  \n")).toBe("> selected text\n\n");
    expect(formatComposerQuote(" \n\t ")).toBe("");
  });
});

describe("insertComposerQuote", () => {
  it("inserts into an empty Composer and leaves the cursor after the quote", () => {
    expect(
      insertComposerQuote({ value: "", markdown: "Selected", selection: { start: 0, end: 0 } }),
    ).toEqual({
      value: "> Selected\n\n",
      selection: { start: 12, end: 12 },
    });
  });

  it("starts a new block when replacing a selection in the middle of a line", () => {
    expect(
      insertComposerQuote({
        value: "Before AFTER",
        markdown: "Selected",
        selection: { start: 7, end: 12 },
      }),
    ).toEqual({
      value: "Before \n> Selected\n\n",
      selection: { start: 20, end: 20 },
    });
  });

  it("does not add an extra leading newline at the start of a line", () => {
    expect(
      insertComposerQuote({
        value: "Before\nAFTER",
        markdown: "Selected",
        selection: { start: 7, end: 12 },
      }),
    ).toEqual({
      value: "Before\n> Selected\n\n",
      selection: { start: 19, end: 19 },
    });
  });
});
