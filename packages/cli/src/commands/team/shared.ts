import { randomUUID } from "node:crypto";
import type { CreateTeamMemberSpec } from "@getpaseo/client";
import { TEAM_ERROR_CODES } from "@getpaseo/protocol/team/rpc-schemas";
import type { CommandError, CommandOptions } from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";

export interface TeamCommandOptions extends CommandOptions {
  host?: string;
}

export async function connectTeamClient(host?: string) {
  const daemonHost = getDaemonHost({ host });
  try {
    return { client: await connectToDaemon({ host }), daemonHost };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${daemonHost}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    };
    throw error;
  }
}

/**
 * Turns a `role=provider` pair into a member spec.
 *
 * Both halves are required, and the provider keeps whatever the user typed —
 * `codex/gpt-5.4` is a provider-and-model string the daemon splits, not two
 * fields the CLI should guess at.
 */
export function parseMemberSpec(input: string): CreateTeamMemberSpec {
  const separator = input.indexOf("=");
  const role = separator === -1 ? "" : input.slice(0, separator).trim();
  const provider = separator === -1 ? "" : input.slice(separator + 1).trim();
  if (!role || !provider) {
    const error: CommandError = {
      code: "INVALID_MEMBER",
      message: `Invalid member "${input}"`,
      details: "Use role=provider, for example --member server=codex or --lead lead=claude.",
    };
    throw error;
  }
  return { role, provider };
}

/**
 * A key for one create attempt.
 *
 * Reused only while the outcome is unknown, which for a CLI invocation is never
 * — one command is one attempt. A retry the user types is a new decision and
 * gets a new key, or the daemon would keep handing back the team that failed.
 */
export function newIdempotencyKey(): string {
  return `cli-${randomUUID()}`;
}

export function toTeamCommandError(code: string, action: string, err: unknown): CommandError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return err as CommandError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code, message: `Failed to ${action}: ${message}` };
}

/** Turns the daemon's refusal into a command error, keeping its machine-readable code. */
export function toTeamResponseError(
  action: string,
  payload: { error: string | null; errorCode?: string | null },
): CommandError {
  const message = payload.error ?? `Failed to ${action}`;
  if (payload.errorCode === TEAM_ERROR_CODES.idempotencyConflict) {
    return {
      code: "TEAM_IDEMPOTENCY_CONFLICT",
      message,
      details: "That key was already used for a different request. Run the command again.",
    };
  }
  return { code: payload.errorCode ?? "TEAM_REQUEST_FAILED", message };
}
