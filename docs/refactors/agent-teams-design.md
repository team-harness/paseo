# Agent Teams 详细设计（v2.6）

状态：提案。v2 吸收第一轮外部架构评审；v2.1/v2.2/v2.3 吸收 Epic design review 阶段一的三轮 findings；v2.4 吸收复核阶段（阶段二）轮 1 findings（派发契约、招募 role、hydration 竞态、lead hard delete、终态事实形状）。v2.5 吸收轮 2 findings（归档目标集合、三态规则、兜底扫描、招募事务）。v2.6 吸收轮 3 findings：creating 期 deletion guard（§5.6）、活跃 turn 标识收敛契约与 pump 启动屏障（§5.1）、招募意图完整持久化 + lifecycle fence + 新 removalReason（§3.1/§5.4）、pendingRecruitments 移至 StoredTeam 顶层（§3.1）、lifecycle 缺失记录语义改为 TeamService 专用包装层（§5.6）。

核心立场：**Team record 是聚合根与 roster 权威；parent label 只表达委派树；team labels 只是可重建索引；chat room 是审计与共享上下文层；持久化 inbox 是唯一可靠唤醒通道。** daemon 依然不做任务编排（拆解与派发的智能在 lead agent），但生命周期事务、成员账本和唤醒队列必须是持久化、可恢复、幂等的——弱一致机制（labels、内存监听、prompt 中断）不能承担事务和消息队列的职责。

## 1. 目标与非目标

目标：

- 在新建面板一键创建一个协作小组：lead + 若干成员，支持跨 provider 混编。
- 成员协作过程对人可见（chat room 为中心），人可随时插话。
- 聚合视图：成员状态、待处理权限请求集中呈现。
- 生命周期可恢复：daemon 在创建/归档中途崩溃后能对账收敛，不遗留孤儿资源。

非目标（明确不做）：

- 服务端 workflow/DAG 编排引擎。派发、重试、汇总由 lead agent 的模型智能完成。
- 多层 team 嵌套。team 是扁平的一层分组。
- 成员间强一致的任务状态机。room 消息就是协调记录。
- 唤醒与简报投递的"恰好一次"保证（§5.3：端到端语义是 at-least-once，重复在最终确认前无上限）。
- assignment 抢占：派发永不打断 assignee 正在进行的 turn（§5.3）。
- Phase 1 不做 per-member worktree 的合并辅助（先支持共享 workspace）。

## 2. 概念模型

| 术语               | 定义                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Team**           | 一个聚合根：roster + team room + 聚合生命周期状态。归属一个 workspace。                                                                     |
| **Lead**           | team 中承担编排职责的 agent。唯一。`lead` 是保留 role，只能由 daemon 在创建时授予。                                                         |
| **Member**         | roster 中的非 lead agent。有一个 role 字符串（展示 + prompt 注入用）。**成员数上限只计 roster 中 `state: "active"` 的非 lead 条目**（§8）。 |
| **Team room**      | 创建 team 时自动建立的 chat room，带 owner 保护。协调、汇报、人类插话都在这里。                                                             |
| **Roster**         | team record 内持久化的成员账本，含历史成员与 lead。成员关系的唯一事实源。                                                                   |
| **Remove**（退队） | 把成员移出 roster（`leftAt` 落账）并摘 labels。用户术语统一为 "Remove from team"，CLI 同名 `remove`，不再用 `leave`/detach 混称。           |
| **Template**       | 创建表单的预填配方。客户端概念，daemon 只存 `templateId` 供展示。                                                                           |

术语需同步进 `docs/glossary.md`。

## 3. 数据模型

### 3.1 Team record：聚合根 + roster 账本

新增 `packages/protocol/src/team/types.ts`：

```ts
export const TeamMemberEntrySchema = z.object({
  agentId: z.string(),
  role: z.string(), // "lead" 保留给 leadAgentId
  joinedAt: z.string(),
  leftAt: z.string().nullable(), // remove 落账，历史成员保留
  state: z.enum(["active", "removed", "archived"]),
  removalReason: z
    .enum([
      "removed_by_user",
      "hard_deleted",
      "unarchive_evicted",
      "recruitment_failed",
      "recruitment_canceled",
    ])
    .nullable(), // state=removed 时必填语义；恢复 active 时清 null
});

// server-only：创建意图，首个原子写内持久化，创建完成前不可变（§5.2）
export const TeamCreationPlanSchema = z.object({
  task: z.string(),
  room: z.object({ roomId: z.string(), internalName: z.string() }),
  members: z.array(
    z.object({
      agentId: z.string(),
      isLead: z.boolean(),
      role: z.string(),
      title: z.string().nullable(),
      provider: z.string(),
      settings: z.record(z.string(), z.unknown()).nullable(),
      briefing: z.string().nullable(),
    }),
  ),
});

// server-only：招募意图（§5.4），完整到可独立重放
export const RecruitmentIntentSchema = z.object({
  provider: z.string(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  title: z.string().nullable(),
  teamRole: z.string(),
  initialPrompt: z.string(),
  clientMessageId: z.string(), // 确定性：team-{teamId}-recruit-{agentId}
  recruiterAgentId: z.string(),
  workspaceId: z.string(),
  stage: z.enum(["reserved", "created"]), // created = agent 已建、prompt 未确认
  cancelling: z.boolean().optional(), // 已决定撤销、agent 尚未归档
});

// server-only 持久化 record
export const StoredTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  chatRoomId: z.string(),
  leadAgentId: z.string(),
  members: z.array(TeamMemberEntrySchema),
  lifecycle: z.enum(["creating", "active", "archiving", "archived", "failed"]),
  revision: z.number().int(), // 初始 1，每次持久化原子 +1
  idempotencyKey: z.string(), // §5.2
  requestFingerprint: z.string(), // 规范化请求指纹（§5.2），永久保留供同 key 冲突判定
  creationPlan: TeamCreationPlanSchema.nullable(), // creating/failed 期间保留；active 后清 null
  creationStage: z.enum(["allocated", "room_created", "agents_created", "briefed"]).nullable(),
  templateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  failedCleanupAt: z.string().nullable(), // §5.7
  pendingRecruitments: z.record(z.string(), RecruitmentIntentSchema).nullable(), // server-only：agentId → 招募意图（§5.4），不出 wire
});

// wire 快照：显式投影，不复用 StoredTeamSchema。
// server-only 字段（idempotencyKey / requestFingerprint / creationPlan /
// creationStage / failedCleanupAt / pendingRecruitments）永不出 wire。
// TeamMemberEntrySchema 为 stored 与 wire 共用（不含任何 server-only 字段）。
export const TeamSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  chatRoomId: z.string(),
  leadAgentId: z.string(),
  members: z.array(TeamMemberEntrySchema),
  lifecycle: z.enum(["creating", "active", "archiving", "archived", "failed"]),
  revision: z.number().int(),
  templateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
```

