---
doc_type: issue-fix
issue: 2026-07-15-codex-status-cost-undercount
status: confirmed
path: standard
fix_date: 2026-07-15
related:
  - codex-status-cost-undercount-analysis.md
tags:
  - status-summary
  - codex
  - usage-ledger
---

# Codex Status Cost Undercount 修复记录

## 1. 根因摘要

`packages/server/src/server/agent/providers/codex-app-server-agent.ts` 原先把 Codex app-server 的 request-scoped `tokenUsage.last` 直接映射成 `usage_updated`，但 usage ledger 要求同一 Paseo turn 内收到单调累计快照。第二次及后续模型调用因此只记录相邻 `last` 的正差；任一字段下降时整条事件会被 ledger 判为 stale。

另一个持久化边界问题是 foreground turn id 使用进程内 `codex-turn-N`。adapter 或 daemon 重建后 ordinal 从 0 重用，新 turn 会撞上旧 agent 已持久化的同名 ledger basis。

## 2. 实际采用方案

采用已批准的方案 A：

1. 解析 app-server `thread/tokenUsage/updated` 的 `total`、`last` 与原生 `turnId`。
2. 在 Codex session 内保留上一份 thread 累计 Token，并以 `total` 差值计算本次新增量。
3. 首次观察、resume 或 native total 回退时仅用 `last` 作为安全基线，避免把整个 thread 历史重复计入。
4. 将新增量累加到当前 Paseo foreground turn，向 ledger 发送单调累计 usage；重复 total 只重复同一快照，不增加 contribution。
5. turn 开始/结束清空 per-turn usage 与 `latestUsage`；thread 开始清空 thread total baseline；只要通知携带原生 `turnId`，就必须严格匹配当前 native turn，包含 foreground turn 已激活但 native `turn/started` 尚未到达的窗口。
6. foreground turn id 改为 `codex-turn-${randomUUID()}`，并通过可注入 UUID 让单元测试保持确定性。
7. 保持 usage ledger schema、AgentManager bridge、Status summary RPC 与 app 多 Host 聚合不变。

既有错误 ledger 不自动回填，也没有重启 6767 daemon 或修改生产数据。

## 3. 改动文件清单

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
  - 新增 Codex token usage 解析、thread total delta 与 per-turn accumulator。
  - 保留原生 notification `turnId`，拒绝污染当前 turn 的迟到 usage。
  - 修正 turn/thread usage 状态复位。
  - 使用 UUID 生成跨 session/daemon 唯一的 foreground turn id。
- `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`
  - 覆盖同一 turn 多次模型调用、last 下降、重复 total、跨 turn 复位、resume 首次基线、native total 回退、迟到通知和 turn id 唯一性。
- `docs/data-model.md`
  - 明确 provider adapter 必须在进入 ledger 前提供单调 turn-scoped usage，并记录 Codex `total`/`last` 的归一化约束。
- `.codestable/issues/2026-07-15-codex-status-cost-undercount/`
  - 保存 confirmed report、analysis、approval history 与本 fix-note。

未修改、回退或纳入本 issue 的用户已有文件：

- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/agent/providers/claude/agent.test.ts`
- `.codegraph/`

## 4. 验证结果

| 验证项                                 | 结果                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 多调用回归先 RED                       | 通过：旧实现第二次只发 `60/30/15`，期望累计为 `160/70/25`                                      |
| turn-start 窗口回归先 RED              | 通过：旧 guard 先误发 `20/8/2`，再把新 turn 的 `40/15/5` 压成 `20/7/3`；严格匹配后目标用例通过 |
| Codex usage/turn-id 目标回归           | 通过：6 tests passed                                                                           |
| Codex usage/turn-id 最终聚焦回归       | 通过：10 tests passed / 92 skipped                                                             |
| Codex provider 完整测试                | 实现后一次 `102/102` 通过；本轮再次命中既有 resume 测试固定 `500ms` race，失败用例单独运行通过 |
| Usage ledger 单元测试                  | 通过：10 tests passed                                                                          |
| AgentManager usage bridge              | 通过：3 tests passed                                                                           |
| 多 Host Status summary view model      | 通过：6 tests passed                                                                           |
| `npm run typecheck`                    | 通过：全部 workspace                                                                           |
| `npm run lint`                         | 通过：0 warnings / 0 errors                                                                    |
| targeted `npm run format:files -- ...` | 通过：本次代码、测试、docs 与 issue artifacts                                                  |
| `git diff --check`                     | 通过                                                                                           |
| `npm run format:check`                 | 通过：全仓 2914 files                                                                          |
| 独立代码审查                           | 通过：round 2 Claude/Opus 强制只读 reviewer + OCR 双环节均无 blocking/important                |

复现路径验证：真实 transcript 中连续调用的 thread `total` 增量已由目标测试按同一数据关系重放；adapter 的第二次输出现在是当前 turn 累计值，而不是第二次 `last`。Ledger 已有的递增快照测试证明该输出只产生正确正向 contribution，现有多 Host 测试证明两个 ready summary 仍正确求和。

没有为了验证而重启或替换主 Paseo daemon，因此生产 Status bar 不会在当前运行中的 `0.1.107` daemon 上热切换到工作区代码。

Round 1 主审额外发现：新 Paseo foreground turn 已建立、但 native `turn/started` 尚未到达时，旧 turn usage 会绕过原 guard。新增 RED 用例后把 guard 收紧为携带 native turnId 时必须严格匹配当前 native turn。该生产时序变化按 CodeStable 规则执行了 round 2 双环节完整复审，而非复用首次 reviewer；最终 verdict 为 passed。

## 5. 遗留事项

1. 修复前已经少记的 today/lifetime ledger 不自动恢复；stale 明细未持久化，自动回填可能重复计入非 Paseo 或已有正确记录。
2. Codex 内建 child thread usage 当前不归入 root agent ledger；费用归属需要另行定义，不在本次 root-thread 修复中猜测。
3. `resumeSession does not replace...` 测试含固定 `500ms` 子进程启动 race，完整文件运行时偶发超时且单测稳定通过；未在本 issue 中通过调大 timeout 混入无关修复。
4. 独立 review 已通过，Owner 已批准 `ConfirmFixCompletion` 并授权更新 `changes-by-me.md` 后执行 scoped commit/push。

> 顺手发现：Codex provider subagent 的 token notification 当前在 child-thread routing 中被忽略。它不是本次已映射 root-thread 少记的必要修复，可后续单独确认计费归属并开 issue。
