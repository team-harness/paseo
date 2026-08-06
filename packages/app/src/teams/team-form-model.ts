import {
  TEAM_MAX_NON_LEAD_MEMBERS,
  TEAM_NAME_MAX_LENGTH,
} from "@getpaseo/protocol/team/rpc-schemas";

/** A member row the user is editing. Keyed so reordering or removing one cannot move another's input. */
export interface TeamFormMemberRow {
  key: string;
  role: string;
  provider: string;
  /** The label captured when the provider was chosen. Never re-derived from a live list. */
  providerDisplay: string | null;
  briefing: string;
}

export type TeamFormSubmission =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; teamId: string }
  | { status: "failure"; message: string; retryable: boolean };

export interface TeamFormState {
  name: string;
  task: string;
  workspaceId: string;
  workspaceDisplay: string | null;
  leadProvider: string;
  leadProviderDisplay: string | null;
  members: TeamFormMemberRow[];
  /** Which step the user is on. The confirm step is where the cost of a team is stated. */
  step: "compose" | "confirm";
  submission: TeamFormSubmission;
  canAddMember: boolean;
  canSubmit: boolean;
  /** What one submit attempt runs under; kept across retries whose outcome is unknown. */
  idempotencyKey: string;
  /** Non-lead members that would actually be built. */
  memberCount: number;
  /** Every agent the request would start, lead included. */
  agentCount: number;
}

export interface TeamFormTemplate {
  id: string;
  name: string;
  task: string;
  /**
   * The lead's provider. A template names one because the lead uses tools all
   * day — `assign_task`, `team_status`, recruiting — and a provider that is
   * weak at them makes the whole team look broken.
   */
  leadProvider: string;
  members: Array<{ role: string; provider: string; briefing?: string }>;
}

export interface TeamFormSnapshot {
  workspaceId: string | null;
  workspaceDisplay: string | null;
  template: TeamFormTemplate | null;
  /** Injected so a test does not need a clock or a random source. */
  newIdempotencyKey: () => string;
  newRowKey: () => string;
}

export interface TeamFormModel {
  getState: () => TeamFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  setName: (value: string) => void;
  setTask: (value: string) => void;
  setWorkspace: (workspaceId: string, display: string | null) => void;
  setLeadProvider: (provider: string, display: string | null) => void;
  addMember: () => void;
  removeMember: (key: string) => void;
  setMemberRole: (key: string, role: string) => void;
  setMemberProvider: (key: string, provider: string, display: string | null) => void;
  setMemberBriefing: (key: string, briefing: string) => void;
  review: () => void;
  backToCompose: () => void;
  submitStarted: () => void;
  submitSucceeded: (teamId: string) => void;
  submitFailed: (failure: { message: string; retryable: boolean }) => void;
}

function trimmedLength(value: string): number {
  return value.trim().length;
}

function isComplete(state: TeamFormState): boolean {
  if (trimmedLength(state.name) === 0 || trimmedLength(state.name) > TEAM_NAME_MAX_LENGTH) {
    return false;
  }
  if (trimmedLength(state.task) === 0) return false;
  if (trimmedLength(state.workspaceId) === 0) return false;
  if (trimmedLength(state.leadProvider) === 0) return false;
  // A member row that is half filled in is not a member the daemon can build,
  // and silently dropping it would build a smaller team than the user drew.
  return state.members.every(
    (member) => trimmedLength(member.role) > 0 && trimmedLength(member.provider) > 0,
  );
}

function derive(state: TeamFormState): TeamFormState {
  const memberCount = state.members.length;
  return {
    ...state,
    memberCount,
    agentCount: memberCount + 1,
    canAddMember: memberCount < TEAM_MAX_NON_LEAD_MEMBERS,
    // Never while a submit is in flight: a second one under the same key would
    // be answered with the first one's team, and under a new key would build a
    // second team.
    canSubmit: isComplete(state) && state.submission.status !== "pending",
  };
}

export function openTeamForm(snapshot: TeamFormSnapshot): TeamFormModel {
  const listeners = new Set<() => void>();
  let closed = false;

  const template = snapshot.template;
  let state = derive({
    name: template?.name ?? "",
    task: template?.task ?? "",
    workspaceId: snapshot.workspaceId ?? "",
    workspaceDisplay: snapshot.workspaceDisplay,
    leadProvider: template?.leadProvider ?? "",
    leadProviderDisplay: template ? template.leadProvider : null,
    members: (template?.members ?? []).map((member) => ({
      key: snapshot.newRowKey(),
      role: member.role,
      provider: member.provider,
      providerDisplay: member.provider,
      briefing: member.briefing ?? "",
    })),
    step: "compose",
    submission: { status: "idle" },
    canAddMember: true,
    canSubmit: false,
    idempotencyKey: snapshot.newIdempotencyKey(),
    memberCount: 0,
    agentCount: 1,
  });

  function publish(next: TeamFormState): void {
    if (closed) return;
    state = derive(next);
    for (const listener of listeners) listener();
  }

  function updateMember(key: string, change: (row: TeamFormMemberRow) => TeamFormMemberRow): void {
    publish({
      ...state,
      members: state.members.map((member) => (member.key === key ? change(member) : member)),
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setName(value) {
      publish({ ...state, name: value });
    },
    setTask(value) {
      publish({ ...state, task: value });
    },
    setWorkspace(workspaceId, display) {
      publish({ ...state, workspaceId, workspaceDisplay: display });
    },
    setLeadProvider(provider, display) {
      publish({ ...state, leadProvider: provider, leadProviderDisplay: display });
    },
    addMember() {
      if (!state.canAddMember) return;
      publish({
        ...state,
        members: [
          ...state.members,
          {
            key: snapshot.newRowKey(),
            role: "",
            provider: "",
            providerDisplay: null,
            briefing: "",
          },
        ],
      });
    },
    removeMember(key) {
      publish({ ...state, members: state.members.filter((member) => member.key !== key) });
    },
    setMemberRole(key, role) {
      updateMember(key, (member) => ({ ...member, role }));
    },
    setMemberProvider(key, provider, display) {
      updateMember(key, (member) => ({ ...member, provider, providerDisplay: display }));
    },
    setMemberBriefing(key, briefing) {
      updateMember(key, (member) => ({ ...member, briefing }));
    },
    review() {
      if (!state.canSubmit) return;
      publish({ ...state, step: "confirm" });
    },
    backToCompose() {
      publish({ ...state, step: "compose" });
    },
    submitStarted() {
      publish({ ...state, submission: { status: "pending" } });
    },
    submitSucceeded(teamId) {
      publish({ ...state, submission: { status: "success", teamId } });
    },
    submitFailed(failure) {
      publish({
        ...state,
        submission: { status: "failure", ...failure },
        // A definite failure is a new decision, so the next attempt needs a new
        // key or the daemon keeps handing back the team that failed. A retry
        // whose outcome nobody learned keeps this one.
        idempotencyKey: failure.retryable ? state.idempotencyKey : snapshot.newIdempotencyKey(),
      });
    },
  };
}