v1 的 "成员名单只存 labels" 被否决（评审 B3）：`AgentManager.listAgents()` 只返回内存实例（`agent-manager.ts:847`），daemon 重启后 agent 按需加载，label 扫描会漏成员；archive/remove/unarchive 的成员状态也无法用"label 在不在"表达。roster 进 record，labels 降级为索引。

**Lifecycle 状态机（评审 M4）**：team 的 archive 状态以 `lifecycle` 字段为唯一事实源。lead 被 archive 是**触发信号**，不是事实源。`creating`、`archiving`、`failed` 是崩溃可恢复的中间/终态，由启动对账器（§5.7）收敛。

**Revision 契约（Epic review B1）**：`revision` 持久化在 record 上，初始 1，store 的每次写入在同一原子写内 +1。它随 `TeamSnapshot` 出现在**所有** wire 表面——`team.list`、`team.inspect`、`team_update` 携带同一字段，客户端按 per-team revision 丢弃一切旧值（迟到的 list 覆盖不了新的 update）。

### 3.2 Labels：可重建索引，不是事实源

`packages/protocol/src/agent-labels.ts` 新增：

```ts
export const TEAM_ID_LABEL = "paseo.team-id";
export const TEAM_ROLE_LABEL = "paseo.team-role";
```

用途仅两个：客户端从 `agent_update` 快照就地识别成员（无需等 team 快照）、`create_agent` 的 team 继承判定。任何 labels 与 roster 的分歧以 roster 为准，对账器负责修复 labels。

### 3.3 Parent 与 team 解耦（评审 M3）

v1 的"所有成员 parent 指向 lead"被否决。现有 agent-scoped create 把**调用者**设为 parent（`commands/create-agent/intent.ts:21`），成员招募的新 agent 会挂在成员而非 lead 下，强改会破坏委派树语义；`inheritTeam:false` 的"team 外私人 subagent"也会被 lead 的 cascade 误伤。

v2 规则：

- **parent label 只表达委派树**，保持现有语义完全不动：谁创建，parent 就是谁。daemon 预建的成员不设 parent（roster 已经表达归属）。
- **team archive 显式遍历 roster**（§5.6），不依赖 parent cascade。cascade 保留原职责：收掉成员各自的委派 subagent。
- 成员 tab 的关闭语义不再搭 parent 的便车，改为显式规则（§6.4）。

### 3.4 存储

```
$PASEO_HOME/teams/{team-id}.json
$PASEO_HOME/teams/{team-id}.inbox.json
```

`team-store.ts` 借鉴 `schedule/store.ts` 的 atomic write 与写串行化，但**损坏容忍策略需自行实现**（ScheduleStore 的 `list()` 遇单个损坏文件会整体失败）：逐文件 `safeParse`，失败的跳过并告警，不阻塞其余 team 加载。该策略必须有测试。store 启动时构建 `idempotencyKey → teamId` 内存索引，并对同 key 的创建请求做 per-key 串行（§5.2）。

## 4. 协议设计

### 4.1 RPC（dotted + `.request`/`.response`，出站带 `payload` 层）

新增 `packages/protocol/src/team/rpc-schemas.ts`。出站响应对齐现有 envelope（`payload` 包裹）：

```ts
// team.create.request
{
  type: "team.create.request",
  requestId: string,
  idempotencyKey: string,             // 生命周期规则见下
  name: string,                       // 1..60，服务端校验
  workspaceId: string,
  task: string,
  lead: TeamMemberSpec,
  members: TeamMemberSpec[],          // ≤ 8（非 lead），可空 → lead 自行招募
  templateId?: string,
}

// TeamMemberSpec —— provider 引用对齐 create_agent 工具现状（provider 串含模型，settings 无 model 字段）
{
  role: string,                       // 非空，保留字 "lead" 仅 lead 可用，服务端校验
  title?: string,
  provider: string,                   // "codex/gpt-5.6-sol" 形式
  settings?: { modeId?, thinkingOptionId?, features? },
  briefing?: string,
}

// team.create.response
{ type: "team.create.response", payload: { requestId, team: TeamSnapshot | null, error: string | null } }
```

**幂等键生命周期（Epic review 轮 2 B2）**：客户端只在**结果未知**的重试（断线、超时、daemon 无响应）间复用同一 key；收到确定的 `failed` 快照后，用户发起的再次创建生成**新 key**。服务端：同 key 且**请求指纹一致**（§5.2，跨重启有效）→ 返回既有 team 当前快照（含 failed）；同 key 但指纹不一致 → 返回 conflict 错误。

其余：`team.list`（`includeArchived?`）、`team.inspect`、`team.archive`、`team.member.remove`（禁止移除 lead，服务端拒绝）。

### 4.2 广播与增量同步（Epic review B1 + 阶段二 NEW-B3）

- `team_update` — `{ payload: { team: TeamSnapshot } }`。revision 在快照内（§3.1），不单独携带。
- `team.list.response` 返回同构快照数组。客户端对每个 teamId 维护 last-seen revision：同一 team 的任何来源快照（list、inspect、update），revision 不大于 last-seen 即丢弃。
- **Hydration 语义（含集合级竞态，阶段二 NEW-B3）**：App 的 hydration 请求固定 `includeArchived: false`，list 响应对 **active 集合是 authoritative replacement**——本地 active 集合中不在响应内的 team 视为已不再 active，移除。但 replacement 只能基于"list 快照时刻"的事实，因此 **hydration 期间（list 请求发出到其结果提交之间）到达的 `team_update` 必须按序缓存，在 list 提交之后重放**——重放可以重新加入 list 快照里缺席的新 team（list 生成后才创建的），replacement 不会误删它们。缓存按 connection epoch 隔离，重连即重建。per-team revision 规则只约束"同一 team 的新旧快照"，不约束集合成员资格。测试场景："断线期间 archive、重连列表缺席"与"`team_update` 新增了 list 中缺席的 team"。
- 触发点：lifecycle 变化、roster 变化。成员 agent 状态变化不触发（`agent_update` 的职责）。

### 4.3 Chat room 订阅与改造（评审 M5/M6/M7 + Epic review B4）

现状核实：chat 已有完整 CRUD + wait，但 `read` 只有 `limit/since` 无向前分页；mention 唤醒逻辑在 Session handler（`session/chat/chat-schedule-loop-session.ts`）而不在 ChatService；`authorAgentId` 必填，人类发言实际写 `clientId`；所有房间共用一个 JSON 文件整写（`chat-service.ts` persist 队列）。为 team 落地需要的 chat 改造：

