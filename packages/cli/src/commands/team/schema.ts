import type { TeamSnapshot } from "@getpaseo/protocol/team/types";
import type { AnyCommandResult, OutputOptions, OutputSchema } from "../../output/index.js";

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
    // Seats still taken, and the lead does not occupy one — the cap the user is
    // told about counts non-lead members only.
    members: team.members.filter(
      (member) => member.state === "active" && member.agentId !== team.leadAgentId,
    ).length,
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

/** The team and its roster together, so `inspect` answers both questions at once. */
export interface TeamDetail extends TeamRow {
  roster: TeamMemberRow[];
}

export function toTeamDetail(team: TeamSnapshot): TeamDetail {
  return { ...toTeamRow(team), roster: toTeamMemberRows(team) };
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

export const teamDetailSchema: OutputSchema<TeamDetail> = {
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
  renderHuman: renderTeamDetail,
};

function renderTeamDetail(result: AnyCommandResult<TeamDetail>, _options: OutputOptions): string {
  const teams = result.type === "list" ? result.data : [result.data];
  return teams.map(renderTeamBlock).join("\n\n");
}

function renderTeamBlock(team: TeamDetail): string {
  const lines = [
    `${team.name} [${team.id}] — ${team.lifecycle}`,
    `  lead: ${team.lead}`,
    `  room: ${team.room}`,
    `  created: ${team.createdAt}`,
    "",
    "  ROLE                 STATE      AGENT",
  ];
  for (const member of team.roster) {
    lines.push(
      `  ${member.role.padEnd(20)} ${member.state.padEnd(10)} ${member.agentId}` +
        (member.removalReason === "-" ? "" : ` (${member.removalReason})`),
    );
  }
  return lines.join("\n");
}

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
