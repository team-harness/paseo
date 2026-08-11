// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const noop = () => {};

const mocked = vi.hoisted(() => ({ profiles: new Map() }));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-a": {
          serverInfo: { features: { teamMissions: true } },
          teamMissionsReplica: { profiles: mocked.profiles },
        },
      },
    }),
}));
vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactModule.createElement("div", null, children) : null,
    AdaptiveTextInput: ReactModule.forwardRef(
      (
        props: React.InputHTMLAttributes<HTMLInputElement>,
        ref: React.ForwardedRef<HTMLInputElement>,
      ) => ReactModule.createElement("input", { ...props, ref }),
    ),
  };
});
vi.mock("@/components/ui/form-field", async () => {
  const ReactModule = await import("react");
  return {
    Field: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    FormTextInput: ({ testID, value }: { testID?: string; value?: string }) =>
      ReactModule.createElement("input", { "data-testid": testID, value, readOnly: true }),
  };
});
vi.mock("@/components/ui/select-field", async () => {
  const ReactModule = await import("react");
  return {
    SelectField: ({ testID }: { testID?: string }) =>
      ReactModule.createElement("div", { "data-testid": testID }),
  };
});
vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      ReactModule.createElement("button", { "data-testid": testID, type: "button" }, children),
  };
});

import { MissionStartSheet } from "./mission-start-sheet";

describe("MissionStartSheet", () => {
  afterEach(cleanup);

  it("starts work from a Team selection, objective, constraints and acceptance criteria", () => {
    render(
      <MissionStartSheet serverId="server-a" workspaceId="workspace-a" visible onClose={noop} />,
    );

    expect(screen.getByTestId("mission-start-team")).toBeTruthy();
    expect(screen.getByTestId("mission-start-objective")).toBeTruthy();
    expect(screen.getByTestId("mission-start-add-constraint")).toBeTruthy();
    expect(screen.getByTestId("mission-start-acceptance-0")).toBeTruthy();
  });
});