1. **消息作者模型与写入边界**：`ChatMessage` 增加 optional `author: { kind: "agent" | "human", id: string }`（旧字段 `authorAgentId` 保留不动，append-only）。写入统一收敛到 `ChatService.postMessage(actor, ...)` 边界，mention 解析、持久化、fanout（含唤醒）都在 service 内完成，Session handler 与 agent 工具都调它（评审 M6）。

   **Mention 唤醒语义（DEC-10）**：
   - **可唤醒** = 未 archived 且**非 running**。判定顺序：live 实例状态优先（`idle`/`error` 可唤醒）；无 live 实例时 storage 兜底——持久记录 `lastStatus` ∈ {`closed`, `idle`, `error`} 视为可唤醒，唤醒 prompt 走现有 `sendPromptToAgent` → `ensureAgentLoaded()` 恢复路径。daemon 重启后的 stored-only 成员因此同样可被 mention 唤醒。
   - 可唤醒 → 以 `replaceRunning: false` 非替换提交唤醒 prompt。
   - `running` → **不打断**，消息只落 room，等目标下次被唤醒/开始新 turn 时按简报从增量读到。
   - **竞态**（判定为可唤醒、提交时已进入 running）：非替换提交不打断当前 turn（按现有 prompt 路径的排队/out-of-band 行为处理），语义保持"不打断"。
   - 验收四分支：live idle、stored-only closed、running、idle→running 竞态。

2. **订阅协议**：
   - `chat.room.subscribe.request/.response` — 响应**原子**返回首屏消息页 + 单调 `cursor`（房间内消息序号），杜绝先 read 后 subscribe 的漏/重（评审 M5）。
   - `chat_room_message` 广播 — `{ payload: { roomId, message, cursor } }`，客户端按 cursor 去重、断线后用 cursor 增量补齐。
   - `chat.room.unsubscribe.request/.response`。订阅按**物理 socket（source）**保存与清理，socket 断开即清除（见 4.4）。
3. **房间所有权**：`ChatRoom` 增加 optional `ownerKind/ownerId`。team room 的 owner 是 team：通用 `chat/delete` 拒绝删除有 owner 的房间。**`createRoom` 支持显式指定 `roomId` 与 owner**：同 id 且同 owner/config 的重复创建返回既有房间，不同 owner/config 冲突拒绝；并提供 **owner 专用清理接口**（供 TeamService 对 failed team 废弃房间）。房间内部名用 `team-{id}` 保证唯一，展示名另存（评审 M7）。
4. **存储与存量迁移（策略冻结）**：chat 改为按房间分文件（`$PASEO_HOME/chat/rooms/{room-id}.json`）。迁移是**一次性启动迁移**，关键不变量：**marker（`$PASEO_HOME/chat/.migrated`）落盘之前，新格式不接受任何写入**——因此 pre-marker 的 per-room 文件只可能来自中断的迁移（与 legacy 同源），"已存在即跳过"是确定性规则，无需新旧比较。

   执行顺序固定：**(a) 逐房间写 per-room 文件（已存在的跳过）→ (b) legacy 原子改名 `.bak` → (c) 原子写 marker**。全程保留全部有效 room/message ID、顺序与时间戳；legacy 中损坏的条目跳过并告警，不因部分损坏放弃迁移，绝不删改 legacy 原件。

   启动恢复状态表（按 marker / legacy / `.bak` 的存在性）：

   | marker | legacy | `.bak` | 动作                                            |
   | ------ | ------ | ------ | ----------------------------------------------- |
   | ✓      | 任意   | 任意   | 迁移已完成，只读新格式                          |
   | ✗      | ✓      | 任意   | 续跑：补写缺失 per-room 文件 → 改名 → 写 marker |
   | ✗      | ✗      | ✓      | 改名已发生 ⇒ per-room 已齐 ⇒ 直接写 marker      |
   | ✗      | ✗      | ✗      | 全新安装，直接写 marker                         |

   崩溃注入点：第 k 个房间文件后、改名前后、marker 前。验收场景：old-only、两格式并存、各注入点中断后重启、重复启动、损坏 legacy。

### 4.4 能力门控：按 socket，不按 session（评审 B4）

一个逻辑 Session 可挂多个物理 socket，且 `supports()` 会被最近一次 hello 覆盖。所有新广播（`team_update`、`chat_room_message`）必须走已有的 `supportsForSource(capability, source)` 按 socket 门控（`session.ts:1159` 已有此机制和按 source 发送模式）。

- `CLIENT_CAPS.teams` — 门控 `team_update`。
- `CLIENT_CAPS.chatRoomSubscriptions` — 独立能力，门控 `chat_room_message`（chat 推送是通用能力，不挂在 teams 下）。
- `server_info.features.teams`、`features.chatRoomSubscriptions` — 客户端入口门控。
- 所有兼容点带完整 `COMPAT` 标签：`// COMPAT(teams): added in vX.Y, drop the gate when floor >= vX.Y`（含版本与移除条件/日期）。
- wire schema 纯净规则不变。zod-aot 关注点：服务端入站是 runtime `safeParse`，zod-aot 生成的是**客户端对 daemon 出站的校验**，PR1 两侧 schema 都要过 `docs/protocol-validation.md` 的纯净规则。

## 5. Server 实现

### 5.1 模块与事件流

```
packages/server/src/server/team/
├── team-store.ts        # 持久化 + 损坏容忍 + 写串行化 + 幂等索引
├── team-service.ts      # 创建事务、归档、退队、对账器、inbox 泵
├── team-inbox.ts        # task ledger（outbox）+ 唤醒队列（§5.3）
├── team-prompts.ts      # lead/member 简报模板
└── *.test.ts
```

前置依赖（评审 M2）：`AgentManager` 目前没有可多订阅的记录变更事件——唯一 lifecycle callback 是单槽 setter 且已被 ScheduleService 占用，`AgentManagerEvent` 不携带 archive/delete/label 变更。需先加：

