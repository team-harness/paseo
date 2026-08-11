# Agent Teams v2 · V2-ITEM-5 verification

Date: 2026-08-08
Worktree: `/Users/wyattfang/.paseo/worktrees/3rvhzvvc/agent-teams`
Base: `5d34f4f6c feat(teams): add Mission lifecycle capsule`

## Targeted tests

```text
npx vitest run \
  packages/server/src/server/chat/chat-service.test.ts \
  packages/server/src/server/team/adapters/paseo/team-participant-adapter.test.ts \
  packages/server/src/server/team/adapters/paseo/team-room-adapter.test.ts \
  packages/server/src/server/team/adapters/paseo/team-runtime-install.test.ts \
  packages/server/src/server/team/adapters/paseo/team-member-history-adapter.test.ts \
  packages/server/src/server/team/adapters/paseo/team-recipient-attention-adapter.test.ts \
  packages/server/src/server/team/adapters/paseo/team-tool-registrar.test.ts \
  packages/server/src/server/team/application/team-collaboration-service.test.ts \
  packages/server/src/server/team/application/team-mission-service.test.ts \
  packages/server/src/server/team/persistence/mission-store.test.ts \
  packages/server/src/server/team/persistence/reconciliation.test.ts \
  packages/server/src/server/team/team-runtime.test.ts \
  packages/server/src/server/team/team-runtime.boundary.test.ts --bail=1

Test Files  13 passed (13)
Tests       161 passed (161)
Duration    1.63s
```

After extracting matcher orchestration into pure functions:

```text
npx vitest run packages/server/src/server/team/application/team-collaboration-service.test.ts --bail=1

Test Files  1 passed (1)
Tests       27 passed (27)
```

After the second change review fixes:

```text
7 exact test files, run independently with --bail=1

packages/server/src/server/chat/chat-service.test.ts                                      42 passed
packages/server/src/server/team/adapters/paseo/team-accepted-turn-facts-adapter.test.ts   1 passed
packages/server/src/server/team/adapters/paseo/team-runtime-install.test.ts                3 passed
packages/server/src/server/team/application/team-collaboration-service.test.ts            32 passed
packages/server/src/server/team/application/team-mission-service.test.ts                   33 passed
packages/server/src/server/team/persistence/mission-store.test.ts                          15 passed
packages/server/src/server/team/persistence/reconciliation.test.ts                         17 passed

Test Files  7 passed (7)
Tests       143 passed (143)
```

After the third change review fixes:

```text
9 exact test files, run independently with --bail=1

packages/server/src/server/chat/chat-service.test.ts                                      42 passed
packages/server/src/server/team/adapters/paseo/team-accepted-turn-facts-adapter.test.ts   2 passed
packages/server/src/server/team/adapters/paseo/team-runtime-install.test.ts                3 passed
packages/server/src/server/team/adapters/paseo/team-tool-registrar.test.ts                 4 passed
packages/server/src/server/team/application/team-collaboration-service.test.ts            33 passed
packages/server/src/server/team/application/team-mission-service.test.ts                   33 passed
packages/server/src/server/team/persistence/mission-store.test.ts                          16 passed
packages/server/src/server/team/persistence/reconciliation.test.ts                         17 passed
packages/server/src/server/team/team-runtime.test.ts + team-runtime.boundary.test.ts       10 passed

Test Files  10 passed (10)
Tests       160 passed (160)
```

After the fourth change review fixes:

```text
7 exact test files, run in three explicit groups with --bail=1

packages/server/src/server/team/application/team-collaboration-service.test.ts            35 passed
packages/server/src/server/team/application/team-mission-service.test.ts                   33 passed
packages/server/src/server/team/adapters/paseo/team-accepted-turn-facts-adapter.test.ts    5 passed
packages/server/src/server/team/adapters/paseo/team-runtime-install.test.ts                 3 passed
packages/server/src/server/team/domain/mission-validation.test.ts                          61 passed
packages/server/src/server/team/persistence/mission-store.test.ts                          16 passed
packages/server/src/server/team/persistence/reconciliation.test.ts                         17 passed

Test Files  7 passed (7)
Tests       170 passed (170)
```

## Static gates

```text
npm run typecheck
exit 0; all workspaces passed

npm run lint
Found 0 warnings and 0 errors.

npm run format:files -- <23 changed source/test files>
Finished successfully.

npm run format:check
All matched files use the correct format.

git diff --check
exit 0
```

## Red-green evidence

