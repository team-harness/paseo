import { useEffect, useState } from "react";

import { openMissionStartForm, type MissionStartFormSnapshot } from "./mission-start-form-model";

export function useMissionStartFormModel(snapshot: MissionStartFormSnapshot) {
  const [model] = useState(() => openMissionStartForm(snapshot));

  useEffect(() => {
    return () => model.close();
  }, [model]);

  useEffect(() => {
    model.setAccess(snapshot.access);
    model.applyTeams({
      serverId: snapshot.serverId,
      workspaceId: snapshot.workspaceId,
      teams: snapshot.teams,
    });
  }, [model, snapshot.access, snapshot.serverId, snapshot.teams, snapshot.workspaceId]);

  return model;
}