1. **多订阅者的 agent 记录变更事件流**（archive / unarchive / delete / label patch，覆盖 stored-only 记录的变更路径），TeamService 与 ScheduleService 都消费。
2. **可查询的 per-turn 终态事实（阶段二 NEW-I1 细化）**：现状终态 stream event 只带 timestamp、`StoredAgentRecord` 只有 `lastStatus`。新增 agent record 的 **optional 字段 `turnOutcomes`**：capped append-only 列表（上限 100 条），元素 `{ turnId, outcome: "completed" | "failed" | "canceled", endedAt }`。契约：
   - **Legacy-safe**：optional + default 空，旧记录照常解析；schema 变更 append-only。
   - **写入所有权**：仅 AgentManager 在 turn 终态处写入，且**先持久化终态事实、再派发事件**；agent snapshot 持久化路径（`agent-storage.ts` 的重建式写入）必须保留该字段——"无关 snapshot 写不得擦除终态事实"是显式测试。
   - **保留与滚出**：容量满滚出最旧。
   - **终态判定三态规则（阶段二轮 2）**：ledger 对 `acceptedTurnId` 的判定必须可判定，依据是 `turnOutcomes` 与**持久化的 daemon-owned active turn identity**（agent 快照已携带活跃 turn 标识，ITEM-2 确保其随记录持久化可查询）。**活跃 turn 标识的收敛契约（阶段二轮 3）**：持久化的活跃 turn 携带 **daemon run 标识**；daemon 启动时，run 标识不属于本次运行的活跃 turn 一律视为陈旧并清除——崩溃后该 turn 不可能仍在运行（provider 进程随 daemon 消亡，resume 不自动续跑 turn），清除后三态规则落入 ③（unknown 结算），状态 ② 不可能成为永久陷阱；正常路径中**终态追加与活跃 turn 清除是同一原子写**；**TeamService 泵设启动屏障：该 reconciliation 完成后才运行**。测试："持久化 active 后 hard kill → 重启清除 → unknown 结算"与"正常完成 → 终态与清除原子一致"。三态判定：① `turnOutcomes` 中查到 → 按该 outcome 结算；② 查不到但 `acceptedTurnId` 等于该 agent 当前持久化的活跃 turn → **尚未终态，继续等待**（不结算、不释放 FIFO）；③ 两者皆非 → 终态事实不存在或不可恢复（滚出、或 daemon 在 turn 中途崩溃导致 turn 未正常终结）→ 结算 `settled(outcome: "unknown")` 并照常入队，lead 收到"结果未知"通报后自行向成员求证。三态互斥：不会把运行中的 turn 提前判 unknown，也不会让已消失的 turn 永久挂起。语义仍是无丢失。
   - 归 ITEM-2 交付；`docs/data-model.md` 同步（ITEM-2 docs 清单）。

**事件派发时序**：事件在状态**落盘后异步派发**；派发不持有任何 per-team 锁，订阅者失败不改变触发操作的结果，只记录告警。TeamService 消费事件时自行进入 per-team 串行队列——避免递归死锁。**事件流是加速通道，不是正确性来源**：team 侧所有依赖事件的状态（roster 落账、ledger 结算、inbox 入队）都必须能由对账器从持久状态重建。

ScheduleService 迁移到该事件流的回归契约：live 与 stored-only 的 agent archive 都只完成**目标 agent** 的未完成 schedule；已完成与无关 schedule 不变；订阅者异常不影响 archive 主路径；启动 orphan sweep 保留。

### 5.2 创建事务（评审 B1 + Epic review 轮 2/3 三轮重做）

**请求级幂等**：`idempotencyKey` 持久化在 record（§3.1）。store 启动建 key→teamId 索引；同 key 请求进入 per-key 串行队列。**同 payload 判定用持久化的 `requestFingerprint`**：对规范化请求（排除 `requestId`、`idempotencyKey` 等传输字段，字段排序后序列化）取 SHA-256，首个原子写落盘、永久保留——重启后仍能区分"同意图重试"与"同 key 冲突"。语义见 §4.1。

**创建意图持久化**：`creationPlan`（§3.1）在首个原子写中与 record 一起落盘，包含全部预分配 ID 与规范化创建意图。创建完成前不可变；对账器凭它在**任意**崩溃点重建剩余资源与正确简报。`active` 后清 null（指纹保留）。

**资源级幂等**：`creationStage` 是对账器的工作范围界定，**正确性来自逐资源幂等创建**：

- **指定 ID 创建 agent**（`AgentManager` 新能力）：同 id 已存在且属于同一 team（labels/config 匹配）→ 返回既有 agent；同 id 存在但归属冲突 → 拒绝。
- **指定 ID 创建 room**（§4.3.3 的 ChatService 能力）：同语义。
- 简报/初始 prompt 用确定性 `clientMessageId`（`team-{teamId}-briefing-{agentId}`），prompt 接受层按 clientMessageId 对同一 agent 去重（该去重能力若现路径缺失，属 ITEM-4 交付）。接受边界的残余重复按 §5.3 的 at-least-once 容忍。

**阶段化流程**：

1. 校验 workspace、成员数上限（非 lead active ≤ 8）、role 保留字。
2. 预分配全部 ID。
3. **首个原子写**：record（`lifecycle: "creating"`、`creationStage: "allocated"`）+ roster 全量 + `requestFingerprint` + `creationPlan`。
4. 创建 chat room（指定 id，owner = team）→ `creationStage: "room_created"`。
5. **无 prompt** 逐个创建 agent（指定 id、打 labels）→ 全部完成后 `creationStage: "agents_created"`。
6. 安装 inbox 订阅（先于任何 prompt）。
7. 按 creationPlan 发送成员简报、lead 简报 + task（确定性 clientMessageId）→ `creationStage: "briefed"`。
8. record 转 `active`、`creationStage: null`、`creationPlan: null`，广播 `team_update`。

**失败与恢复**：任一步失败 → `lifecycle: "failed"`（保留 creationStage、creationPlan、roster）。对账器对 `creating` 凭 creationPlan 逐资源续跑，对 `failed` 执行清理（归档已建 agent、owner 接口废弃 room），完成落 `failedCleanupAt`。验收覆盖：**`allocated` 后 kill**、批内每个副作用点 kill（第 k 个 agent 后、room 后、每条简报后）、同 key 并发、重启后**不同 requestId 的同意图重试**、**重启后改变 task/provider/briefing 的同 key 冲突**、failed 清理幂等、failed 后换新 key 可重建。

### 5.3 协调模型：持久化 task ledger（outbox）+ at-least-once（阶段一 B2/B3 + 阶段二 NEW-B1 修订）

**端到端语义：at-least-once。无丢失是硬保证；重复在最终确认前次数无上限**（repeated crash 可致多次重发），deliveryId/clientMessageId 去重是 best-effort 削减，不是上界承诺。这适用于全部三类投递：初始简报（§5.2）、assignment prompt、delivery 通报。assignment prompt 重复可能触发成员重复执行工具副作用——该风险被显式接受（§12），由各 agent 既有的 permission 流程约束破坏性操作。provider 出现幂等接受协议后可升级。

**Task ledger = 持久化 outbox**（`teams/{id}.inbox.json`，与唤醒队列同文件）：

```
assignment := {
  taskId, assigneeAgentId,
  prompt,                                  // 落账即持久化，崩溃后可重发
  clientMessageId,                         // 确定性：team-{teamId}-task-{taskId}
  state: "queued" | "dispatched" | "settled",
  acceptedTurnId: string | null,           // provider 接受时记录（daemon-owned turn identity）
  outcome: "completed" | "failed" | "canceled" | "unknown" | null,  // settled 时必填
  completionEventId: string | null,        // settled 时 = {taskId}:{acceptedTurnId | "unknown"}
  createdAt, dispatchedAt?, settledAt?,
}
```

