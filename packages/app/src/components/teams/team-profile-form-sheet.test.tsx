// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { MethodologyDescriptor } from "@getpaseo/protocol/team/v2-rpc-schemas";
import type { TeamV2 } from "@getpaseo/protocol/team/v2-types";

import { TEST_METHODOLOGY, testTeamMethodologyBinding } from "@/teams/test-fixtures";

const noop = () => {};

const STRICT_METHODOLOGY: MethodologyDescriptor = {
  ...TEST_METHODOLOGY,
  ref: {
    bundleId: "portable/software-delivery",
    version: "1",
    digest: `sha256:${"1".repeat(64)}`,
  },
  name: "Software delivery",
  presets: [
    {
      ...TEST_METHODOLOGY.presets[0]!,
      presetId: "strict",
      name: "Strict delivery",
      slots: [
        {
          ...TEST_METHODOLOGY.presets[0]!.slots[0]!,
          suggestedRole: "Independent implementer",
        },
      ],
    },
  ],
  policySummary: {
    ...TEST_METHODOLOGY.policySummary,
    review: {
      ...TEST_METHODOLOGY.policySummary.review,
      writableWorkstreams: "independent_required",
    },
  },
};

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({
      visible,
      children,
      footer,
    }: {
      visible: boolean;
      children: React.ReactNode;
      footer?: React.ReactNode;
    }) => (visible ? ReactModule.createElement("div", null, children, footer) : null),
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
    FormTextInput: ({
      testID,
      value,
      onChangeText,
    }: {
      testID?: string;
      value?: string;
      onChangeText?: (value: string) => void;
    }) =>
      ReactModule.createElement("input", {
        "data-testid": testID,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
      }),
  };
});

