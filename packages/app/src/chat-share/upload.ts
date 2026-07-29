import type { PaseoChatHistory } from "./history";

interface CreateChatShareResponse {
  id: string;
}

function createChatShareUrl(baseUrl: string): URL {
  const shareUrl = new URL("/api/v1/shares", baseUrl);
  if (shareUrl.protocol !== "https:" && shareUrl.protocol !== "http:") {
    throw new Error("Chat sharing requires an HTTP or HTTPS service URL");
  }
  return shareUrl;
}

export async function shareChatHistory(input: {
  baseUrl: string;
  history: PaseoChatHistory;
}): Promise<string> {
  const shareUrl = createChatShareUrl(input.baseUrl);
  const response = await fetch(shareUrl.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.history),
  });
  if (!response.ok) throw new Error("Unable to upload the shared conversation");

  const payload = (await response.json()) as CreateChatShareResponse;
  if (!payload.id || typeof payload.id !== "string") {
    throw new Error("The chat share service returned an invalid response");
  }

  const viewerUrl = new URL("/", shareUrl);
  viewerUrl.searchParams.set("id", payload.id);
  return viewerUrl.toString();
}
