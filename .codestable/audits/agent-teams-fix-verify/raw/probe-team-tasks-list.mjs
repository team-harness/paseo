/**
 * Calls `team.tasks.list.request` once and prints the projected ledger.
 *
 * The push probe proves the daemon broadcasts; this proves a client that joins
 * late can ask for the state it missed. It also shows the projection: the
 * server-only fields (`clientMessageId`, `completionEventId`) must not be here.
 *
 *   node probe-team-tasks-list.mjs <teamId> [port]
 */
import { WebSocket } from "ws";

const teamId = process.argv[2];
const port = process.argv[3] ?? "6768";
const ws = new WebSocket(`ws://localhost:${port}/ws`);

const timer = setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 20000);

let asked = false;

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      clientId: "team-tasks-list-probe",
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { teams: true, team_tasks: true },
    }),
  );
});

ws.on("message", (raw) => {
  const outer = JSON.parse(raw.toString());
  const msg = outer.type === "session" ? outer.message : outer;

  if (!asked && msg.type === "status") {
    asked = true;
    ws.send(
      JSON.stringify({
        type: "session",
        message: { type: "team.tasks.list.request", requestId: "list-1", teamId },
      }),
    );
    return;
  }

  if (msg.type === "team.tasks.list.response") {
    const tasks = msg.payload.tasks;
    console.log(
      JSON.stringify(
        {
          error: msg.payload.error,
          teamId: tasks?.teamId,
          revision: tasks?.revision,
          // Prompts are long and already in the ledger; what matters here is the
          // shape and the state each task settled into.
          tasks: tasks?.tasks.map((task) => ({
            ...task,
            prompt: `${task.prompt.slice(0, 24)}…`,
          })),
          fields: tasks?.tasks[0] ? Object.keys(tasks.tasks[0]).sort() : [],
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
