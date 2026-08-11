import type { TeamMessagePort, TeamRoomPort } from "../../application/ports.js";
import type { MissionRoomStore } from "../../persistence/mission-room-store.js";

export class PaseoTeamRoomAdapter implements TeamRoomPort, TeamMessagePort {
  constructor(private readonly rooms: MissionRoomStore) {}

  async createMissionRoom(input: Parameters<TeamRoomPort["createMissionRoom"]>[0]): Promise<void> {
    await this.rooms.create({
      missionId: input.missionId,
      roomId: input.roomId,
      teamId: input.teamId,
    });
  }

  async post(input: Parameters<TeamMessagePort["post"]>[0]) {
    const posted = await this.rooms.post({
      messageId: input.messageId,
      missionId: input.missionId,
      roomId: input.roomId,
      author: { kind: "agent", id: input.senderAgentId },
      body: input.body,
      replyToMessageId: null,
    });
    return { messageId: posted.message.id, cursor: posted.cursor };
  }

  async read(input: Parameters<TeamMessagePort["read"]>[0]) {
    const page = await this.rooms.read({
      missionId: input.missionId,
      ...(input.afterCursor !== undefined ? { afterCursor: input.afterCursor } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    if (page.roomId !== input.roomId) throw new Error(`Mission ${input.missionId} room mismatch`);
    return { messages: page.messages, cursor: page.cursor, hasMore: page.hasMore };
  }
}