- **落账**：`assign_task`（lead 专用，按 roster 校验）→ 原子落账 `queued`（含 prompt 与 clientMessageId）→ 进入派发循环。
- **派发契约（阶段二 NEW-B1，冻结）**：**无抢占**。assignment 只在 assignee **可唤醒**（§4.3.1 定义：未 archived 且非 running，live 优先 storage 兜底）时派发，以 `replaceRunning: false` 非替换提交；assignee busy 时 assignment 保持 `queued`，由事件流中 assignee 的状态变化（转 idle/终态）触发派发循环重试——不轮询、不打断、不取消已运行的 turn。**同一 assignee 的多个 queued assignment 按 FIFO 串行派发，同一时刻至多一个 `dispatched`（in-flight）**：前一个 settled 后才派发下一个。这同时给 `acceptedTurnId` 的因果绑定提供了唯一性基础。派发成功（provider 接受）→ 记 `dispatched` + `acceptedTurnId`。
- **结算（因果绑定）**：assignment 只由 **`acceptedTurnId` 对应 turn 的终态事实**（§5.1.2 的持久化查询面）结算——同成员的 mention 唤醒、人为 prompt 或后续 assignment 不会错误结算它。结算判定遵循 §5.1.2 的三态规则（查到终态 / 仍是活跃 turn / unknown）。**结算与 completion 入队是同一文件的一次原子写**。
- **恢复与触发（阶段二轮 2 修订）**：泵的触发有两层——**事件触发为主**（assignee/lead 状态变化、终态事件），**低频兜底扫描为底**：只要存在未决项（`queued`/`dispatched` assignment 或未确认 delivery），泵以固定低频间隔（60s 级）自行重扫重试，事件丢失（订阅者异常、竞态）时不依赖 daemon 重启也能收敛；无未决项时不扫描。启动时全量扫一次。`queued` 的按派发契约重试；`dispatched` 的按 §5.1.2 三态规则判定。"落账后发送前 kill""provider 接受后记账前 kill""终态持久化后入队前 kill"三个窗口分别由重发、重发+去重、终态查询收敛；"丢弃 idle 事件且不重启 daemon 仍收敛"是显式测试。
- permission 请求不是终态，不入队、不注销任何监听（走现有 permission UI 流）。
- **投递**：泵在 lead 可唤醒时把待达事件合并为一个 delivery，`deliveryId` 由所含 completionEventId 集合确定性派生，delivery 先落盘 → 以 `clientMessageId = deliveryId`、`replaceRunning: false` 发送 → 确认后落 `deliveredAt`。lead 简报要求"同 deliveryId 已处理则确认后跳过"。
- lead 忙则等 idle（事件流的 lead 状态变化触发泵）；期间新事件并入下一个 delivery。

这仍不是编排引擎——ledger 不理解任务语义，只是把"不可靠的即时打断"换成"可靠的合并投递"。

### 5.4 工具目录扩展（阶段二 NEW-B2 修订）

| 工具                                    | 说明                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `chat_post` / `chat_read` / `chat_wait` | 走 `ChatService.postMessage(actor)` 边界；agent-scoped 缺省 room = 调用者 team room；`chat_wait` timeout 封顶 5 min |
| `team_status`                           | 从 team record 读 roster + join 各成员 `lastStatus`（storage 兜底，不只看内存）                                     |
| `assign_task`                           | §5.3，lead 专用（按 roster 校验）                                                                                   |
| `create_agent` 修改                     | 见下                                                                                                                |

**`create_agent` 的 team 招募契约（NEW-B2 + 阶段二轮 2 事务化）**：调用者带 team label 且未 opt-out（`inheritTeam: false`）时，新增**条件必填参数 `teamRole: string`**——缺失则拒绝；受保留字校验（`"lead"` 拒绝）。`title` 保持现有独立语义不合并；招募 agent 的职责简报由招募者写在 `initialPrompt`。

**招募是两阶段事务**（不复用普通 create 路径的"先建后钩"顺序）：

1. **预留（per-team 锁内）**：校验 **team `lifecycle: "active"`**、调用者在 roster 中 `state: "active"`、容量（非 lead active < 8）→ 预分配 agentId → **原子写**：roster entry `state: "active"` + `pendingRecruitments[agentId]` 完整意图（`RecruitmentIntentSchema`，§3.1——provider/settings/title/teamRole/initialPrompt/确定性 clientMessageId/recruiterAgentId/workspaceId，`stage: "reserved"`）。容量预留先于任何外部资源；最后名额并发在锁内串行，败者建资源前被拒。
2. **落地（每步前 lifecycle fence：team 仍 `active` 才继续）**：指定 ID 幂等创建 agent（打 labels，parent 按现有语义指向招募者）→ 意图 `stage: "created"` → 以意图中的 clientMessageId 发送 `initialPrompt`（prompt 层去重）→ 清 `pendingRecruitments[agentId]`。fence 失败（team 已 archiving/archived/failed）→ **取消**：entry 转 `removed`（`removalReason: "recruitment_canceled"`），已建 agent 归档，意图清除。

崩溃对账（§5.7，含优先级）：**team active** 时——`reserved` 且无 agent 记录 → 凭意图幂等重建并继续；`created` 且意图未清 → 补发 prompt（clientMessageId 去重）→ 清意图；重放不可行 → entry 转 `removed`（`removalReason: "recruitment_failed"`）释放名额并清理残留。**team 非 active** 时——一律取消补偿（同 fence 失败路径）。roster + 意图先行保证不存在"agent 带 team labels 却不在权威 roster"的状态。测试覆盖：空初始 `members` 后由 lead 全程招募组队、`teamRole` 缺失/保留字拒绝、**每个写入窗口 kill**（预留后建 agent 前 / agent 建成 prompt 未接受 / prompt 后意图未清）、最后名额并发、**预留后 team archive/成员 remove 交错 → fence 取消且零残留**。

### 5.5 简报模板

两段式（lead / member）：lead 简报包含真实成员 ID 列表、派发指令用 `assign_task`（说明派发是无抢占的：成员忙时任务排队）、招募指引（用 `create_agent` + `teamRole`，并在 initialPrompt 里交代 room 纪律）、通报模型为合并投递、**同 deliveryId 已处理则跳过**、"outcome: unknown" 通报的求证指引、关键节点在 room 同步记录；member 简报包含 role、briefing、room 纪律（接活前读增量、接受/完成/受阻时发短消息）、报到后自然 idle。注入方式是拼 `initialPrompt`（provider 无关）。

### 5.6 归档、退队、外部 unarchive 与 hard delete（阶段一 M1/M4/NF-1 + 阶段二 R3-NF-1/NEW-B4 修订）

