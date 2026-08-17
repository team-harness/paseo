# Agent Teams — 真实 provider 冒烟

`packages/server/src/server/team/team-e2e.e2e.test.ts` 的 16 个场景全部跑在 fake provider 上，其中一条注释写明了它的边界：

> The fake providers cannot reach MCP, so this stands in for the lead typing

也就是说 `assign_task`、`chat_post` 这些 MCP 工具从没被真正的 agent 调用过；测试用直接写 ledger 的方式替代了"lead 自己决定派活"。本次冒烟就是补这一段：让真的 Claude / Codex 进程跑完 create → dispatch → settle → report → permission → post → archive。

链路全部走通，同时暴露两个**只有真实 provider 才会触发**的缺陷。

## 环境

| 项     | 值                                                                             |
| ------ | ------------------------------------------------------------------------------ |
| daemon | 6768（隔离实例，`PASEO_HOME=<worktree>/.dev/paseo-home`），版本 `0.3.0-beta.2` |
| 沙箱   | `/tmp/paseo-team-smoke2`（git repo，含 `README.md` + `math.js`）               |
| team   | `73538ca9-752d-467d-820c-0e3ca2d20af1` "Smoke Squad 2"                         |
| room   | `0b8b35df-59de-4004-9135-26736e5ed2d4`                                         |
| lead   | `6506f3cd` — claude                                                            |
| docs   | `3ac70643-d70e-4193-be48-8411d353a4bf` — claude                                |
| code   | `cbaf2a72-e804-4720-a5cf-90bc123edd33` — codex                                 |

刻意混用两个 provider，好让 `acceptedTurnId` 的格式差异成为"turn 真的被 provider 接受了"的旁证。

时间戳：ledger / team 记录是 UTC，`daemon.log` 是本地时间（UTC+8）。同一事件相差 8 小时是正常的。

## 逐环节证据

| 环节              | 证据                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create            | `raw/team-record.json` — 3 名成员，roster 与 room 就位                                                                                                                  |
| assign            | lead **自主**调用了两次 `assign_task`，不是人代写的；ledger 落盘两条                                                                                                    |
| dispatch → settle | `61d3c76b` 00:28:21.782 → 00:28:40.622 `completed`；`1d6df329` 00:28:48.642 → 00:28:58.452 `completed`                                                                  |
| report            | `raw/team-room.json` — 4 条消息，含两名成员的回报和 lead 的汇总                                                                                                         |
| 真实改动          | `raw/sandbox-round2.diff` — README 的 Inventory 行、`math.js` 的 `multiply`                                                                                             |
| permission        | `Edit` 请求 → allow → `{"behavior":"allow"}` → README 落盘；随后 `mcp__paseo__chat_post` 同样被 gate → allow → 放行                                                     |
| post              | 人类 `chat/post`（`author.kind: "human"`）用全 id mention 唤醒 docs，9 秒后有回应                                                                                       |
| archive           | team `active` → `archived` @00:42:51.894；3 名成员 `state: archived`；3 条 agent 记录都带 `archivedAt`（lead 50.802 → docs 51.306 → code 51.631）、`lastStatus: closed` |

`acceptedTurnId` 的两种形态是 dispatch 真实性的硬证据：

```
"acceptedTurnId": "foreground-turn-2"                                  ← claude
"acceptedTurnId": "codex-turn-39fb5063-6379-4ebe-ab8a-0823bb82df75"    ← codex
```

DEC-3 ledger 最终收敛干净：

```json
"pendingCompletions": [],
"inFlightDelivery": null
```

`mcp__paseo__chat_post` 触发权限请求这件事，顺带独立确认了 MCP 注入是活的、工具确实以 `mcp__paseo__*` 暴露。

## 缺陷 1：`chat_wait` 把 `assign_task` 的派发锁死

**成因是三处代码各自都对、合起来成环。**

`team-prompts.ts:54` 给每个成员的最后一句话是：

```
Wait for an assignment before starting on the task.
```

成员手里唯一能"等"的工具是 `chat_wait`，它在 agent 的 turn 内部阻塞，上限 5 分钟（`team-tools.ts:16`：`MAX_CHAT_WAIT_MS = 5 * 60 * 1000`）。阻塞期间 agent 的 lifecycle 是 `running`。

而 `agent-wakeability.ts:8`：

```ts
const WAKEABLE_LIVE_LIFECYCLES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);
```

`running` 不在其中，`isAgentWakeable` 返回 false，DEC-3 的派发泵**正确地**拒绝派发——它的职责就是不打断正在跑的 turn。

但 `assign_task` 的投递通道恰恰是"唤醒"。于是：**等待任务这个动作本身，阻止了任务到达。**

