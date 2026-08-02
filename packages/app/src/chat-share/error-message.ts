import { toErrorMessage } from "@/utils/error-messages";
import { ChatShareTooLargeError } from "./upload";

export interface ChatShareErrorCopy {
  failed: string;
  recoveryHint: string;
  tooLarge: string;
}

export function formatChatShareErrorMessage(error: unknown, copy: ChatShareErrorCopy): string {
  if (error instanceof ChatShareTooLargeError) return copy.tooLarge;
  const reason = error === null || error === undefined ? "" : toErrorMessage(error);
  return `${reason || copy.failed}\n\n${copy.recoveryHint}`;
}
