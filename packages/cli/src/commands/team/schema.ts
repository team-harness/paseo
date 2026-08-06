import type { TeamSnapshot } from "@getpaseo/protocol/team/types";
import type { OutputSchema } from "../../output/index.js";

export interface TeamRow {
  id: string;
  name: string;
  lifecycle: string;
  lead: string;
  members: number;
  room: string;
  createdAt: string;
}

export interface TeamMemberRow {
  agentId: string;
  role: string;
  state: string;
  removalReason: string;
  joinedAt: string;
}

export function toTeamRow(team: TeamSnapshot): TeamRow {
  return {
    id: team.id,
    name: team.name,
    lifecycle: team.lifecycle,
    lead: team.leadAgentId,
    // Only the seats that are still taken. Counting the whole roster would
    // report a team as bigger than it is for the rest of its life.
    members: team.members.filter((member) => member.state === "active").length,
    room: team.chatRoomId,
    createdAt: team.createdAt,
  };
}

export function toTeamMemberRows(team: TeamSnapshot): TeamMemberRow[] {
  return team.members.map((member) => ({
    agentId: member.agentId,
    role: member.role,
    state: member.state,
    removalReason: member.removalReason ?? "-",
    joinedAt: member.joinedAt,
  }));
}

export const teamSchema: OutputSchema<TeamRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 12 },
    { header: "NAME", field: "name", width: 24 },
    { header: "LIFECYCLE", field: "lifecycle", width: 10 },
    { header: "MEMBERS", field: "members", width: 8, align: "right" },
    { header: "LEAD", field: "lead", width: 36 },
    { header: "ROOM", field: "room", width: 20 },
    { header: "CREATED", field: "createdAt", width: 24 },
  ],
};

export const teamMemberSchema: OutputSchema<TeamMemberRow> = {
  idField: "agentId",
  columns: [
    { header: "AGENT", field: "agentId", width: 36 },
    { header: "ROLE", field: "role", width: 20 },
    { header: "STATE", field: "state", width: 10 },
    { header: "REASON", field: "removalReason", width: 20 },
    { header: "JOINED", field: "joinedAt", width: 24 },
  ],
};
