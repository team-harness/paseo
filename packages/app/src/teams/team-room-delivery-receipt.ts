import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

export interface HumanMentionDeliveryReceipt {
  recipientCount: number;
  translationKey: "teams.room.mentionReceiptOne" | "teams.room.mentionReceiptMany";
}

/** A persisted human room message is the durable receipt for its resolved mentions. */
export function selectHumanMentionDeliveryReceipt(
  message: Pick<TeamRoomMessage, "author" | "mentionAgentIds">,
): HumanMentionDeliveryReceipt | null {
  if (message.author.kind !== "human" || message.mentionAgentIds.length === 0) return null;
  const recipientCount = message.mentionAgentIds.length;
  return {
    recipientCount,
    translationKey:
      recipientCount === 1 ? "teams.room.mentionReceiptOne" : "teams.room.mentionReceiptMany",
  };
}
