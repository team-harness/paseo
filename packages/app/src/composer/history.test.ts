import { describe, expect, it } from "vitest";
import { collectUserMessageHistory } from "./history";

describe("composer message history", () => {
  it("collects complete user messages from the shared prompt index in chronological order", () => {
    expect(
      collectUserMessageHistory([
        { text: "first prompt" },
        { text: "second prompt" },
        { text: "latest prompt" },
      ]),
    ).toEqual(["first prompt", "second prompt", "latest prompt"]);
    expect(collectUserMessageHistory([{ text: "" }, {}, { text: "kept" }])).toEqual(["kept"]);
  });
});
