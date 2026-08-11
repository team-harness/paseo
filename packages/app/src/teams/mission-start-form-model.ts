import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

export type TeamMissionsAccess = "checking_host" | "supported" | "upgrade_required";

export interface MissionStartFormRow {
  key: string;
  value: string;
}

export interface MissionStartTeamOption {
  teamId: string;
  display: string;
  revision: number;
  available: boolean;
}

export type MissionStartSubmission =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; missionId: string; teamId: string }
  | { status: "failure"; message: string; retryable: boolean };

export interface MissionStartRequestInput {
  idempotencyKey: string;
  teamId: string;
  expectedTeamRevision: number;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface MissionStartFormState {
  access: TeamMissionsAccess;
  selectedTeamId: string | null;
  selectedTeamDisplay: string | null;
  selectedTeamRevision: number | null;
  teamOptions: MissionStartTeamOption[];
  staleTeam: boolean;
  objective: string;
  constraints: MissionStartFormRow[];
  acceptanceCriteria: MissionStartFormRow[];
  idempotencyKey: string;
  submission: MissionStartSubmission;
  canSubmit: boolean;
}

export interface MissionStartFormSnapshot {
  serverId: string;
  workspaceId: string;
  access: TeamMissionsAccess;
  selectedTeam: TeamV2 | null;
  teams: readonly TeamV2[];
  newRowKey: () => string;
  newIdempotencyKey: () => string;
}

export interface MissionStartFormModel {
  getState: () => MissionStartFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  setAccess: (access: TeamMissionsAccess) => void;
  applyTeams: (input: { serverId: string; workspaceId: string; teams: readonly TeamV2[] }) => void;
  selectTeam: (teamId: string) => void;
  setObjective: (value: string) => void;
  addConstraint: () => void;
  removeConstraint: (key: string) => void;
  setConstraint: (key: string, value: string) => void;
  addAcceptanceCriterion: () => void;
  removeAcceptanceCriterion: (key: string) => void;
  setAcceptanceCriterion: (key: string, value: string) => void;
  prepareSubmission: () => MissionStartRequestInput | null;
  submitSucceeded: (input: { missionId: string; teamId: string }) => boolean;
  submitFailed: (input: { message: string; retryable: boolean }) => void;
}

function toTeamOption(team: TeamV2): MissionStartTeamOption {
  return {
    teamId: team.id,
    display: team.name,
    revision: team.revision,
    available: team.lifecycle === "active" && team.activeMissionId === null,
  };
}

function optionsForWorkspace(
  teams: readonly TeamV2[],
  workspaceId: string,
): MissionStartTeamOption[] {
  return teams.filter((team) => team.workspaceId === workspaceId).map(toTeamOption);
}

function rowsAreComplete(rows: readonly MissionStartFormRow[]): boolean {
  return rows.every((row) => row.value.trim().length > 0);
}

function derive(state: MissionStartFormState): MissionStartFormState {
  const selected = state.teamOptions.find((option) => option.teamId === state.selectedTeamId);
  const retryingUnknown =
    state.submission.status === "failure" && state.submission.retryable === true;
  return {
    ...state,
    canSubmit:
      state.access === "supported" &&
      state.submission.status !== "pending" &&
      state.submission.status !== "success" &&
      (retryingUnknown ||
        (state.objective.trim().length > 0 &&
          state.acceptanceCriteria.length > 0 &&
          rowsAreComplete(state.acceptanceCriteria) &&
          rowsAreComplete(state.constraints) &&
          !state.staleTeam &&
          selected?.available === true &&
          selected.revision === state.selectedTeamRevision)),
  };
}

function buildRequest(state: MissionStartFormState): MissionStartRequestInput | null {
  if (!state.selectedTeamId || state.selectedTeamRevision === null) return null;
  return {
    idempotencyKey: state.idempotencyKey,
    teamId: state.selectedTeamId,
    expectedTeamRevision: state.selectedTeamRevision,
    objective: state.objective.trim(),
    constraints: state.constraints.map((row) => row.value.trim()),
    acceptanceCriteria: state.acceptanceCriteria.map((row) => row.value.trim()),
  };
}

export function openMissionStartForm(snapshot: MissionStartFormSnapshot): MissionStartFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let retryPayload: MissionStartRequestInput | null = null;
  const teamOptions = optionsForWorkspace(snapshot.teams, snapshot.workspaceId);
  const selectedTeam = snapshot.selectedTeam;
  let state = derive({
    access: snapshot.access,
    selectedTeamId: selectedTeam?.id ?? null,
    selectedTeamDisplay: selectedTeam?.name ?? null,
    selectedTeamRevision: selectedTeam?.revision ?? null,
    teamOptions,
    staleTeam:
      selectedTeam !== null &&
      !teamOptions.some(
        (option) =>
          option.teamId === selectedTeam.id &&
          option.revision === selectedTeam.revision &&
          option.available,
      ),
    objective: "",
    constraints: [],
    acceptanceCriteria: [{ key: snapshot.newRowKey(), value: "" }],
    idempotencyKey: snapshot.newIdempotencyKey(),
    submission: { status: "idle" },
    canSubmit: false,
  });