- **`team.archive`（目标集合冻结，阶段二轮 2）**：record 转 `archiving` → **归档目标集合 = roster 中 `state: "active"` 的 entry（含 lead 的 active entry）**；`removed`（任何原因）与 `archived` 的 entry、以及 agent 记录不存在（已 hard delete）的 entry 一律**视为已完成**，不重复归档、不报错——缺失记录的"视为已完成"语义由 **TeamService 专用幂等包装层**实现（包装现有 lifecycle 命令，missing → completed），**不改变** user-facing `archive_agent` 的 not-found 报错契约（阶段二轮 3 R3-I2）。归档走幂等 lifecycle 命令路径（可处理未加载记录），**per-team 串行化**，与 workspace teardown 的并发归档靠幂等性共存。全部完成 → `archived` + `archivedAt`。中途崩溃 → 对账器续跑（顺序见 §5.7）。room 保留。
- **反向同步**：消费 §5.1 事件流（异步、不持锁）。lead 被外部归档 → 触发 team archive 流程。成员被外部归档 → roster entry 转 `archived`，`team_update`。
- **Hard delete（阶段二 NEW-B4）**：
  - 非 lead 成员被 hard delete → roster entry 转 `removed`（`removalReason: "hard_deleted"`）。
  - **active team 的 lead 被 hard delete →（规则冻结）触发 team archive 收敛**：team 走 `archiving → archived` 流程（目标集合规则同上），lead entry 转 `removed`（`removalReason: "hard_deleted"`），`leadAgentId` 保留为历史引用（archived team 不要求 lead 记录存在）。事件丢失由对账器兜底（§5.7 active 校验）。
  - **creating team 期间的 hard delete →（阶段二轮 3，deletion guard）**：daemon 的 hard delete 路径**同步拒绝**删除"出现在任一 `creating` team roster 中"的 agent（TeamService 注册 deletion guard，guard 挂点归 ITEM-2）——现状 hard delete 无持久 tombstone，"记录缺失 = 已删除还是未创建"在批内窗口不可判定，guard 从源头消除该窗口，不依赖事件。兜底：对账器 creating 分支续跑前仍校验 lead 记录状态，stage 语义上应存在却缺失（guard 之外的极端路径）→ 转 `failed` 不重建。测试落在"lead 已创建、批 stage 未提交"的窗口：guard 拒绝删除；以及对账兜底分支。
- **退队**（`team.member.remove`）：roster entry `leftAt` + `removed`（`removalReason: "removed_by_user"`）→ 摘 team labels → `team_update`。禁止对 lead 调用。parent label 不动。
- **外部 unarchive（阶段二 R3-NF-1 统一，规则冻结）**：任何 roster 成员（**含 lead**）被单独 unarchive 时，**正常事件路径与崩溃恢复路径执行同一规则、产生同一结果**：
  - team `lifecycle: "active"` **且**（该成员是非 lead 且 active 非 lead 名额未满 < 8）→ roster entry 恢复 `active`（`removalReason` 清 null），labels 修复，`team_update`。
  - **其余一切情况**（team 非 active——archived/archiving/failed；或名额已满；或该成员是 lead 而 team 非 active）→ roster entry 转 `removed`（`leftAt` 落账，`removalReason: "unarchive_evicted"`），**清除该 agent 的 team labels**，agent 作为普通 agent 继续。不存在"archived team 里的 active 成员"，也不存在"entry 保持 archived 但 agent 已活跃"的中间态。
  - active team 的 lead 被 unarchive（此前被单独 archive 但 team 因故仍 active 的瞬时窗口）→ 恢复 `active`，同第一分支。
  - 崩溃恢复：unarchive 落盘与事件消费之间崩溃的补偿由对账器执行**同一规则**（§5.7）；"正常消费与 kill-recovery 结果等价"是显式测试。
  - team 级 unarchive 是 Phase 3 的开放项。
  - 全部分支进 ITEM-4 自动化验收。

### 5.7 启动对账器

daemon 启动时扫描**全部** team record：

- `creating` → 先校验 creationPlan 中 lead 记录状态（应存在却缺失 → 转 `failed`，§5.6）→ 再凭 `creationPlan` + 逐资源幂等创建续跑（§5.2），无法继续则转 `failed`。
- `archiving` → **先**对 roster 应用 §5.6 的 unarchive-eviction 补偿（agent 已被 unarchive 而 entry 未处理的 → evict），**再**对剩余归档目标集合续跑归档——正常路径与恢复路径由此产生同一结果。
- `failed` 且无 `failedCleanupAt` → 清理（归档 roster 内已建 agent、owner 接口废弃 room），完成落 `failedCleanupAt`。
- `active` → 校验 roster 与 agent storage 一致：记录存在性、labels、archive 状态（按 §5.6 各规则补偿，含 unarchive eviction）；**处理 `pendingRecruitments`（§5.4 对账优先级）**；**lead 记录不存在（已被 hard delete）→ 触发 team archive 收敛（§5.6）**。
- `archived` / `failed` → 校验 roster entries 与 agent storage 的 archive 状态一致：发现"agent 已被 unarchive 但 entry 未按 §5.6 处理"的（含 lead），补偿执行同一 eviction 规则；残留 `pendingRecruitments` 一律取消补偿（§5.4）。
- inbox/ledger：`queued` assignment 按派发契约重试；`dispatched` 对照持久终态（或滚出 → unknown）结算；未确认 delivery 重发（§5.3）。

## 6. App 实现

### 6.1 状态与同步（评审 M8 + 阶段二 NEW-B3）

现有架构：store 只保存状态（`stores/session-store.ts`），网络 handler 在 `contexts/session-context.tsx`，list/delta 竞态由 `runtime/directory-sync/` 的 generation 机制处理。照此新增：

- `runtime/team-sync/`：连接后（`features.teams` 为真）拉 `team.list`（`includeArchived: false`）；**hydration 期间到达的 `team_update` 按 connection epoch 缓存，list 结果先提交（对 active 集合 authoritative replacement），随后按序重放缓存的 update**（§4.2）；之后进入流式消费；对每个 teamId 维护 last-seen `revision` 丢弃旧快照；hydration 状态显式建模。store 本身不发 RPC。
- `teams/select.ts`：`selectTeamMembers` 按 roster（来自 TeamSnapshot）join agent 状态，不按 label 扫（label 只作 `agent_update` 先到时的临时归类）。
- 聚合状态优先级对齐现有 `sidebar-agent-state.ts`：**needs_input（permission）> running > idle**。

### 6.2 新建入口（评审 M10）

单一 **keyed `TeamFormModel`**（非 React、遵循 `docs/forms.md` golden pattern）：成员行是 model 内的 keyed 子结构，行内 provider/model 解析复用 `resolve-agent-form.ts` 的**纯函数**，不复用 `use-agent-form-state` hook。模板 = 表单预填，**模板默认把 lead 指到工具支持最好的 provider**。确认页展示成员数与各成员 provider。提交 → `team.create.request`；`idempotencyKey` 按 §4.1 生命周期规则生成与复用 → 成功导航。

### 6.3 Team 面板：workspace panel，不是独立路由（评审 M9）