- Minimal Lead wake prompt: failed with zero matching timeline messages, then passed 4/4 after deterministic clientMessageId dispatch and replay detection.
- Terminal tool rejection: initially returned `not_mission_participant`; passed after terminal state became the first authorization fence.
- Chat replay after mention eligibility changes: initially failed with `chat_mention_fanout_limit_exceeded`; passed after same-id replay moved before validation.
- Team message mention delivery: initially produced one immediate generic fanout; passed after Team room writes disabled generic fanout and left wake delivery to the durable outbox.
- Lead startup tools: bootstrap order, runtime `starting` gate, and pending Team active-link checks each failed independently; all pass after catalog installation precedes reconciliation and the exact persisted start intent authorizes its Lead.
- Persistence fixture upgrade: new required cursor/outbox fields initially failed parse; passed 32/32 after first-public storage fixtures and room-before-attention recovery actions were aligned.
- Recipient attention: the first review found that directed messages stayed pending forever. A real attention adapter, turn-settle eligibility listener, bounded retry, binding successor, durable attention escalation, and terminal/member-left cancellation now close every outbox branch.
- Replan convergence: blocked and needs-report Assignments originally had no replacement path. Replan now atomically creates replacement identities, supersedes old contracts, hands off report holds, and validates reusable historical accepted-turn facts.
- Caller-owned chat id recovery: a failed room write left the message in memory, so the same-id retry returned success without retrying persistence. Replay now drains the room write queue before returning; a restarted `FileBackedChatService` proves exactly one durable message.
- Message lifecycle race: `team_message` and Team lifecycle mutation now share a per-Team operation coordinator. The aggregate write revalidates exact sender and recipient binding epochs in the same Mission revision CAS; the cancellation race test proves the room post settles before terminal cancellation.
- Final verifier ranking: independent candidates are reranked through the normal skill, Level, continuity, and load matcher. The persisted full-roster explanation records why the highest-ranked independent verifier differs from the unconstrained recommendation.
- Recipient convergence: an unavailable participant now raises durable `participant_unavailable` attention; notified delivery retries have a persisted one-minute backoff; `restore_notification` atomically resolves notification attention and rearms the exact delivery.
- Report-hold handoff: replan captures each replaced Assignment's path/fingerprint delta before releasing its scope and persists a structured source-to-replacement handoff in the same aggregate CAS.
- Accepted-turn facts: the AgentStorage adapter routes Team turns by the persisted Mission label, so non-Team turns perform zero Mission I/O and Team turns read one Mission rather than every historical file. A per-Mission ordered retry queue retains listener/storage failures, continues healthy Missions, and startup reconciliation backfills crash-window facts before capped provider history can evict them.
- Ordinary mention recovery: a failed room write rolls the message and room timestamp out of memory before returning. A later unrelated write and daemon restart cannot accidentally persist the failed mention; retry then stores and fans it out exactly once.
- Background lifecycle race: crash-replay room posts and eligibility-triggered attention attempts now enter the shared per-Team operation coordinator before their per-Mission message mutex. Gated tests prove Mission cancellation waits for both background side effects.
- Participant recovery: `participant_unavailable` is a replan-compatible attention kind. The Lead's atomic plan CAS resolves it with durable audit evidence and can replace affected work instead of being forced to cancel the Mission.
- Delta handoff visibility: replacement Assignments carry `mission-handoff:<sourceAssignmentId>` in `inputRefs`, and `mission_status` returns the authoritative source/replacement/path-fingerprint handoff ledger to the assigned Member.
- Concurrent notification recovery: two independent runtime instances resolving the same `restore_notification` converge on one aggregate write; the revision loser returns the persisted idempotent result instead of exposing a conflict.
- Attention generations: replan resolves and cancels the exact unavailable-participant delivery. `restore_notification` cancels its old delivery and creates a deterministic `:recovery` successor, so repeated failure produces a new resolvable Attention id; the domain rejects duplicate durable Attention identities.

## Scope note

Agent Teams has not shipped. This implementation contains one v2 Team/Mission format and no migration, legacy adapter, old Team RPC/tool fallback, dual write, downgrade path, or legacy UI branch.

## Final change review

Round 5 reused the same reviewer and froze the staged target at HEAD `5d34f4f6c`, SHA-256 `e83193cd397c734bdc8fc28dbaee0fb1da0c88f40d8c219586daa77e0266b270`, 7546 lines, 35 files, `+6590/-118`. The target was unchanged from the start through the end of review; `dogfood-output/` remained excluded.

Result: **mergeable, 0 blocking / 0 important / 0 minor**.

- Attention recovery now has distinct durable generations: replan cancels the exact unavailable delivery, notification restore cancels the old delivery and creates a deterministic `:recovery` successor, and aggregate validation rejects duplicate Attention identities.
- Accepted terminal facts survive listener/storage failure through ordered retry queues and startup reconciliation. One failing Agent or Mission does not block healthy Missions.
- Terminal events route from the Agent's persisted Mission label to one `missions.get()` call. Non-Team turns perform no Mission I/O and no historical Mission scan.
- Low-frequency driving of pending notification successors belongs to V2-ITEM-6. V2-ITEM-5 provides the durable state and idempotent replay entry point.
