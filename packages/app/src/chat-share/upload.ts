import type { PaseoChatHistory } from "./history";

const CHAT_SHARE_API_URL = "https://paseo-chat-share.bazhuayu.xyz/v1/upload-grant";

interface UploadGrant {
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
  };
  viewerUrl: string;
}

export async function shareChatHistory(history: PaseoChatHistory): Promise<string> {
  const grantResponse = await fetch(CHAT_SHARE_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: history.schemaVersion }),
  });
  if (!grantResponse.ok) throw new Error("Unable to prepare the shared conversation");

  const grant = (await grantResponse.json()) as UploadGrant;
  const uploadResponse = await fetch(grant.upload.url, {
    method: grant.upload.method,
    headers: grant.upload.headers,
    body: JSON.stringify(history),
  });
  if (!uploadResponse.ok) throw new Error("Unable to upload the shared conversation");

  return grant.viewerUrl;
}
