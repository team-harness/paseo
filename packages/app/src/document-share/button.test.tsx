/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DocumentShareButton } from "./button";

const state = vi.hoisted(() => ({
  supported: true,
  share: vi.fn(),
  copy: vi.fn(),
  show: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({
      sessions: {
        host: {
          client: { shareDocument: state.share },
          serverInfo: { features: { documentShare: state.supported } },
        },
      },
    }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: state.copy }));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: state.show, error: state.error }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native", () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));
vi.mock("lucide-react-native", () => ({ Share2: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => React.createElement("button", { type: "button", disabled, onClick: onPress }, children),
}));

let container: HTMLDivElement;
let root: Root;
const url = "https://share.example.com/document.html?id=7b853015-bf1a-4c4c-b969-14e1247aef85";
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.supported = true;
  state.share.mockResolvedValue(url);
  state.copy.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(content = "# Unsaved edits", filePath = "docs/design.md") {
  await act(async () =>
    root.render(
      <DocumentShareButton serverId="host" cwd="/repo" path={filePath} content={content} />,
    ),
  );
}
async function click() {
  await act(async () => container.querySelector("button")!.click());
}

test("shares the currently displayed Markdown and copies the returned link", async () => {
  await render();
  await click();
  expect(state.share).toHaveBeenCalledWith({
    cwd: "/repo",
    path: "docs/design.md",
    content: "# Unsaved edits",
  });
  expect(state.copy).toHaveBeenCalledWith(url);
  expect(state.show).toHaveBeenCalledWith("message.actions.shareCopied", {
    variant: "success",
    durationMs: 5000,
  });
});
test("shows update guidance without an RPC on old hosts", async () => {
  state.supported = false;
  await render();
  await click();
  expect(state.share).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith("panels.file.shareUnavailable");
});
test("does not copy on upload failure and allows retry", async () => {
  state.share.mockRejectedValueOnce(new Error("Image missing"));
  await render();
  await click();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.show).toHaveBeenCalledWith("panels.file.shareFailed\nImage missing", {
    variant: "error",
    durationMs: 10000,
  });
  await click();
  expect(state.copy).toHaveBeenCalledWith(url);
});
test("retries clipboard failures without publishing a duplicate", async () => {
  state.copy.mockResolvedValueOnce(false);
  await render();
  await click();
  await click();
  expect(state.share).toHaveBeenCalledTimes(1);
  expect(state.copy).toHaveBeenCalledTimes(2);
});
test("ignores repeated clicks while the upload is pending", async () => {
  let finish!: (value: string) => void;
  state.share.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await click();
  await click();
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(state.share).toHaveBeenCalledTimes(1);
  await act(async () => finish(url));
  expect(container.querySelector("button")!.disabled).toBe(false);
});
test("does not offer document sharing for non-Markdown files", async () => {
  await render("const x = 1", "example.ts");
  expect(container.querySelector("button")).toBeNull();
});
