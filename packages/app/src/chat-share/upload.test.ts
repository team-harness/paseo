import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoChatHistory } from "./history";
import { shareChatHistory } from "./upload";

const history: PaseoChatHistory = {
  schemaVersion: 1,
  exportedAt: "2026-07-28T00:00:00.000Z",
  conversation: { id: "agent-1", title: "Shared conversation" },
  entries: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareChatHistory", () => {
  it("requests a grant, uploads the JSON, and returns the viewer URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload: {
              method: "PUT",
              url: "https://oss.example.com/history.json",
              headers: { "content-type": "application/json" },
            },
            viewerUrl:
              "https://paseo-chat.bazhuayu.xyz/?history=https%3A%2F%2Fexample.com%2Fhistory.json",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareChatHistory(history)).resolves.toBe(
      "https://paseo-chat.bazhuayu.xyz/?history=https%3A%2F%2Fexample.com%2Fhistory.json",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://paseo-chat-share.bazhuayu.xyz/v1/upload-grant",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ schemaVersion: 1 }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://oss.example.com/history.json",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(history) }),
    );
  });

  it("reports an upload failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload: { method: "PUT", url: "https://oss.example.com/history.json", headers: {} },
            viewerUrl: "https://paseo-chat.bazhuayu.xyz/",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareChatHistory(history)).rejects.toThrow(
      "Unable to upload the shared conversation",
    );
  });
});
