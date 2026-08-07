import { WebSocket } from "ws";

const ROOM = "0b8b35df-59de-4004-9135-26736e5ed2d4";
const body = process.argv[2] ?? "ping";
const ws = new WebSocket("ws://localhost:6768/ws");

const timer = setTimeout(() => {
  console.error("超时");
  process.exit(1);
}, 20000);

let posted = false;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      clientId: "human-smoke-probe",
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
        message: { type: "chat/post", requestId: "human-1", room: ROOM, body },
      }),
    );
    return;
  }

  if (msg.type === "chat/post/response") {
    console.log("error:", msg.payload.error);
    console.log("message:", JSON.stringify(msg.payload.message, null, 2));
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

ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});
