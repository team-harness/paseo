// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const noop = () => {};

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
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

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
}));

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
    SelectFieldTrigger: ({ testID }: { testID?: string }) =>
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

vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));

vi.mock("@/components/combined-model-selector", async () => {
  const ReactModule = await import("react");
  return {
    CombinedModelSelector: ({
      renderTrigger,
    }: {
      renderTrigger: (input: object) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        ReactModule.Fragment,
        null,
        renderTrigger({
          selectedModelLabel: "",
          onPress: () => {},
          disabled: false,
          isOpen: false,
          hovered: false,
          pressed: false,
        }),
      ),
  };
});

vi.mock("@/teams/use-team-profile-form-provider-snapshot", () => ({
  useTeamProfileFormProviderSnapshot: () => ({ isLoading: false, isFetching: false }),
}));

import { TeamProfileFormSheet } from "./team-profile-form-sheet";

describe("TeamProfileFormSheet", () => {
  afterEach(cleanup);

  it("creates a Team from skills, member level, role and execution profile only", () => {
    render(
      <TeamProfileFormSheet
        serverId="server-a"
        workspaceId="workspace-a"
        cwd="/work/a"
        visible
        onClose={noop}
      />,
    );

    expect(screen.getByTestId("team-profile-name")).toBeTruthy();
    expect(screen.getByTestId("team-profile-skill-0-name")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-role")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-level")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-model-trigger")).toBeTruthy();
    expect(screen.queryByTestId("team-profile-task")).toBeNull();
    expect(screen.queryByTestId("team-profile-member-0-responsibility")).toBeNull();
  });
});