- team 视图是 **workspace panel target**：`workspace-tabs/model.ts` 的 tab 联合类型新增 `{ kind: "team", teamId }`，接全 identity、持久化、恢复。
- `/h/[serverId]/team/[teamId]` 只做 **deep-link resolver**：解析后 `navigateToWorkspace({ target: { kind: "team", teamId } })`。实现前必读 `docs/expo-router.md`。
- **Close policy 显式规则**：关闭 team tab 是 layout-only；关闭 lead 自己的 agent tab 时，若该 agent 是活跃 team 的 lead，**不走 root-agent 的关闭即归档**，改为提示"这是 team 的 lead，请从 team 面板归档"。
- 面板布局：room 主区（时间线消费 §4.3 订阅协议；长消息折叠兜底）+ 成员条 + 权限聚合条 + compact 适配（`docs/mobile-panels.md`）。
- 侧栏：`sidebar-projection.ts` 现只投影 project/workspace，team 条目是对它的扩展。

### 6.4 去重规则

roster 内成员不进 lead（或招募者）的 subagents track（`subagents/select.ts` 按"agent 的 `TEAM_ID_LABEL` 命中任一活跃 team"排除）；生命周期按钮只在 team 面板出现。

## 7. CLI

```
paseo team create --name X --workspace W --task "..." --lead codex/gpt-5.6-sol \
  --member reviewer=claude/claude-fable-5 [...]
paseo team ls [-a] / inspect <id> / archive <id> / remove <team-id> <agent-id>
```

术语统一：`remove`（不用 `leave`）。`create` 的 `idempotencyKey` 按 §4.1 规则：单次调用内部重试复用；确定失败后再次执行命令生成新 key。

## 8. 不变量（服务端强制）

- `lead` role 保留：仅创建事务可授予；`assign_task` 校验调用者是 lead；`create_agent` 招募的 `teamRole` 拒绝 `"lead"`。
- `team.member.remove` 拒绝 lead。
- **成员数上限：roster 中 `state: "active"` 且非 lead 的条目 ≤ 8**。创建请求、`create_agent` 招募入队、外部 unarchive 恢复（§5.6）都按此校验；lead 不计入。边界测试：8 通过 / 9 拒绝 / removed 后名额回收 / 名额满时 unarchive 转 removed。
- name/role 长度上限 schema 层固定。
- 同一 agent 同时至多属于一个活跃 team（`create_agent` 继承与 roster 写入时校验）。
- 同一 assignee 同一时刻至多一个 `dispatched` assignment（§5.3 派发契约）。
- team 的一切生命周期操作 per-team 串行；事件派发不持有该锁（§5.1）。

## 9. 兼容性清单

- 全部新增消息 optional/append-only；`features.*`、`CLIENT_CAPS.*` optional；广播一律 `supportsForSource` 按 socket 门控；每个门控点带含版本与移除条件的完整 `COMPAT(teams)` / `COMPAT(chatRoomSubscriptions)` 标签。
- `ChatMessage.author` 为 optional 新字段，`authorAgentId` 保持必填不动；旧协议 fixture 解析测试作为证据。
- `StoredAgentRecord.turnOutcomes` 为 optional 新字段，legacy 记录照常解析（§5.1.2）。
- 老 app + 新 daemon：无入口、无广播；team 成员显示为普通 agents（降级可接受）。
- 客户端 zod-aot 出站校验与服务端入站 `safeParse` 两侧 schema 都过纯净规则。

## 10. 测试计划（遵循 docs/testing.md，只跑单文件；场景与子项的绑定见 Epic 子项契约）

- **崩溃/重启**：创建事务 `allocated` 后与批内每个副作用点 kill → 凭 creationPlan 对账收敛；`archiving` 中断 → 先 eviction 补偿再续跑且与正常路径结果等价；**creating 期 hard delete 被 guard 同步拒绝（含"lead 已创建、批 stage 未提交"窗口）+ 对账兜底分支**；**持久化 active turn 后 hard kill → 重启陈旧清除 → unknown 结算，泵在屏障后才运行**；**archive 遍历遇 removed/缺失记录视为完成不抛错**；ledger 三窗口 kill（落账后发送前 / provider 接受后记账前 / 终态持久化后入队前）→ 无丢失；delivery 发送前/后 kill → 无丢失（重复由去重削减）；**unarchive 落盘后事件消费前 kill → 对账执行同一规则，正常路径与恢复路径结果等价（含 lead）**；**lead hard delete 事件丢失 → 重启对账触发 team archive 收敛**。
- **幂等**：同 `idempotencyKey` 并发与重启后重试（不同 requestId 同指纹）；重启后改 payload 的同 key conflict；确定失败后换新 key 可重建；failed 清理幂等；指定 ID 创建 agent/room 重复/冲突两分支。
- **派发契约**：assignee busy 时 assignment 保持 queued 不打断；assignee 转 idle 触发派发；同 assignee 多 assignment FIFO 串行、同时至多一个 dispatched；首个仍 running 时第二个不派发；**丢弃 idle 事件且不重启 daemon → 兜底扫描收敛**。
- **招募事务**：预留后建 agent 前 / agent 建成 prompt 未接受 / prompt 后意图未清三个窗口 kill → 对账按意图收敛；最后名额并发仅一成功且败者零残留；**预留后 team archive/remove 交错 → fence 取消、`recruitment_canceled` 落账、零残留**。
- **因果绑定与三态判定**：无关 turn（mention 唤醒、人为 prompt）完成不结算 assignment；同成员先后多 assignment 各自结算；**尚未终态的 miss（acceptedTurnId 仍是活跃 turn）不结算不释放 FIFO**；**真实滚出/崩溃中断 → `unknown` 结算入队**。
- **终态事实**：先持久化后派发；无关 snapshot 写不擦除 `turnOutcomes`；legacy 记录（无字段）照常解析。
- **招募**：空初始 members 由 lead 全程招募组队；`teamRole` 缺失拒绝；保留字 `"lead"` 拒绝；上限校验。
- **并发**：workspace teardown 与 team archive 并发；两成员同时完成合并投递；同 team 生命周期请求串行化；事件派发不持锁。
- **通知可靠性**：订阅安装前完成（快速完成，ledger 兜底）；permission 不终结 watcher；lead 忙积压、idle 后合并投递一次。
- **能力矩阵**：同一 session 新老 socket 混连——`team_update` 与 `chat_room_message` 分别只达新 socket；订阅随 socket 断开清理。
- **chat**：subscribe 原子首屏 + cursor 增量无漏无重；owner 房间拒绝通用 delete；指定 id/owner 创建幂等；分文件损坏隔离；迁移（状态表全状态 + 各注入点 + old-only + 并存 + 重复启动 + 损坏 legacy）；mention 四分支。
- **schedule 回归**（§5.1 契约）。
- **生命周期边界**：成员外部 archive / hard delete 落账（removalReason）；外部 unarchive 全分支；跨 workspace 招募；detach 无关性。
- **同步语义**：revision 乱序（update 先到旧 list 后到、重连 hydration）；断线期间 archive、重连列表缺席 → replacement 收敛；**hydration 期间 `team_update` 新增 list 缺席的 team → epoch 缓存重放后存在**。
- **E2E（daemon 级）**：确定性 E2E 用两个不同 provider adapter：创建 → lead 派发 → 成员完成 → room 汇报（human actor 插话 + @mention）→ 多成员 permission 请求与 allow/deny RPC → archive 收敛。
- **E2E（App 级）**：Playwright + 隔离 daemon：两成员同时 permission，聚合条两条目、独立 allow/deny 后 UI 状态正确；New Team/archive/remove/post 的 pending/success/failure。
- **QA 证据**：按 `docs/qa.md` 既有六行 App 平台矩阵（iOS、Android、Web、Desktop macOS/Windows/Linux）出证据；daemon 侧（存储、rename 迁移）说明 macOS/Linux 覆盖与 Windows/Docker 的覆盖或不适用理由；真实 provider 手工 smoke 一次。
- **app 纯函数**：selector（roster join、subagents track 去重）、聚合状态优先级、close policy（lead tab 拦截）；native 冷启动恢复 team tab。