本次跑通纯属侥幸——lead 碰巧往 room 里发了消息，把成员从 `chat_wait` 里弹了出来。时间线：

```
00:28:15.309  lead 发帖
00:28:21.782  第一条 dispatch          ← 6.5 秒后
```

而任务本身 00:25:50.970 就入 ledger 了，空等了 2 分 31 秒。

`team-prompts.ts:35` 给 lead 的原话只有 "Assign work with the assign_task tool"，**没有任何一句要求 lead 发帖**。一个只派活、不说话的 lead，会让每个成员卡满 5 分钟超时。

fake provider 不会自发调 `chat_wait`，所以现有 16 个场景一个都碰不到。`docs/` 和 `.codestable/` 里也没有任何相关记载。

## 缺陷 2：用角色名 mention 永远解析不到

同一个 agent、同一段请求正文，只改 mention 写法的 A/B：

| 写法                 | `mentionAgentIds` | 结果                                   |
| -------------------- | ----------------- | -------------------------------------- |
| `@docs (3ac70643-…)` | `["docs"]`        | **不唤醒**，12 秒后仍 idle             |
| `@3ac70643-…`        | `["3ac70643-…"]`  | **9 秒唤醒**，改了 README，room 里回话 |

`chat-service.ts:58`：

```ts
const CHAT_MENTION_PATTERN = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
```

只取 `@` 后紧跟的那个 token 当 agentId 用，对 team 的 role→id 映射一无所知——尽管 roster 就是权威的映射表。括号里那个合法 id 因为没有 `@`，永远不会被匹配。

坑在于第一种写法**信息是完整的**（角色名 + 括号里的合法 id），人看着毫无问题。而 lead 会自然写成这样，因为 `team-prompts.ts:31` 就是这么把队伍交给它的：

```ts
`Your team: ${others.map((member) => `${member.role} (${member.agentId})`).join(", ")}.`;
```

失败是静默的。发送方什么都收不到，只有 daemon 日志里一行 WARN（`raw/mention-resolve-failures.log`）：

```
[08:28:15.311] WARN: Failed to resolve chat mention target {"mentionedAgentId":"docs","room":"0b8b35df-…"}
[08:28:37.315] WARN: Failed to resolve chat mention target {"mentionedAgentId":"lead","room":"0b8b35df-…"}
[08:29:00.291] WARN: Failed to resolve chat mention target {"mentionedAgentId":"code","room":"0b8b35df-…"}
```

`lead` / `docs` / `code` 三个角色名全中。

同一份日志里还有 `human-smoke-probe`、`perm-probe`——那是 agent 想回复人类发的消息时 @ 了发送者的 clientId。人类不是 agent，这个 mention 同样无处可落。属于同一处解析逻辑的另一面。

## 存档清单

`raw/` 下都是原件，没有摘编：

| 文件                           | 来历                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox-ledger.json`            | `.dev/paseo-home/teams/inbox/73538ca9-….inbox.json`                                                                                                      |
| `team-room.json`               | `.dev/paseo-home/chat/rooms/0b8b35df-….json`                                                                                                             |
| `team-record.json`             | `.dev/paseo-home/teams/73538ca9-….json`                                                                                                                  |
| `mention-resolve-failures.log` | `daemon.log` 里全部 `Failed to resolve chat mention target`（已去 ANSI 色码）                                                                            |
| `sandbox-round2.diff`          | 本次冒烟沙箱的 `git diff`                                                                                                                                |
| `sandbox-round1.diff`          | 前一轮沙箱（`/tmp/paseo-team-smoke`）的 `git diff`，只作环境记录——缺陷证据都出自第二轮                                                                   |
| `probe-chat-post.mjs`          | 复现缺陷 2 的探针。改第 35 行的 `body` 即可做 A/B；注意 `chat/post` 必须裹在 `{type:"session", message:{…}}` 信封里，直接发顶层类型会被 inbound 校验拒掉 |

## 已清理

6768 隔离 daemon 已停（`daemon stop` 确认 HOME 是 worktree 内的 `.dev/paseo-home`，主 daemon 6767 未受影响）；9 个 smoke agent 全部 archived；`/tmp/paseo-team-smoke`、`/tmp/paseo-team-smoke2` 已删；仓库根的临时探针脚本已删。

## 未覆盖

`docs/qa.md` 的平台矩阵这次一格没跑——本次全部是 daemon 侧、走 WebSocket 和 CLI，没有碰 iOS / Android / Web / Desktop 任何 UI。团队相关的界面证据在隔壁 `.codestable/audits/agent-teams-qa/`。
