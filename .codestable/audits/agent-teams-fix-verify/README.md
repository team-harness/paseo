# Agent Teams — 两个缺陷的修复复验

`.codestable/audits/agent-teams-real-provider-smoke/` 那轮冒烟暴露了两个只有真实 provider 才会触发的缺陷：成员"等任务"这个动作本身把派发挡住了（缺陷 1），角色名 mention 永远解析不到（缺陷 2）。这一轮是修完之后照同样的做法再跑一遍，外加验证新增的任务协议真的到达客户端。

三条都过。

## 环境

| 项     | 值                                                                        |
| ------ | ------------------------------------------------------------------------- |
| daemon | 6768（隔离实例，`PASEO_HOME=<worktree>/.dev/paseo-home`），`0.3.0-beta.2` |
| 沙箱   | `/tmp/paseo-team-verify`（git repo，`README.md` + `math.js`）             |
| team   | `f501e3d1-d455-409b-8ac7-1445c06f2356` "Verify Squad"                     |
| room   | `27fa823a-6701-47b9-b738-91a17f86247b`                                    |
| lead   | `5fc1734b` — claude                                                       |
| docs   | `d1069716` — claude                                                       |
| code   | `e734a751` — claude                                                       |

上一轮混用 claude + codex 是为了让 `acceptedTurnId` 的格式差异当旁证；那件事已经证过，这轮不重复，三个都用 claude 好让时间线可比。

时间戳统一用 UTC（ledger、room、push 记录都是 UTC；`daemon.log` 是本地 UTC+8）。

## A — 任务不再等 lead 发帖

派发是靠唤醒投递的，而唤醒只发生在 turn 之间（DEC-3 / DEC-10）。上一轮成员照提示词调了 `chat_wait` 干等，整个 turn 阻塞在里面，于是任务入 ledger 后**空等 2 分 30.8 秒**，直到 lead 碰巧发了一帖把成员弹出来才派下去。

修法两层：提示词不再让成员等（`team-prompts.ts`），`chat_wait` 在 inbox 有 queued 任务时立刻返回（`team-tools.ts`）。

这一轮的时间线（UTC，取自 `raw/inbox-ledger.json` 与 `raw/team-room.json`）：

```
02:46:50.276  docs 任务入 ledger
02:46:54.492  code 任务入 ledger
02:46:54.496  code 任务 dispatched        ← 4 毫秒
02:46:57.482  lead 首次发帖               ← 派发比它早 3 秒
02:47:08.800  docs 任务 dispatched        ← 18.5 秒
```

**关键对照在第三、四行**：code 的任务在 lead 开口之前就派下去了。上一轮这是不可能的——派发的唯一解锁方式就是 lead 发帖。

docs 那 18.5 秒不是回退：它当时正在跑自己的开场 turn，`isAgentWakeable` 拒绝打断，这正是 DEC-10 要的行为。派发泵在它 turn 结束后立刻投递。

`chat_wait` 的提前返回这一轮**没有被触发**，因为提示词修好之后成员根本不再调它。那条路径由 `team-tools.test.ts` 的单测覆盖（成员卡在 `chat_wait`，lead `assign_task` 后立即返回）。真实链路里没触发是预期结果，不是漏测。

## B — 角色名 mention 能唤醒了

上一轮的 A/B：`@docs (3ac70643-…)` 不唤醒，`@3ac70643-…` 9 秒唤醒。这轮两个方向都验了。

**lead 自发的角色名 mention。** `raw/team-room.json` 第一条：

```
02:46:57.482  lead   mentionAgentIds: ["code", "docs"]
02:47:01.578  docs   回帖："@lead docs 任务完成…"
```

lead 写的就是 `@docs` / `@code`（`team-prompts.ts` 现在也是这么教它的），docs 4 秒后就回话了。

**人类发的角色名 mention**，用 `raw/probe-role-mention.mjs` 做成孤例：

```
02:49:26.883  human  "@docs please append a line 'Verified by role mention.' …"
              → mentionAgentIds: ["docs"]
02:50:24.649  docs   回帖，README.md 末尾多了 "Verified by role mention."
```

