// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamRoomMessage } from "@getpaseo/protocol/team/v2-types";

vi.stubGlobal("React", React);

const postTeamMissionMessage = vi.fn();
const loadOlder = vi.fn();
const roomMessages: TeamRoomMessage[] = [];
let roomHasOlder = false;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { author?: string }) =>
      options?.author ? `${key}: ${options.author}` : key,
  }),
}));

vi.mock("react-native", () => ({
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
  }: {
    data: TeamRoomMessage[];
    renderItem: (input: { item: TeamRoomMessage }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
  }) =>
    React.createElement(
      "div",
      null,
      ListHeaderComponent,
      data.map((item) =>
        React.createElement(React.Fragment, { key: item.id }, renderItem({ item })),
      ),
    ),
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
  Reply: () => null,
  RotateCw: () => null,
  SendHorizontal: () => null,
  Settings2: () => null,
  X: () => null,
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
    timeline: {
      messages: roomMessages,
      liveCursor: roomMessages.length,
      oldestCursor: roomHasOlder ? 1 : 0,
      hasOlder: roomHasOlder,
    },
    error: null,
    historyError: null,
    loading: false,
    loadingOlder: false,
    retry: () => undefined,
    loadOlder,
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
    roomMessages.length = 0;
    roomHasOlder = false;
    loadOlder.mockReset();
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

  it("replies to an inactive member and shows the Lead actually notified", async () => {
    roomMessages.push({
      ...POSTED_MESSAGE,
      id: "message-agent",
      authorAgentId: "old-agent",
      author: { kind: "agent", id: "old-agent" },
      body: "Please check the release",
    });
    postTeamMissionMessage.mockResolvedValue({
      message: {
        ...POSTED_MESSAGE,
        id: "message-reply",
        replyToMessageId: "message-agent",
        mentionAgentIds: ["lead-agent"],
      },
      error: null,
    });
    const roster = [
      {
        memberId: "member-old",
        agentId: "old-agent",
        role: "Reviewer",
        mentionHandle: "reviewer",
        active: false,
        isLead: false,
        agent: null,
      },
      {
        memberId: "member-lead",
        agentId: "lead-agent",
        role: "Lead",
        mentionHandle: "lead",
        active: true,
        isLead: true,
        agent: null,
      },
    ];
    render(
      <TeamRoom
        serverId="server-1"
        missionId="mission-1"
        roster={roster}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("team-room-message-message-agent-reply"));
    expect(screen.getByTestId("team-room-reply-target").textContent).toContain("Reviewer");
    expect(screen.getByTestId("team-room-reply-routing").textContent).toContain(
      "teams.room.replyLeadFallback",
    );
    fireEvent.change(screen.getByTestId("team-room-composer"), {
      target: { value: "@lead Done" },
    });
    expect(screen.getByTestId("team-room-reply-routing").textContent).toContain(
      "teams.room.replyLeadFallback",
    );
    fireEvent.click(screen.getByTestId("team-room-send"));

    await waitFor(() => expect(postTeamMissionMessage).toHaveBeenCalledOnce());
    expect(postTeamMissionMessage.mock.calls[0]?.[0]).toMatchObject({
      body: "@lead Done",
      replyToMessageId: "message-agent",
    });
    expect(screen.getByTestId("team-room-post-receipt").textContent).toContain("@lead");
  });

  it("loads earlier messages from the room header", () => {
    roomMessages.push(POSTED_MESSAGE);
    roomHasOlder = true;
    render(
      <TeamRoom serverId="server-1" missionId="mission-1" roster={[]} onOpenSettings={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId("team-room-load-older"));
    expect(loadOlder).toHaveBeenCalledOnce();
  });

  it("cancels a reply and hides reply actions in a terminal room", () => {
    roomMessages.push(POSTED_MESSAGE);
    const { rerender } = render(
      <TeamRoom serverId="server-1" missionId="mission-1" roster={[]} onOpenSettings={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("team-room-message-message-1-reply"));
    fireEvent.click(screen.getByTestId("team-room-cancel-reply"));
    expect(screen.queryByTestId("team-room-reply-target")).toBeNull();

    rerender(
      <TeamRoom
        serverId="server-1"
        missionId="mission-1"
        roster={[]}
        readOnly
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("team-room-message-message-1-reply")).toBeNull();
    expect(screen.queryByTestId("team-room-composer")).toBeNull();
  });

  it("keeps the selected reply target when a reconnect replaces the newest page", () => {
    roomMessages.push(POSTED_MESSAGE);
    const { rerender } = render(
      <TeamRoom serverId="server-1" missionId="mission-1" roster={[]} onOpenSettings={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("team-room-message-message-1-reply"));

    roomMessages.length = 0;
    rerender(
      <TeamRoom serverId="server-1" missionId="mission-1" roster={[]} onOpenSettings={vi.fn()} />,
    );

    expect(screen.getByTestId("team-room-reply-target").textContent).toContain("Status update");
  });
});
