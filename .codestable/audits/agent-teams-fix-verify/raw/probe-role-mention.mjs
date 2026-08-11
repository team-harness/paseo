/**
 * Posts one human message into a team room and reports what the daemon stored
 * as `mentionAgentIds`.
 *
 * The A/B from the smoke run: `@docs` used to parse to the literal token
 * "docs", which resolved to nobody. Run it with a role name and again with a
 * full agent id to compare what the room records and who wakes up.
 *
 *   node probe-role-mention.mjs <roomId> "<body>" [port]
 *
 * `chat/post` has to travel inside a `{type:"session", message:{…}}` envelope;
 * a top-level type is rejected by inbound validation.
 */
import { WebSocket } from "ws";

const room = process.argv[2];
const body = process.argv[3] ?? "ping";
const port = process.argv[4] ?? "6768";
const ws = new WebSocket(`ws://localhost:${port}/ws`);

const timer = setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 20000);

let posted = false;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      clientId: "role-mention-probe",
      clientType: "cli",
      protocolVersion: 1,
      capabilities: {},
    }),
  );
});

ws.on("message", (raw) => {
  const outer = JSON.parse(raw.toString());
  const msg = outer.type === "session" ? outer.message : outer;

  if (!posted && msg.type === "status") {
    posted = true;
    ws.send(
      JSON.stringify({
        type: "session",
        message: { type: "chat/post", requestId: "probe-1", room, body },
      }),
    );
    return;
  }

  if (msg.type === "chat/post/response") {
    console.log(
      JSON.stringify(
        {
          error: msg.payload.error,
          messageId: msg.payload.message?.id,
          createdAt: msg.payload.message?.createdAt,
          mentionAgentIds: msg.payload.message?.mentionAgentIds,
        },
        null,
        2,
      ),
    );
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }

  if (msg.type === "rpc_error") {
    console.log("rpc_error:", JSON.stringify(msg));
    clearTimeout(timer);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (error) => {
  console.error("ws error:", error.message);
  process.exit(1);
});
