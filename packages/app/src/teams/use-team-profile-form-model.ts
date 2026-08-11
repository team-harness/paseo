import { useEffect, useState } from "react";

import { openTeamProfileForm, type TeamProfileFormSnapshot } from "./team-profile-form-model";

/** Owns exactly one non-React form model for this mounted create/edit form. */
export function useTeamProfileFormModel(snapshot: TeamProfileFormSnapshot) {
  const [model] = useState(() => openTeamProfileForm(snapshot));
  const workspaceId =
    snapshot.mode === "edit" ? snapshot.profile.workspaceId : snapshot.workspaceId;

  useEffect(() => {
    return () => model.close();
  }, [model]);

  useEffect(() => {
    model.applyHostSnapshot(snapshot.hostSnapshot ?? { workspaceId, serverId: null, cwd: null });
  }, [model, snapshot.hostSnapshot, workspaceId]);

  return model;
}
