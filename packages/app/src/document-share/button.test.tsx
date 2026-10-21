/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DocumentShareButton } from "./button";
import type { ReviewTextSelection } from "@/review/workspace-comments";
import {
  FilePanelReviewActions,
  FilePanelReviewProvider,
  FilePanelReviewSurface,
  useFilePanelReviewContent,
} from "@/review/file-panel-review";

const state = vi.hoisted(() => ({
  supported: true,
  share: vi.fn(),
  copy: vi.fn(),
  show: vi.fn(),
  error: vi.fn(),
  addComment: vi.fn(),
}));
vi.mock("@/review/summary-trigger", () => ({ ReviewSummaryTrigger: () => null }));
vi.mock("@/review/selection-comment-trigger", () => ({
  ReviewSelectionCommentTrigger: ({
    selection,
    onComment,
  }: {
    selection: ReviewTextSelection | null;
    onComment: (selection: ReviewTextSelection, body: string) => void;
  }) => {
    const press = React.useCallback(() => {
      if (selection) onComment(selection, "Fix source");
    }, [selection, onComment]);
    return selection ? (
      <button type="button" onClick={press}>
        Source comment
      </button>
    ) : null;
  },
}));
vi.mock("@/review/selection-surface", () => ({
  ReviewSelectionSurface: ({
    children,
    onComment,
  }: {
    children: React.ReactNode;
    onComment: (selection: ReviewTextSelection, body: string) => void;
  }) => {
    const press = React.useCallback(
      () => onComment({ quote: "Preview phrase", lineStart: null, lineEnd: null }, "Fix preview"),
      [onComment],
    );
    return (
      <div>
        {children}
        <button type="button" onClick={press}>
          Preview comment
        </button>
      </div>
    );
  },
}));
vi.mock("@/review/workspace-comments-store", () => ({
  addWorkspaceReviewComment: state.addComment,
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

function PanelDraft({ content }: { content: string }) {
  const select = useFilePanelReviewContent(content);
  const press = React.useCallback(
    () => select?.({ quote: "Source phrase", lineStart: 4, lineEnd: 5 }),
    [select],
  );
  return (
    <button type="button" onClick={press}>
      Select source
    </button>
  );
}

test("file panels share unsaved drafts and clear sharing when the text panel unmounts", async () => {
  const panel = (content: string | null) => (
    <FilePanelReviewProvider serverId="host" workspaceId="workspace-1" cwd="/repo" path="doc.md">
      <FilePanelReviewActions />
      {content !== null ? <PanelDraft content={content} /> : null}
    </FilePanelReviewProvider>
  );
  await act(async () => root.render(panel("# Disk copy")));
  await act(async () => root.render(panel("# Unsaved revision")));
  await click();
  expect(state.share).toHaveBeenCalledWith({
    cwd: "/repo",
    path: "doc.md",
    content: "# Unsaved revision",
  });
  await act(async () => root.render(panel(null)));
  expect(container.querySelector("button")).toBeNull();
});

test("preview and source comments retain workspace identity and precise source lines", async () => {
  await act(async () =>
    root.render(
      <FilePanelReviewProvider serverId="host" workspaceId="workspace-1" cwd="/repo" path="doc.md">
        <FilePanelReviewActions />
        <PanelDraft content="# Draft" />
        <FilePanelReviewSurface>
          <span>Preview phrase</span>
        </FilePanelReviewSurface>
      </FilePanelReviewProvider>,
    ),
  );
  const press = async (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    );
  await press("Select source");
  await press("Source comment");
  await press("Preview comment");
  const [source, preview] = state.addComment.mock.calls.map(([input]) => input);
  expect(source.key).toBe(preview.key);
  expect(source.key).toContain("workspace-1");
  expect(source.comment).toMatchObject({
    filePath: "doc.md",
    source: "source",
    lineStart: 4,
    lineEnd: 5,
    body: "Fix source",
  });
  expect(preview.comment).toEqual({
    filePath: "doc.md",
    source: "preview",
    quote: "Preview phrase",
    lineStart: null,
    lineEnd: null,
    body: "Fix preview",
  });
});

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