`mentionAgentIds` 存的仍是原始 token `"docs"`——这是有意的，UI 高亮要的就是人真的打出来的字。解析发生在 fanout 层（`chat/room-mention-roster.ts`），按 room 所属 team 的 roster 把 role 换成 agentId。

**daemon.log 里本轮 0 条 `Failed to resolve chat mention target`**（全库 8 条全部来自上一轮，最后一条时间戳 `08:41:51.177`，room 是上一轮的 `0b8b35df`）。

顺带验到降级那一半：docs 回复人类时 @ 的是 clientId（`@role-mention-probe`），既没唤醒任何 agent，也没再打 WARN——识别成"人类，无需唤醒"了。

## C — `team.tasks.*` 真的到达客户端

`raw/probe-team-tasks.mjs` 在建 team 之前就挂上了 socket，hello 里带 `team_tasks` 能力。

**门控**（`raw/team-tasks-push.jsonl` 第二行）：

```json
{
  "event": "server_info",
  "payload": { "version": "0.3.0-beta.2", "teams": true, "teamTasks": true }
}
```

**推送**，8 条，`revision` 严格单调，state 转移全覆盖：

```
02:46:50.277  rev 1  d98cd691:queued
02:46:54.494  rev 2  d98cd691:queued      e52b3b02:queued
02:46:54.498  rev 3  d98cd691:queued      e52b3b02:dispatched
02:47:08.801  rev 4  d98cd691:dispatched  e52b3b02:dispatched
02:47:32.192  rev 5  d98cd691:settled     e52b3b02:dispatched
02:47:33.585  rev 6  d98cd691:settled     e52b3b02:settled
02:47:36.451  rev 7  （state 不变，ledger 收尾）
02:47:36.452  rev 8  （同上）
```

后两条 state 没变，是 `pendingCompletions` / `inFlightDelivery` 清空引起的写盘。客户端按 `revision` 排序丢弃旧值，多推一条不会造成回退。

**`team.tasks.list`**（`raw/team-tasks-list.json`）：晚到的客户端能补上错过的状态，`revision` 8 与 ledger 一致。返回的字段正好九个：

```
acceptedTurnId assigneeAgentId createdAt dispatchedAt outcome prompt settledAt state taskId
```

`clientMessageId` 和 `completionEventId` **不在里面**——`toTeamTask` 的显式投影挡住了 server 内部字段，这是这条协议最容易漏的地方。

## 真实改动

`raw/sandbox.diff`：

```diff
+## Inventory
+
+- `README.md` — this file: project overview and file inventory.
+- `math.js` — arithmetic helpers.
+
+Verified by role mention.
```

```diff
+export function subtract(a, b) {
+  return a - b;
+}
```

两条任务都 `settled` / `completed`，ledger 收敛干净：`pendingCompletions: []`、`inFlightDelivery: null`。

## 存档清单

`raw/` 下都是原件：

| 文件                        | 来历                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `team-tasks-push.jsonl`     | `probe-team-tasks.mjs` 收到的全部 push，逐条带本地收到时间                             |
| `team-tasks-list.json`      | 一次 `team.tasks.list.request` 的应答，prompt 截断到 24 字                             |
| `inbox-ledger.json`         | `.dev/paseo-home/teams/inbox/f501e3d1-….inbox.json`                                    |
| `team-room.json`            | `.dev/paseo-home/chat/rooms/27fa823a-….json`                                           |
| `team-record.json`          | `.dev/paseo-home/teams/f501e3d1-….json`                                                |
| `sandbox.diff`              | 沙箱的 `git diff`                                                                      |
| `probe-team-tasks.mjs`      | push 探针。**hello 里的 `team_tasks` 是必须的**，缺了就按老客户端待遇，一条收不到      |
| `probe-team-tasks-list.mjs` | list 探针，顺带打印字段名用来核投影                                                    |
| `probe-role-mention.mjs`    | 角色名 mention 的孤例探针。`chat/post` 必须裹在 `{type:"session", message:{…}}` 信封里 |

## 未覆盖

`docs/qa.md` 的平台矩阵这轮一格没跑——全部是 daemon 侧，走 WebSocket 和 CLI。团队界面的证据在隔壁 `.codestable/audits/agent-teams-qa/`。
