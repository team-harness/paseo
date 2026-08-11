/**
 * Listens for `team.tasks.update` on a daemon socket and writes every push it
 * receives, stamped, as JSONL.
 *
 * The capability in `hello` is what makes the daemon send these at all — the
 * push is gated per socket on `team_tasks`, so a client that omits it stays on
 * the old wire and sees nothing. Run it before creating the team so the first
 * queued task is captured.
 *
 *   node probe-team-tasks.mjs <out.jsonl> [port]
 */
import { appendFileSync } from "node:fs";
import { WebSocket } from "ws";

const out = process.argv[2] ?? "team-tasks-push.jsonl";
const port = process.argv[3] ?? "6768";
const ws = new WebSocket(`ws://localhost:${port}/ws`);

function record(event, payload) {
  appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), event, payload })}\n`);
}

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      clientId: "team-tasks-probe",
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { teams: true, team_tasks: true },
    }),
  );
  record("open", { port });
});

ws.on("message", (raw) => {
  const outer = JSON.parse(raw.toString());
  const msg = outer.type === "session" ? outer.message : outer;

  // Server info arrives inside a `status` message, not as a type of its own.
  if (msg.type === "status" && msg.payload?.status === "server_info") {
    record("server_info", {
      version: msg.payload.version,
      teams: msg.payload.features?.teams ?? null,
      teamTasks: msg.payload.features?.teamTasks ?? null,
    });
    return;
  }
  if (msg.type === "team.tasks.update") {
    record("team.tasks.update", msg.payload);
    return;
  }
  if (msg.type === "team.update") {
    record("team.update", { teamId: msg.payload?.team?.teamId, state: msg.payload?.team?.state });
  }
});

ws.on("error", (error) => {
  record("error", { message: error.message });
});

ws.on("close", (code) => {
  record("close", { code });
  process.exit(0);
});
