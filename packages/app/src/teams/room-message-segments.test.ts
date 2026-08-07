import { describe, expect, it } from "vitest";

import { splitRoomMessage, type RoomMessageDirectory } from "./room-message-segments";

const TASK_ID = "0b8b35df-59de-4004-9135-26736e5ed2d4";
const DOCS_ID = "3ac70643-11a4-4c1b-9f0e-5f0b0c9d1e22";

function directory(overrides: Partial<RoomMessageDirectory> = {}): RoomMessageDirectory {
  return {
    members: [
      { agentId: DOCS_ID, role: "docs" },
      { agentId: "9f2c1b77-4d5e-4a3f-8b21-0c7d6e5f4a39", role: "server" },
    ],
    taskIds: [TASK_ID],
    ...overrides,
  };
}

describe("splitting a room message into what can be tapped", () => {
  it("leaves a message with nothing to tap as one run of text", () => {
    expect(splitRoomMessage("Cache is at 4.2 GB.", directory())).toEqual([
      { kind: "text", text: "Cache is at 4.2 GB." },
    ]);
  });

  it("resolves a role name to the agent it belongs to", () => {
    expect(splitRoomMessage("@docs please take this", directory())).toEqual([
      { kind: "mention", text: "@docs", agentId: DOCS_ID },
      { kind: "text", text: " please take this" },
    ]);
  });

  it("matches a role name regardless of case", () => {
    const segments = splitRoomMessage("@Docs", directory());

    // The lead is briefed with the roster's own casing, but people retype it.
    expect(segments).toEqual([{ kind: "mention", text: "@Docs", agentId: DOCS_ID }]);
  });

  it("resolves a full agent id", () => {
    expect(splitRoomMessage(`@${DOCS_ID}`, directory())).toEqual([
      { kind: "mention", text: `@${DOCS_ID}`, agentId: DOCS_ID },
    ]);
  });

  it("resolves an agent id written short", () => {
    // What a person copies out of a log line.
    expect(splitRoomMessage("@3ac70643", directory())).toEqual([
      { kind: "mention", text: "@3ac70643", agentId: DOCS_ID },
    ]);
  });

  it("leaves a mention of nobody on the roster as plain text", () => {
    // Guessing at a target is worse than not linking: the tap would open
    // somebody else's conversation.
    expect(splitRoomMessage("@nobody are you there", directory())).toEqual([
      { kind: "text", text: "@nobody are you there" },
    ]);
  });

  it("leaves @everyone alone", () => {
    // The daemon wakes the room on it, but there is no one agent to open.
    expect(splitRoomMessage("@everyone standup", directory())).toEqual([
      { kind: "text", text: "@everyone standup" },
    ]);
  });

  it("does not turn a prefix two members share into a link", () => {
    const twins = directory({
      members: [
        { agentId: "3ac70643-aaaa-4c1b-9f0e-5f0b0c9d1e22", role: "docs" },
        { agentId: "3ac70643-bbbb-4a3f-8b21-0c7d6e5f4a39", role: "server" },
      ],
    });

    expect(splitRoomMessage("@3ac70643", twins)).toEqual([{ kind: "text", text: "@3ac70643" }]);
  });

  it("does not read an email address as a mention", () => {
    expect(splitRoomMessage("mail docs@docs.example", directory())).toEqual([
      { kind: "text", text: "mail docs@docs.example" },
    ]);
  });

  it("resolves a task id written short", () => {
    expect(splitRoomMessage("done with #0b8b35df", directory())).toEqual([
      { kind: "text", text: "done with " },
      { kind: "task", text: "#0b8b35df", taskId: TASK_ID },
    ]);
  });

  it("resolves a full task id", () => {
    expect(splitRoomMessage(`#${TASK_ID}`, directory())).toEqual([
      { kind: "task", text: `#${TASK_ID}`, taskId: TASK_ID },
    ]);
  });

  it("leaves a hash that is not a task alone", () => {
    // Headings, issue numbers, and CSS colours all start with one.
    expect(splitRoomMessage("## Findings and #42", directory())).toEqual([
      { kind: "text", text: "## Findings and #42" },
    ]);
  });

  it("leaves a task id the client has not read yet as plain text", () => {
    // The ledger arrives on its own schedule. A chip that opens nothing is
    // worse than the id spelled out.
    expect(splitRoomMessage("see #0b8b35df", directory({ taskIds: [] }))).toEqual([
      { kind: "text", text: "see #0b8b35df" },
    ]);
  });

  it("keeps every hit in a message that has several", () => {
    expect(splitRoomMessage(`@docs took #0b8b35df, @server is next`, directory())).toEqual([
      { kind: "mention", text: "@docs", agentId: DOCS_ID },
      { kind: "text", text: " took " },
      { kind: "task", text: "#0b8b35df", taskId: TASK_ID },
      { kind: "text", text: ", " },
      { kind: "mention", text: "@server", agentId: "9f2c1b77-4d5e-4a3f-8b21-0c7d6e5f4a39" },
      { kind: "text", text: " is next" },
    ]);
  });

  it("does not swallow the punctuation around a hit", () => {
    expect(splitRoomMessage("(@docs)", directory())).toEqual([
      { kind: "text", text: "(" },
      { kind: "mention", text: "@docs", agentId: DOCS_ID },
      { kind: "text", text: ")" },
    ]);
  });

  it("puts an empty body into no segments at all", () => {
    expect(splitRoomMessage("", directory())).toEqual([]);
  });
});
