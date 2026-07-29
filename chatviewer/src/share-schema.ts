import { z } from "zod";

const TimestampSchema = z.string().datetime();
const EntryBaseSchema = z.object({
  id: z.string().min(1),
  createdAt: TimestampSchema,
});

const ChatHistoryEntrySchema = z.discriminatedUnion("kind", [
  EntryBaseSchema.extend({
    kind: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    markdown: z.string(),
  }).strict(),
  EntryBaseSchema.extend({
    kind: z.literal("tool"),
    name: z.string().min(1),
    status: z.enum(["running", "completed", "failed", "canceled"]),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
  }).strict(),
  EntryBaseSchema.extend({
    kind: z.literal("thought"),
    text: z.string(),
    status: z.enum(["loading", "ready"]),
  }).strict(),
  EntryBaseSchema.extend({
    kind: z.literal("todo"),
    items: z.array(
      z
        .object({
          text: z.string(),
          completed: z.boolean(),
        })
        .strict(),
    ),
  }).strict(),
  EntryBaseSchema.extend({
    kind: z.literal("activity"),
    message: z.string(),
    level: z.enum(["system", "info", "success", "error"]),
  }).strict(),
  EntryBaseSchema.extend({
    kind: z.literal("compaction"),
    status: z.enum(["loading", "completed"]),
    trigger: z.enum(["auto", "manual"]).optional(),
    preTokens: z.number().int().nonnegative().optional(),
  }).strict(),
]);

export const ChatHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: TimestampSchema,
    conversation: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1),
        provider: z.string().optional(),
        model: z.string().optional(),
      })
      .strict(),
    entries: z.array(ChatHistoryEntrySchema),
  })
  .strict();

export type ChatHistory = z.infer<typeof ChatHistorySchema>;

export const CHAT_SHARE_MAX_BYTES = 5 * 1024 * 1024;

export function isShareId(value: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}
