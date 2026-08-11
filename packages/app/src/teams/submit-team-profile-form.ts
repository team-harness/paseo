import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import type {
  TeamProfileCreatePayload,
  TeamProfileFormModel,
  TeamProfileTabDescriptor,
  TeamProfileUpdatePayload,
} from "./team-profile-form-model";

export interface TeamProfileMutationResponse {
  team: TeamV2 | null;
  error: string | null;
  errorCode?: string | null;
}

export interface TeamProfileFormGateway {
  createTeamProfile(input: TeamProfileCreatePayload): Promise<TeamProfileMutationResponse>;
  updateTeamProfile(input: TeamProfileUpdatePayload): Promise<TeamProfileMutationResponse>;
}

export interface TeamProfileFormLabels {
  refused: string;
}

/** Runs one frozen form intent; RPC choice and form state transitions stay out of React. */
export async function submitTeamProfileForm(
  form: TeamProfileFormModel,
  gateway: TeamProfileFormGateway,
  labels: TeamProfileFormLabels,
): Promise<TeamProfileTabDescriptor | null> {
  const intent = form.submitStarted();
  if (!intent) return null;

  try {
    const response =
      intent.mode === "create"
        ? await gateway.createTeamProfile(intent.payload)
        : await gateway.updateTeamProfile(intent.payload);
    if (!response.team) {
      form.submitFailed({
        message: response.error ?? labels.refused,
        outcome: "definite",
      });
      return null;
    }
    return form.submitSucceeded(response.team.id);
  } catch (error) {
    form.submitFailed({
      message: error instanceof Error ? error.message : labels.refused,
      outcome: "unknown",
    });
    return null;
  }
}
