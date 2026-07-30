import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoChatHistory } from "./history";
import { shareChatHistory } from "./upload";

const history: PaseoChatHistory = {
  format: "threadshare-history@v1",
  schemaVersion: 1,
  exportedAt: "2026-07-28T00:00:00.000Z",
  conversation: { id: "agent-1", title: "Shared conversation", source: "paseo" },
  entries: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareChatHistory", () => {
  it("uploads the history to the configured service and returns its viewer URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "7b853015-bf1a-4c4c-b969-14e1247aef85" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareChatHistory({ baseUrl: "https://share.example.com", history })).resolves.toBe(
      "https://share.example.com/?id=7b853015-bf1a-4c4c-b969-14e1247aef85",
    );
    expect(fetchMock).toHaveBeenCalledWith("https://share.example.com/api/v1/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(history),
    });
  });

  it("reports an upload failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      shareChatHistory({ baseUrl: "https://share.example.com", history }),
    ).rejects.toThrow("Unable to upload the shared conversation");
  });

  it("rejects a malformed configured base URL", async () => {
    await expect(shareChatHistory({ baseUrl: "file:///tmp/share", history })).rejects.toThrow(
      "Chat sharing requires an HTTP or HTTPS service URL",
    );
  });
});