  function publish(next: MissionStartFormState): void {
    if (closed) return;
    state = derive(next);
    for (const listener of listeners) listener();
  }

  function updateRows(
    field: "constraints" | "acceptanceCriteria",
    rows: MissionStartFormRow[],
  ): void {
    publish({ ...state, [field]: rows });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setAccess(access) {
      publish({ ...state, access });
    },
    applyTeams(input) {
      if (input.serverId !== snapshot.serverId || input.workspaceId !== snapshot.workspaceId)
        return;
      const options = optionsForWorkspace(input.teams, snapshot.workspaceId);
      const selected = options.find((option) => option.teamId === state.selectedTeamId);
      publish({
        ...state,
        teamOptions: options,
        staleTeam:
          state.selectedTeamId !== null &&
          (!selected || !selected.available || selected.revision !== state.selectedTeamRevision),
      });
    },
    selectTeam(teamId) {
      if (state.submission.status === "pending") return;
      const selected = state.teamOptions.find(
        (option) => option.teamId === teamId && option.available,
      );
      if (!selected) return;
      const abandonsUnknownRequest = retryPayload !== null;
      retryPayload = null;
      publish({
        ...state,
        selectedTeamId: selected.teamId,
        selectedTeamDisplay: selected.display,
        selectedTeamRevision: selected.revision,
        staleTeam: false,
        idempotencyKey: abandonsUnknownRequest
          ? snapshot.newIdempotencyKey()
          : state.idempotencyKey,
        submission: { status: "idle" },
      });
    },
    setObjective(objective) {
      publish({ ...state, objective });
    },
    addConstraint() {
      updateRows("constraints", [...state.constraints, { key: snapshot.newRowKey(), value: "" }]);
    },
    removeConstraint(key) {
      updateRows(
        "constraints",
        state.constraints.filter((row) => row.key !== key),
      );
    },
    setConstraint(key, value) {
      updateRows(
        "constraints",
        state.constraints.map((row) => (row.key === key ? { ...row, value } : row)),
      );
    },
    addAcceptanceCriterion() {
      updateRows("acceptanceCriteria", [
        ...state.acceptanceCriteria,
        { key: snapshot.newRowKey(), value: "" },
      ]);
    },
    removeAcceptanceCriterion(key) {
      if (state.acceptanceCriteria.length === 1) return;
      updateRows(
        "acceptanceCriteria",
        state.acceptanceCriteria.filter((row) => row.key !== key),
      );
    },
    setAcceptanceCriterion(key, value) {
      updateRows(
        "acceptanceCriteria",
        state.acceptanceCriteria.map((row) => (row.key === key ? { ...row, value } : row)),
      );
    },
    prepareSubmission() {
      if (!state.canSubmit) return null;
      const payload = retryPayload ?? buildRequest(state);
      if (!payload) return null;
      retryPayload = payload;
      publish({ ...state, submission: { status: "pending" } });
      return payload;
    },
    submitSucceeded(input) {
      if (closed || state.submission.status !== "pending") return false;
      retryPayload = null;
      publish({ ...state, submission: { status: "success", ...input } });
      return true;
    },
    submitFailed(input) {
      if (!input.retryable) {
        retryPayload = null;
      }
      publish({
        ...state,
        idempotencyKey: input.retryable ? state.idempotencyKey : snapshot.newIdempotencyKey(),
        submission: { status: "failure", ...input },
      });
    },
  };
}
