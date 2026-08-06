import { describe, expect, it } from "vitest";
import { collectUserMessageHistory, resolveMessageHistoryNavigation } from "./history";

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

  it("navigates backward and forward through the complete message history", () => {
    const history = ["first prompt", "second prompt", "latest prompt"];

    expect(
      resolveMessageHistoryNavigation({ key: "ArrowUp", value: "", history, index: null }),
    ).toEqual({
      value: "latest prompt",
      index: 2,
      selection: { start: 13, end: 13 },
    });
    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowUp",
        value: "latest prompt",
        history,
        index: 2,
      }),
    ).toMatchObject({ value: "second prompt", index: 1 });
    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowUp",
        value: "second prompt",
        history,
        index: 1,
      }),
    ).toMatchObject({ value: "first prompt", index: 0 });
    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowUp",
        value: "first prompt",
        history,
        index: 0,
      }),
    ).toMatchObject({ value: "first prompt", index: 0 });

    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowDown",
        value: "first prompt",
        history,
        index: 0,
      }),
    ).toMatchObject({ value: "second prompt", index: 1 });
    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowDown",
        value: "second prompt",
        history,
        index: 1,
      }),
    ).toMatchObject({ value: "latest prompt", index: 2 });
    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowDown",
        value: "latest prompt",
        history,
        index: 2,
      }),
    ).toEqual({
      value: "",
      index: null,
      selection: { start: 0, end: 0 },
    });
  });

  it("keeps normal cursor navigation until history traversal starts from an empty composer", () => {
    const history = ["latest prompt"];

    expect(
      resolveMessageHistoryNavigation({
        key: "ArrowUp",
        value: "draft in progress",
        history,
        index: null,
      }),
    ).toBeNull();
    expect(
      resolveMessageHistoryNavigation({ key: "ArrowDown", value: "", history, index: null }),
    ).toBeNull();
    expect(
      resolveMessageHistoryNavigation({ key: "Enter", value: "", history, index: null }),
    ).toBeNull();
    expect(
      resolveMessageHistoryNavigation({ key: "ArrowUp", value: "", history: [], index: null }),
    ).toBeNull();
  });
});
