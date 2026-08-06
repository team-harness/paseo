import { useEffect, useState } from "react";

import { openTeamForm, type TeamFormModel, type TeamFormSnapshot } from "./team-form-model";

/**
 * One model per mount, and it dies with the mount.
 *
 * `useState` rather than `useMemo`: the snapshot's identity depends on live
 * data — the workspace list, the selected host — so a `useMemo` keyed on it
 * would rebuild the model whenever any of that churned in the background, and
 * take whatever the user had typed with it. The sheet unmounts while closed,
 * so a fresh open gets a fresh model.
 */
export function useTeamFormModel(snapshot: TeamFormSnapshot): TeamFormModel {
  const [model] = useState(() => openTeamForm(snapshot));

  useEffect(() => {
    return () => {
      model.close();
    };
  }, [model]);

  return model;
}
