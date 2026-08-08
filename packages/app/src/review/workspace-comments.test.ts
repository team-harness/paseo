import { describe, expect, it } from "vitest";
import type { ReviewDraftComment } from "./state";
import {
  addWorkspaceReviewCommentToState,
  buildWorkspaceReviewKey,
  collectWorkspaceReviewSummaryEntries,
  deleteWorkspaceReviewCommentFromState,
  formatWorkspaceReviewSummary,
  formatWorkspaceReviewSummaryEntries,
  normalizeWorkspaceReviewCommentsState,
  serializeWorkspaceReviewCommentsState,
  trimReviewTextSelection,
  type WorkspaceReviewComment,
  type WorkspaceReviewCommentsState,
} from "./workspace-comments";

function emptyState(): WorkspaceReviewCommentsState {
  return { commentsByWorkspace: {} };
}

function selectionComment(overrides: Partial<WorkspaceReviewComment> = {}): WorkspaceReviewComment {
  return {
    id: "selection-1",
    filePath: "docs/product.md",
    source: "preview",
    quote: "Keep this promise precise.",
    lineStart: 12,
    lineEnd: 12,
    body: "Explain what precise means here.",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function diffComment(overrides: Partial<ReviewDraftComment> = {}): ReviewDraftComment {
  return {
    id: "diff-1",
    filePath: "src/index.ts",
    side: "new",
    lineNumber: 42,
    body: "Handle the empty value before parsing.",
    createdAt: "2026-08-04T00:01:00.000Z",
    updatedAt: "2026-08-04T00:01:00.000Z",
    ...overrides,
  };
}

describe("workspace review scope", () => {
  it("uses workspace identity when available and cwd only as the legacy fallback", () => {
    expect(
      buildWorkspaceReviewKey({
        serverId: " local ",
        workspaceId: " workspace-1 ",
        cwd: "/repo/",
      }),
    ).toBe("workspace-review:server=local:workspace=workspace-1");
    expect(buildWorkspaceReviewKey({ serverId: "local", workspaceId: null, cwd: "/repo/" })).toBe(
      "workspace-review:server=local:cwd=%2Frepo",
    );
  });

  it("collects every diff variant for one workspace without leaking from a same-cwd sibling", () => {
    const workspaceReviewKey = "workspace-review:server=local:workspace=workspace-1";
    const diffDraftPrefix = "review:server=local:workspace=workspace-1:";
    const firstDiff = diffComment({ id: "base", createdAt: "2026-08-04T00:01:00.000Z" });
    const secondDiff = diffComment({
      id: "uncommitted",
      createdAt: "2026-08-04T00:02:00.000Z",
    });
    const leakedDiff = diffComment({ id: "other-workspace" });

    const entries = collectWorkspaceReviewSummaryEntries({
      workspaceReviewKey,
      diffDraftPrefix,
      selectionComments: [selectionComment()],
      diffDrafts: {
        [`${diffDraftPrefix}mode=base:base=main:ignoreWhitespace=false`]: [firstDiff],
        [`${diffDraftPrefix}mode=uncommitted:base=:ignoreWhitespace=true`]: [secondDiff],
        "review:server=local:workspace=workspace-2:mode=base:base=main:ignoreWhitespace=false": [
          leakedDiff,
        ],
      },
    });

    expect(entries.map((entry) => entry.comment.id)).toEqual([
      "selection-1",
      "base",
      "uncommitted",
    ]);
    expect(entries.filter((entry) => entry.kind === "diff").map((entry) => entry.ownerKey)).toEqual(
      [
        `${diffDraftPrefix}mode=base:base=main:ignoreWhitespace=false`,
        `${diffDraftPrefix}mode=uncommitted:base=:ignoreWhitespace=true`,
      ],
    );
  });
});

describe("trimReviewTextSelection", () => {
  it("moves source offsets past whitespace removed from the displayed quote", () => {
    const text = "before\n\n  selected text  \n\nafter";
    const from = text.indexOf("\n\n");
    const to = text.lastIndexOf("\n\n") + 2;

    expect(trimReviewTextSelection({ selectedText: text.slice(from, to), from })).toEqual({
      quote: "selected text",
      from: text.indexOf("selected text"),
      to: text.indexOf("selected text") + "selected text".length,
    });
  });

  it("returns no selection for whitespace-only source ranges", () => {
    expect(trimReviewTextSelection({ selectedText: "\n \t\n", from: 6 })).toBeNull();
  });
});

describe("workspace review comment persistence", () => {
  it("adds and deletes comments without changing other workspace drafts", () => {
    const first = selectionComment();
    const other = selectionComment({ id: "selection-2", filePath: "README.md" });
    let state = addWorkspaceReviewCommentToState(emptyState(), {
      key: "workspace-review:one",
      comment: first,
    });
    state = addWorkspaceReviewCommentToState(state, {
      key: "workspace-review:two",
      comment: other,
    });

    state = deleteWorkspaceReviewCommentFromState(state, {
      key: "workspace-review:one",
      id: first.id,
    });

    expect(state.commentsByWorkspace["workspace-review:one"]).toEqual([]);
    expect(state.commentsByWorkspace["workspace-review:two"]).toEqual([other]);
  });

  it("filters malformed persisted comments and serializes only durable state", () => {
    const valid = selectionComment();
    const normalized = normalizeWorkspaceReviewCommentsState({
      commentsByWorkspace: {
        "workspace-review:one": [valid, { id: "bad", quote: "missing fields" }],
      },
      transientEditor: { open: true },
    });

    expect(normalized).toEqual({
      commentsByWorkspace: { "workspace-review:one": [valid] },
    });
    expect(serializeWorkspaceReviewCommentsState(normalized)).toEqual(normalized);
  });
});

describe("formatWorkspaceReviewSummary", () => {
  it("groups selected-text and diff comments by file in a paste-ready review prompt", () => {
    expect(
      formatWorkspaceReviewSummary({
        selectionComments: [selectionComment()],
        diffComments: [diffComment()],
      }),
    ).toBe(
      [
        "Review comments",
        "",
        "## docs/product.md",
        "Line 12",
        "> Keep this promise precise.",
        "",
        "Explain what precise means here.",
        "",
        "## src/index.ts",
        "Line 42 (new)",
        "Handle the empty value before parsing.",
      ].join("\n"),
    );
  });

  it("returns an empty string when the review has no comments", () => {
    expect(formatWorkspaceReviewSummary({ selectionComments: [], diffComments: [] })).toBe("");
  });

  it("formats an incremental subset without including delivered comments", () => {
    const first = selectionComment({ id: "first", body: "Already delivered" });
    const second = selectionComment({ id: "second", body: "New feedback" });
    const summary = formatWorkspaceReviewSummaryEntries([
      { kind: "selection", ownerKey: "workspace", comment: second },
    ]);

    expect(summary).toContain("New feedback");
    expect(summary).not.toContain(first.body);
  });
});