vi.mock("@/components/ui/select-field", async () => {
  const ReactModule = await import("react");
  return {
    SelectField: ({
      testID,
      value,
      options = [],
      onChange,
      disabled,
    }: {
      testID?: string;
      value?: string | number | null;
      options?: Array<{ value: string | number }>;
      onChange?: (value: string | number) => void;
      disabled?: boolean;
    }) =>
      ReactModule.createElement("button", {
        "data-testid": testID,
        "data-value": value ?? "",
        type: "button",
        disabled,
        onClick: () => {
          const selection = options.at(-1);
          if (selection) onChange?.(selection.value);
        },
      }),
    SelectFieldTrigger: ({ testID }: { testID?: string }) =>
      ReactModule.createElement("div", { "data-testid": testID }),
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      testID,
      onPress,
    }: {
      children: React.ReactNode;
      testID?: string;
      onPress?: () => void;
    }) =>
      ReactModule.createElement(
        "button",
        { "data-testid": testID, type: "button", onClick: onPress },
        children,
      ),
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

const TEST_AGENT_PROFILE = {
  id: "profile-reviewer",
  name: "Reviewer profile",
  provider: "codex",
  model: "gpt-5",
} as AgentProfile;

function editTeam(): TeamV2 {
  return {
    id: "team-edit",
    name: "Editable Team",
    creationWorkspaceId: "workspace-archived",
    leadMemberId: "member-lead",
    skills: [{ skillId: "typescript", name: "TypeScript", description: null }],
    members: [
      {
        memberId: "member-lead",
        role: "Lead",
        level: 5,
        skillIds: ["typescript"],
        executionProfile: {
          provider: "codex",
          model: "gpt-5",
          modeId: null,
          thinkingOptionId: null,
          featureValues: {},
        },
        executionProfileSource: {
          kind: "agent_profile",
          profileId: "profile-old",
          resolverVersion: 1,
          appliedDigest: `sha256:${"0".repeat(64)}`,
        },
        mentionHandle: "lead",
      },
    ],
    methodologyBinding: testTeamMethodologyBinding(["member-lead"], ["typescript"]),
    lifecycle: "active",
    activeMissionId: null,
    lifecycleRecoveryFailure: null,
    revision: 2,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    archivedAt: null,
  };
}

describe("TeamProfileFormSheet", () => {
  afterEach(cleanup);

  it("reveals the editable Team only after the user confirms a template", () => {
    render(
      <TeamProfileFormSheet
        serverId="server-a"
        workspaceId="workspace-a"
        cwd="/work/a"
        methodologies={[TEST_METHODOLOGY, STRICT_METHODOLOGY]}
        catalogStatus="ready"
        visible
        onClose={noop}
      />,
    );

    expect(screen.getByTestId("team-profile-name")).toBeTruthy();
    expect(screen.getByTestId("team-profile-template-guide")).toBeTruthy();
    expect(screen.queryByTestId("team-profile-methodology")).toBeNull();
    expect(screen.queryByTestId("team-profile-skill-0-name")).toBeNull();
    expect(screen.queryByTestId("team-profile-member-0-role")).toBeNull();
    expect(screen.queryByText(/lead_discretion/)).toBeNull();

    fireEvent.click(screen.getByTestId("team-profile-preset"));

    expect(screen.queryByTestId("team-profile-template-guide")).toBeNull();
    expect(screen.getByTestId("team-profile-skill-0-name")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-role")).toBeTruthy();
    expect((screen.getByTestId("team-profile-member-0-role") as HTMLInputElement).value).toBe(
      "Independent implementer",
    );
    expect(screen.getByTestId("team-profile-preset").getAttribute("data-value")).toContain(
      '"strict"',
    );
    expect(screen.getByTestId("team-profile-member-0-heading")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-level")).toBeTruthy();
    expect(screen.getByTestId("team-profile-member-0-model-trigger")).toBeTruthy();
    expect(screen.queryByTestId("team-profile-task")).toBeNull();
    expect(screen.queryByTestId("team-profile-member-0-responsibility")).toBeNull();
  });

  it("detaches a sourced Member without a live creation workspace", () => {
    render(
      <TeamProfileFormSheet
        serverId="server-a"
        profile={editTeam()}
        agentProfiles={[]}
        visible
        onClose={noop}
      />,
    );

    const source = screen.getByTestId("team-profile-member-0-execution-source");
    expect(source.getAttribute("data-value")).toBe("profile:profile-old");
    fireEvent.click(source);
    expect(source.getAttribute("data-value")).toBe("inline");
    expect(screen.getByTestId("team-profile-member-0-model-trigger")).toBeTruthy();
  });

  it("rebinds a sourced Member to another Agent Profile", () => {
    render(
      <TeamProfileFormSheet
        serverId="server-a"
        profile={editTeam()}
        agentProfiles={[TEST_AGENT_PROFILE]}
        visible
        onClose={noop}
      />,
    );

    const source = screen.getByTestId("team-profile-member-0-execution-source");
    fireEvent.click(source);
    expect(source.getAttribute("data-value")).toBe("profile:profile-reviewer");
  });

  it.each([
    ["loading", "team-profile-catalog-loading"],
    ["failed", "team-profile-catalog-failed"],
    ["update_host", "team-profile-catalog-update-host"],
  ] as const)(
    "does not construct an empty create form while the catalog is %s",
    (status, testID) => {
      render(
        <TeamProfileFormSheet
          serverId="server-a"
          workspaceId="workspace-a"
          cwd="/work/a"
          catalogStatus={status}
          visible
          onClose={noop}
        />,
      );

      expect(screen.getByTestId(testID)).toBeTruthy();
      expect(screen.queryByTestId("team-profile-name")).toBeNull();
    },
  );

  it("offers retry when the Methodology catalog load fails", () => {
    const retry = vi.fn();
    render(
      <TeamProfileFormSheet
        serverId="server-a"
        workspaceId="workspace-a"
        cwd="/work/a"
        catalogStatus="failed"
        catalogError="catalog unavailable"
        onRetryCatalog={retry}
        visible
        onClose={noop}
      />,
    );

    expect(screen.getByText("catalog unavailable")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-profile-catalog-retry"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("preserves the opened form and its catalog snapshot across reconnect", () => {
    const retry = vi.fn();
    const props = {
      serverId: "server-a",
      workspaceId: "workspace-a",
      cwd: "/work/a",
      methodologies: [TEST_METHODOLOGY],
      agentProfiles: [TEST_AGENT_PROFILE],
      visible: true,
      onClose: noop,
      onRetryCatalog: retry,
    } as const;
    const { rerender } = render(<TeamProfileFormSheet {...props} catalogStatus="ready" />);

    fireEvent.change(screen.getByTestId("team-profile-name"), {
      target: { value: "Durable Team" },
    });
    fireEvent.click(screen.getByTestId("team-profile-preset"));
    fireEvent.change(screen.getByTestId("team-profile-member-0-role"), {
      target: { value: "Review lead" },
    });
    fireEvent.click(screen.getByTestId("team-profile-member-0-execution-source"));

    expect((screen.getByTestId("team-profile-skill-0-name") as HTMLInputElement).value).toBe(
      "TypeScript",
    );
    expect((screen.getByTestId("team-profile-member-0-role") as HTMLInputElement).value).toBe(
      "Review lead",
    );
    expect(
      screen.getByTestId("team-profile-member-0-execution-source").getAttribute("data-value"),
    ).toBe("profile:profile-reviewer");

    rerender(<TeamProfileFormSheet {...props} catalogStatus="connecting" />);
    expect((screen.getByTestId("team-profile-name") as HTMLInputElement).value).toBe(
      "Durable Team",
    );
    expect((screen.getByTestId("team-profile-skill-0-name") as HTMLInputElement).value).toBe(
      "TypeScript",
    );
    expect((screen.getByTestId("team-profile-member-0-role") as HTMLInputElement).value).toBe(
      "Review lead",
    );

    rerender(
      <TeamProfileFormSheet
        {...props}
        catalogStatus="failed"
        catalogError="catalog disconnected"
      />,
    );
    expect(screen.getByText("catalog disconnected")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-profile-catalog-retry"));
    expect(retry).toHaveBeenCalledOnce();
    expect((screen.getByTestId("team-profile-name") as HTMLInputElement).value).toBe(
      "Durable Team",
    );

    rerender(<TeamProfileFormSheet {...props} catalogStatus="ready" />);
    expect((screen.getByTestId("team-profile-name") as HTMLInputElement).value).toBe(
      "Durable Team",
    );
    expect(screen.getByTestId("team-profile-preset").getAttribute("data-value")).toContain(
      '"standard"',
    );
    expect(
      screen.getByTestId("team-profile-member-0-execution-source").getAttribute("data-value"),
    ).toBe("profile:profile-reviewer");
  });
});