## 11. 实施拆分（7 PR）

每个 PR 附带对应文档更新（owner 见括号）：

1. **PR1 protocol + client**：team/chat 全部新 schema（revision 契约、显式 TeamSnapshot 投影、removalReason）、labels、features、CLIENT_CAPS、`packages/client` 请求方法与事件 union。（docs：`protocol-compatibility.md` 如需示例）
2. **PR2 server 基础**：agent 记录变更事件流（多订阅者、落盘后异步派发、ScheduleService 迁移共用）、**per-turn 终态事实 `turnOutcomes`（形状/所有权/保留/擦除保护）+ 活跃 turn 标识持久化（带 daemon run 标识、startup 陈旧清除、终态与清除同一原子写）**、**deletion guard 挂点**、AgentManager 指定 id 幂等创建、team-store（损坏容忍、幂等索引）。（lifecycle 缺失记录的幂等包装层随 PR4 的 TeamService 落地）（docs：`architecture.md` 模块表、`data-model.md` agent record 字段）
3. **PR3 chat 改造**：`postMessage(actor)` 边界收敛（mention fanout 入 service、可唤醒判定含 storage 兜底、running 不打断）、订阅协议、房间所有权 + 指定 id/owner 幂等创建 + owner 清理接口、分文件存储 + 状态表迁移。独立可发布。（docs：`data-model.md` chat 存储、`architecture.md` 消息类型）
4. **PR4 TeamService**：创建事务（creationPlan + 指纹 + 两级幂等）、task ledger（outbox 状态机 + 派发契约 + 因果绑定 + unknown 结算）、归档/退队/外部 unarchive 统一规则/lead hard delete 收敛 + 全量对账、inbox 投递、prompt 层 clientMessageId 去重（若现路径缺失）、工具（`assign_task`/`team_status`/chat 工具/`create_agent` teamRole 招募契约）、简报、不变量。（docs：`glossary.md`、`agent-lifecycle.md`、`data-model.md` team/inbox 文件）
5. **PR5 CLI + daemon E2E**：`paseo team *`；确定性 daemon 级 E2E 脚本（双 provider adapter）。（docs：`architecture.md` CLI 命令列表）
6. **PR6 app 运行时 + 表单**：team-sync（authoritative replacement + **epoch 缓存重放** + revision）、store、selectors（含去重与聚合优先级测试）、TeamFormModel、新建入口（成本提示、模板默认 provider、幂等键生命周期）。
7. **PR7 app 面板**：workspace tab target、deep-link resolver、close policy、room pane（长消息折叠）、成员条、权限聚合、侧栏、compact + Playwright 权限聚合 E2E + QA 证据（六行平台矩阵）。

本设计文档在落地后按 "integrate, don't append" 并入正式 docs 并删除；删除动作发生在 Epic final acceptance 阶段，同步更新 Epic 的 canonical 引用与最终交付索引。

## 12. 风险与开放问题

- **成本**：一键 N agent。缓解已落子项：确认页成本提示（PR6）、lead 简报按需派发（PR4）；后续做 team 级 usage 只读加总。
- **投递重复（已接受风险）**：at-least-once 语义下，最终确认前重复次数**无上限**；clientMessageId/deliveryId 去重是 best-effort 削减。assignment 重复可能触发成员重复执行工具副作用——由各 agent 既有 permission 流程约束破坏性操作；provider 出现幂等接受协议后升级。
- **unknown 结算**：`acceptedTurnId` 从 `turnOutcomes`（cap 100）滚出的极端积压下，assignment 以 `outcome: "unknown"` 结算，lead 需向成员求证；语义无丢失但增加一次往返。
- **lead 工具可靠性**：模板默认 lead 用工具支持最好的 provider（PR6）。
- **room 消息纪律**：靠实测调 prompt；长消息折叠兜底（PR7）。
- **chat 迁移**：一次性执行后 legacy 以 `.bak` 保留，回滚需手工；状态表与全部注入点有测试覆盖。
- **ScheduleService 迁移**是既有功能回归面；契约固化在 ITEM-2 验收。
- **开放**：team 级 unarchive、per-member worktree + 合并辅助、无 lead 的 room 常驻模式、per-member inbox，Phase 3 决策。

## 13. v1 → v2 决策变更记录（第一轮评审对应）

| v1 决策                                           | 评审  | v2                                                                                                                                                           |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 成员名单只存 labels                               | B3    | roster 账本进 team record，labels 降为索引                                                                                                                   |
| 先建 agent 后写记录，内存回滚                     | B1    | 预分配 ID、record 先行、幂等键、对账器（v2.1+：幂等索引 + creationStage；v2.2：资源级幂等；v2.3：creationPlan + 请求指纹持久化）                             |
| `send_agent_prompt(notifyOnFinish)` 直接唤醒 lead | B2    | 持久化 inbox + idle 合并投递（v2.2：at-least-once + ledger 重建；v2.3：outbox 状态机 + 因果绑定 + 终态事实持久化；v2.4：无抢占派发契约 + per-assignee FIFO） |
| 按 session `supports()` 门控广播                  | B4    | `supportsForSource` 按 socket；chat 推送独立能力                                                                                                             |
| 成员 parent 一律指向 lead；archive 靠 cascade     | M1/M3 | parent 只表达委派树；archive 显式遍历 roster，幂等 + per-team 串行                                                                                           |
| lead archive 状态 = team archive 状态             | M4    | team `lifecycle` 状态机为事实源，lead archive 是触发信号（v2.4：lead hard delete 同样收敛 team）                                                             |
| chat "缺省即人类"、直接调 service                 | M6    | `postMessage(actor)` 统一边界 + author 模型                                                                                                                  |
| 独立 team 路由                                    | M9    | workspace panel target + deep-link resolver + close policy                                                                                                   |
| 每成员行一个 form hook 实例                       | M10   | 单一 keyed TeamFormModel + 纯函数解析                                                                                                                        |
| 6 PR                                              | M11   | 7 PR（chat 改造独立，client 包并入 PR1）                                                                                                                     |
