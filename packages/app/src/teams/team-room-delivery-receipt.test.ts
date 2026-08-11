import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";
import { describe, expect, it } from "vitest";
import { selectHumanMentionDeliveryReceipt } from "./team-room-delivery-receipt";

function message(input: {
  authorKind: TeamRoomMessage["author"]["kind"];
  mentionAgentIds: string[];
}): Pick<TeamRoomMessage, "author" | "mentionAgentIds"> {
  return {
    author: { kind: input.authorKind, id: "author-1" },
    mentionAgentIds: input.mentionAgentIds,
  };
}

describe("selectHumanMentionDeliveryReceipt", () => {
  it("describes persisted human mentions as delivered to their recipients", () => {
    expect(
      selectHumanMentionDeliveryReceipt(
        message({ authorKind: "human", mentionAgentIds: ["agent-1", "agent-2"] }),
      ),
    ).toEqual({
      recipientCount: 2,
      translationKey: "teams.room.mentionReceiptMany",
    });
  });

  it("uses the singular receipt for one mentioned member", () => {
    expect(
      selectHumanMentionDeliveryReceipt(
        message({ authorKind: "human", mentionAgentIds: ["agent-1"] }),
      ),
    ).toEqual({
      recipientCount: 1,
      translationKey: "teams.room.mentionReceiptOne",
    });
  });

  it("does not describe ordinary human or agent messages as mention deliveries", () => {
    expect(
      selectHumanMentionDeliveryReceipt(message({ authorKind: "human", mentionAgentIds: [] })),
    ).toBeNull();
    expect(
      selectHumanMentionDeliveryReceipt(
        message({ authorKind: "agent", mentionAgentIds: ["agent-1"] }),
      ),
    ).toBeNull();
  });
});
