import { describe, expect, it } from "vitest";

import { foldRoomMessage, ROOM_MESSAGE_FOLD_LINES } from "./fold-message";

describe("folding a long room message", () => {
  it("leaves a short message alone", () => {
    expect(foldRoomMessage("one\ntwo")).toEqual({ text: "one\ntwo", folded: false, hidden: 0 });
  });

  it("cuts a long message to the fold and says how much is left", () => {
    const body = Array.from({ length: ROOM_MESSAGE_FOLD_LINES + 5 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const folded = foldRoomMessage(body);

    expect(folded.folded).toBe(true);
    expect(folded.hidden).toBe(5);
    expect(folded.text.split("\n")).toHaveLength(ROOM_MESSAGE_FOLD_LINES);
  });

  it("folds one very long line too", () => {
    // An agent posting a 40k-character line is one line and still enough to
    // push the whole room off the screen.
    const folded = foldRoomMessage("x".repeat(5000));

    expect(folded.folded).toBe(true);
    expect(folded.text.length).toBeLessThan(5000);
  });

  it("does not report hidden lines for a message cut by length", () => {
    // "5 more lines" under a single line that was cut mid-sentence is a lie
    // about what is missing.
    expect(foldRoomMessage("x".repeat(5000)).hidden).toBe(0);
  });

  it("counts a message right at the fold as whole", () => {
    const body = Array.from({ length: ROOM_MESSAGE_FOLD_LINES }, (_, i) => `line ${i}`).join("\n");

    expect(foldRoomMessage(body).folded).toBe(false);
  });
});
