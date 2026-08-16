// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

vi.stubGlobal("React", React);

const postTeamMissionMessage = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-native", () => ({
  FlatList: () => null,
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  TextInput: ({
    value,
    onChangeText,
    testID,
  }: {
    value: string;
    onChangeText?: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement("input", {
      value,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
      "data-testid": testID,
    }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
}));

vi.mock("lucide-react-native", () => ({
  ArrowLeft: () => null,
  RotateCw: () => null,
  SendHorizontal: () => null,
  Settings2: () => null,
}));

vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.mock("@/components/teams/member-avatar", () => ({ MemberAvatar: () => null }));
vi.mock("@/components/ui/autocomplete", () => ({ Autocomplete: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { type: "button", onClick: onPress, "data-testid": testID },
      children,
    ),
}));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/hooks/use-autocomplete", () => ({
  useAutocomplete: () => ({ selectedIndex: 0, onKeyPress: () => undefined }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ postTeamMissionMessage }),
}));
vi.mock("@/teams/use-room-subscription", () => ({
  useRoomSubscription: () => ({
    timeline: { messages: [], cursor: 0, hasMore: false },
    error: null,
    loading: false,
    retry: () => undefined,
  }),
}));
vi.mock("@/teams/use-team-room-scroll-retention", () => ({
  useTeamRoomScrollRetention: () => ({
    onContentSizeChange: () => undefined,
    onLayout: () => undefined,
    onScroll: () => undefined,
    onScrollBeginDrag: () => undefined,
  }),
}));
vi.mock("@/utils/text-input-selection", () => ({
  setTextInputSelection: () => undefined,
}));

import { TeamRoom } from "./team-room";

const POSTED_MESSAGE: TeamRoomMessage = {
  id: "message-1",
  missionId: "mission-1",
  roomId: "room-1",
  authorAgentId: "user-1",
  author: { kind: "human", id: "user-1" },
  body: "Status update",
  replyToMessageId: null,
  mentionAgentIds: [],
  createdAt: "2026-08-16T00:00:00.000Z",
};

describe("TeamRoom composer", () => {
  afterEach(() => {
    cleanup();
    postTeamMissionMessage.mockReset();
    vi.restoreAllMocks();
  });

  it("reuses the same request id when a failed post is retried", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    postTeamMissionMessage
      .mockResolvedValueOnce({ message: null, error: "try again" })
      .mockResolvedValueOnce({ message: POSTED_MESSAGE, error: null });
    render(
      <TeamRoom serverId="server-1" missionId="mission-1" roster={[]} onOpenSettings={vi.fn()} />,
    );

    fireEvent.change(screen.getByTestId("team-room-composer"), {
      target: { value: "Status update" },
    });
    fireEvent.click(screen.getByTestId("team-room-send"));
    await waitFor(() => expect(screen.getByTestId("team-room-post-error")).toBeTruthy());
    expect(screen.getByTestId("team-room-composer")).toHaveProperty("value", "Status update");

    fireEvent.click(screen.getByTestId("team-room-send"));
    await waitFor(() => expect(postTeamMissionMessage).toHaveBeenCalledTimes(2));

    expect(postTeamMissionMessage.mock.calls[0]?.[0].requestId).toBe(
      "team-room-00000000-0000-4000-8000-000000000001",
    );
    expect(postTeamMissionMessage.mock.calls[1]?.[0].requestId).toBe(
      postTeamMissionMessage.mock.calls[0]?.[0].requestId,
    );
  });
});
