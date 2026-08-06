import { describe, expect, it } from "vitest";
import { resolveSelectionActionPlacement } from "./placement";

const BASE_INPUT = {
  anchorX: 240,
  anchorY: 300,
  actionWidth: 96,
  actionHeight: 36,
  viewportWidth: 390,
  viewportHeight: 760,
};

describe("resolveSelectionActionPlacement", () => {
  it("anchors the action below the final selected character", () => {
    expect(resolveSelectionActionPlacement(BASE_INPUT)).toEqual({
      left: 192,
      top: 308,
      placement: "below",
    });
  });

  it("moves above the selection when the keyboard leaves no room below", () => {
    expect(
      resolveSelectionActionPlacement({
        ...BASE_INPUT,
        anchorY: 300,
        viewportHeight: 330,
      }),
    ).toEqual({
      left: 192,
      top: 256,
      placement: "above",
    });
  });

  it("clamps the action inside narrow viewport edges", () => {
    expect(
      resolveSelectionActionPlacement({
        ...BASE_INPUT,
        anchorX: 12,
      }),
    ).toEqual({
      left: 8,
      top: 308,
      placement: "below",
    });
  });
});
