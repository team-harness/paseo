import type { MissionStartFormModel, MissionStartRequestInput } from "./mission-start-form-model";

export interface MissionStartGateway {
  startTeamMission(input: MissionStartRequestInput): Promise<{
    mission: { id: string; teamId: string } | null;
    error: string | null;
    errorCode: string | null;
  }>;
}

export interface MissionStartTeamTarget {
  kind: "team";
  teamId: string;
}

export async function submitMissionStartForm(
  form: MissionStartFormModel,
  gateway: MissionStartGateway,
  fallbackError: string,
): Promise<MissionStartTeamTarget | null> {
  const request = form.prepareSubmission();
  if (!request) return null;

  try {
    const result = await gateway.startTeamMission(request);
    if (!result.mission || result.mission.teamId !== request.teamId) {
      form.submitFailed({
        message: result.error ?? fallbackError,
        retryable: false,
      });
      return null;
    }

    if (!form.submitSucceeded({ missionId: result.mission.id, teamId: request.teamId })) {
      return null;
    }
    return { kind: "team", teamId: request.teamId };
  } catch (error) {
    form.submitFailed({
      message: error instanceof Error ? error.message : fallbackError,
      retryable: true,
    });
    return null;
  }
}
