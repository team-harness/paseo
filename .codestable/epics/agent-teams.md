---
status: active
created: 2026-08-06
work: ../work/epic-agent-teams.md
---

# Agent Teams：多 agent 协作小组

## 起点

Paseo 已有多 agent 基元（agent-scoped `create_agent` 委派、subagents track、labels、workspace/worktree），但没有把它们组合成可用的产品概念：用户无法一键创建一个跨 provider 的协作小组，无法在一个视图里看到小组的协调过程、成员状态与待处理权限。

详细设计经过外部架构评审一轮、Epic design review 阶段一（3 轮）、复核阶段（3 轮）修订。Agent Teams 尚未发布，2026-08-08 owner 决定 v2 是首个公开格式，不支持实验性 v1 数据、RPC 或 UI 的迁移与兼容。本文档只固化当前契约与拆解。

## Agent Teams v2 已接受方向

本节记录目标模型，不描述当前运行行为。当前分支上的早期 Team 实现是可替换的开发基线，不形成公开兼容契约。

- **V2-DEC-1 · Team 与 Mission 分离**：Team 是可复用的组织，拥有稳定 roster；Mission 是 Team 执行的一次顶层任务。创建 Team 不再创建 Mission，Mission 完成也不归档 Team。
- **V2-DEC-2 · 单活跃 Mission**：v2 首版中，一个 Team 同时最多有一个 active Mission。新 Mission 只能在前一个 Mission 进入终态后启动，避免成员容量、共享 workspace ownership、聊天室上下文和调度状态跨任务互相污染。
- **V2-DEC-3 · 首发格式**：v2 是 Agent Teams 的首个公开持久化、RPC 和 UI 格式；开发期旧数据可清理，不实现迁移、双写、legacy adapter、format marker 或降级恢复。

这三个决定是后续 Role、Level、Skill、动态 Workstream 和 Assignment Contract 设计的前提。

## Agent Teams v2 领域模型

本节是首发实现基线。正式 `docs/` 在功能启用前一次性切换到该模型。

### 长期组织与本次工作

| 概念                    | 定义                                                                                                    | 所有者               |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| **Team**                | 绑定一个 workspace 的可复用组织；保存 roster，不保存当前任务                                            | 用户                 |
| **Member**              | Team 中一个稳定席位，以 `memberId` 标识；没有 Mission 时不要求存在运行中的 Agent session                | 用户                 |
| **Role**                | Member 的专业方向短名称，例如“软件工程师”或“架构师”；可重复，不表示本次职责                             | 用户                 |
| **Level**               | Member 可承担工作的自主性和复杂度等级，使用稳定的 1–5 排序值                                            | 用户                 |
| **Skill**               | Team 内可复用的能力标签，包含稳定 skill id、名称和可选描述；Member 可拥有多个，匹配不比较自然语言相似度 | 用户                 |
| **Execution profile**   | Member 的 provider、model、mode、thinking 等运行配置；Level 不自动推断 model                            | 用户                 |
| **Mission**             | Team 执行的一次顶层任务，拥有目标、约束、验收标准、计划、聊天室和终态                                   | 用户启动，系统持久化 |
| **Mission participant** | 一个 Mission 中 `memberId → agentId` 的运行时绑定；Agent session 可以在 Mission 结束后归档              | 系统                 |
| **Workstream**          | Mission 内动态生成的所有权边界，描述交付物、所需技能、最低 Level、依赖和可写范围                        | Lead 提议，系统校验  |
| **Assignment Contract** | Workstream 内一次可执行工作的结构化契约，不再只是自由文本 prompt                                        | Lead 创建，系统执行  |

`Lead` 是 Team 对一个 Member 的指定关系 `leadMemberId`，不是保留 Role 名。Lead 自己也有 Role、Level、Skills 和 Execution profile。相同 Role 可以有多个 Member；UI 和寻址使用稳定 Member 身份及 mention handle 区分它们。

Level 的排序语义固定，显示名称可本地化或由产品文案调整：

| Level | 可承担范围                   |
| ----- | ---------------------------- |
| 1     | 按明确步骤执行范围很小的工作 |
| 2     | 独立完成边界清楚的任务       |
| 3     | 拥有一个子系统并处理局部歧义 |
| 4     | 处理跨边界设计、集成与评审   |
| 5     | 处理团队架构、复杂权衡与协调 |

Member 不创建或编辑 `responsibility`；“这次由谁负责什么”只由 Mission 的 Workstream ownership 表达。

### Mission 与 Assignment Contract

Mission 状态为 `planning → active ↔ needs_attention → verifying → completed | failed | canceled`；任何非终态都可经显式取消进入 `canceled`。`failed` 只由带 durable `failing` intent 的不可恢复系统故障进入，例如聚合损坏无法修复，或 Lead 首次 provision 在尚无 accepted turn/副作用时永久失败；普通 provider 不可用、Assignment 失败、缺报告和审计冲突都进入可恢复的 `needs_attention`。每个 Team 最多一个非终态 Mission；Team 可以在没有 Mission 时保持 active。

Workstream 至少持久化：`workstreamId`、kind（delivery/integration/verification）、目标、交付物、验收条件、required/preferred skill ids、required runtime capability ids、minimum Level、`reviewPolicy`、reviewer requirements、依赖 Workstream ids、mutable scopes、owner/reviewer member id、匹配解释和状态。required skills 与 runtime capabilities 是全量硬约束；preferred skills 只参与排序。`reviewPolicy: required` 会产生真实 review Assignment；最终 verification 永远产生真实 verification Assignment。可修改 workspace 的 Workstream 必须声明 mutable scopes；只读工作显式标记 `readOnly`。

mutable scope 使用规范化的 workspace 相对路径前缀，不接受语义模糊的自然语言或任意 glob；两个前缀相等或互为祖先时视为冲突。无法提前确定范围的写任务使用 workspace-global scope，因此不会和其他写任务并行。

Assignment Contract 至少持久化：

| 字段组 | 内容                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份   | `assignmentId`、`missionId`、`workstreamId`、kind（delivery/review/verification）、subject assignment ids、assignee member id、运行时 agent id |
| 工作   | objective、输入引用、deliverables、acceptance criteria、mutable scopes、workspace baseline                                                     |
| 顺序   | dependency assignment ids、priority、plan revision、roster snapshot revision                                                                   |
| 交付   | summary、artifact paths、tests、decisions、blockers、handoffs                                                                                  |
| 运行   | dispatch state、semantic state、attempt、accepted turn id、timestamps                                                                          |

派发状态和工作语义分开：daemon 观察到 turn 结束，只能证明一次运行结束；成员通过结构化工具报告 `completed`、`blocked` 或 `failed`。报告允许在 accepted turn 尚在运行时先落盘为 `reportRecorded`，但不能提前推进；`completed` 需要结构化报告和对应 turn 的成功终态同时成立，Workstream 才能推进。turn 已结算而报告缺失时进入 `needs_report`，捕获 post-turn delta 后释放 Member slot 与 execution lease，并把相关 scope 转成持久 `report_hold`，不能被当作完成或让冲突工作穿过。

Mission 启动时追加第一份 roster snapshot。Role、Level、Skills 或 Execution profile 的后续修改不改写既有 snapshot 或 Assignment Contract；Lead 通过带 `adoptTeamRevision` 的显式 replan 才能为未派发的新工作追加一份 snapshot。Plan 和 Assignment 都引用具体 snapshot revision。仍有开放 Assignment 或 active participant 的 Member 不能直接移除，必须先取消/转移工作并完成 replan。

### 协同算法

1. **启动**：先原子写入 Mission，再只启动 Lead participant。Lead 通过工具读取 Mission 和 roster，不从启动 prompt 猜测成员、技能或历史。
2. **规划**：Lead 提交完整 Workstream 计划及能力要求。daemon 校验成员存在、依赖无环、交付与验收非空、写范围无非法并发；计划以 revision 做 compare-and-swap，已派发契约不可被静默改写。
3. **匹配**：daemon 使用确定性的词典序规则选择 owner：Mission snapshot 中的 provider/runtime capability 满足且覆盖全部 required skills → preferred skills 覆盖更多 → Level 足够且优先最小充分等级 → 延续同一 Workstream owner → 当前负载更低 → roster 顺序稳定决胜。Reviewer 单独经过同一硬能力链和 review skills/Level 过滤；有合格替代者时必须与可写 owner 不同。Lead 可覆盖推荐，但必须持久化理由；缺硬能力时不能 override。
4. **执行**：仅为计划选中的 Member 创建 participant。计划层拒绝没有 dependency 或显式 handoff 的重叠 mutable scopes；运行层通过 workspace 级持久 scope registry 防止不同 Team/Mission 或 crash/replan 让冲突工作并发。每个 Member 同时一个 active Assignment，互不相交的 scope 并行。`reviewPolicy: required` 在 delivery 双事实完成后派发独立只读 review Assignment；`changes_requested` 回到 Lead replan，不允许 reviewer 在同一 review Assignment 中顺手修改。状态变化以 durable event 驱动，周期 sweep 只负责丢事件恢复，不 busy-wait。
5. **收敛**：结构化交付自动注入下游 Assignment，只传 artifact、decision 和 handoff 引用，不复制整段聊天。只有 provider 尚未接受、没有产生 turn 的派发可自动重试；已接受 turn 的失败、unknown 或 blocked 一律交回 Lead 重规划，不能盲目重放副作用。质量门就是依赖全部交付路径的 final verification Assignment 双事实成功、workspace ownership audit 无未解决项且无开放 blocker；满足后才完成 Mission 并归档 participant sessions。

这套算法不把语义规划硬编码进 daemon：模型仍负责理解任务和提出 Workstream；daemon 负责匹配、约束校验、状态机、依赖、并发、投递、恢复和完成门。Prompt 只负责唤醒模型并说明下一动作，不是团队事实或协作协议的权威来源。

Provider/runtime capability 的事实源是 Paseo provider registry 与 adapter manifest，不是 Role/Skill 文本或一次 live auth 探测。Mission start/replan 把 provider、model、mode、tool support 和 capability ids 冻结进 roster snapshot；matcher 只读该 snapshot，dispatch adapter 再验证当前 provider/model 是否仍存在。认证失败由 provider 正常返回并转入上述故障状态，不在领域测试中添加 auth 检查。

### Shared workspace 的 ownership 执行

Paseo 不能在共享 workspace 中从最终文件内容可靠推断“哪个进程写了它”。v2 因此不宣称文件系统级隔离，而是把可自动判定的边界持久化，把无法归属的变化阻塞在验收前：

1. `mission_plan` 拒绝同一 Mission 内两个可同时 ready 的重叠 scope；只有 dependency 或显式 handoff 能把它们串行化。运行时 lease key 是“canonical workspace identity + normalized path prefix”，由 workspace 级 registry 统一管理，跨 Team/Mission 也不能重叠；冲突项按 priority、createdAt、assignmentId 稳定排队。
2. 写 Assignment 取得 lease 后、dispatch 前才保存 baseline，避免把前一个合法 owner 的结果误算到当前工作。审计集合只包含 git-tracked path、非 ignored untracked path和显式声明的 artifact/deliverable；`.git`、`PASEO_HOME`/daemon runtime path、gitignored cache/build output 默认排除，除非它被显式声明为交付物。verification 跑 build/test 产生的普通 ignored output 不构成违规。
3. workspace registry 持久化历史 ownership interval。changed path 必须在其出现期间落入唯一一个已生效 scope，并由对应 report 或 handoff 声明；另一个 Team/Mission 的唯一合法 owner 变化记录为 external-owned，不污染当前 Mission。无 owner、多个 owner、越界或未声明变化创建 durable attention item，进入 `needs_attention`。
4. accepted turn 结算后先捕获 delta，再释放 execution lease；缺 report 时 scope 原子转为 `report_hold`。Daemon 只在 assignee idle 时用 recipient outbox 非抢占索要报告，最多两个 recovery turn，绝不重放原工作；仍缺报告、participant/provider 不可用或报告不合法时停止相关下游与冲突 scope，其他不相交工作可继续。
5. `needs_report` 的出口固定为：原 assignee 补交合法报告；或 Lead 带 expected revision 将原项终止为 `failed(missing_report)`，创建引用 captured delta 的 recovery Assignment 并原子接管 `report_hold`；或用户取消 Mission。审计 attention item 只能由用户在 UI/RPC 中选择“归入指定 owner + 补 handoff”“标记为外部变化且排除于 Mission 交付”或“取消 Mission”，每次保存 path/fingerprint/理由/actor；全部解决后恢复先前 Mission 状态与可派发项。
6. 共享 workspace 无法证明实际 writer；真实 provider QA 结合 tool timeline、workspace ownership interval 与 diff 检查成员越界。若产品需要强制 writer isolation，再引入 per-member worktree，不在 v2 首版伪造这个保证。

### Agent 工具面

| Tool                  | 权限与职责                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `team_status`         | 所有 participant；查询 Team、Member profiles、运行状态与负载                                            |
| `mission_status`      | 所有 participant；查询当前 plan revision、Workstreams、Assignments、blockers 和依赖                     |
| `mission_plan`        | Lead；原子提交或修订 Workstream 计划，由 daemon 校验和匹配                                              |
| `assign_task`         | Lead；仅接受带 expected plan revision 的结构化 Assignment Contract batch；v1 scalar 形态不在 v2 catalog |
| `assignment_report`   | assignee；提交进度、完成、失败、阻塞、artifact 和 handoff                                               |
| `team_message`        | 所有 participant；向一个已 provision 的 Member 发可见于 Mission room 的持久定向消息                     |
| `team_member_history` | 所有 participant；读取当前 participant 的整理历史，权限每次调用重新校验                                 |

聊天室只承载人和 Agent 可读的交流；Mission、计划、Assignment 和报告才是协作事实。重要 room 消息可由用户或 Agent 显式提升为 decision/handoff，但不能仅凭聊天文本改变 Mission 状态。

v2 participant 的 tool catalog 不暴露阻塞式 `chat_wait`；`chat_read` 是立即返回的 cursor read。定向消息先写 room，再写 recipient attention outbox（pending → notified → acknowledged/canceled）：busy participant 在 turn settle 后非抢占唤醒，`chat_read` 推进 recipient cursor 并确认；deterministic delivery id 负责去重和 crash replay。`notified` 未确认时只在 eligibility 变化或低频 backoff 到期后重试，连续三次未确认就创建 attention item，消息与 outbox 仍保留而不 busy-wait；用户恢复通知后继续。`canceled` 只允许 Mission 终态、recipient 离队或显式用户取消并保存原因；binding epoch 更换时旧 delivery 取消并为同一 room message 创建确定性 successor。目标 Member 尚未 provision、已离开当前 Mission 或 Mission 已终态时明确拒绝，发消息不能偷偷创建 participant。

### 模块边界与 upstream 同步

v2 先做**逻辑 feature capsule**，不立即增加新的 npm workspace package。当前只有 Paseo daemon 一个宿主，提前抽包会增加 workspace、构建、Metro 和协议依赖面，文件位置并不能代替受控的 import direction。

| 层                                      | 目标边界                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/protocol/src/team/`           | 只放追加式 wire schema、快照和能力门控；新 RPC 使用 dotted namespace                             |
| `server/team/domain/`                   | 纯领域类型、状态转换、计划校验和成员匹配；不得 import AgentManager、chat、WebSocket 或文件系统   |
| `server/team/application/`              | Mission service、scheduler、outbox 和 reconciliation；只依赖 feature-owned contracts             |
| `server/team/adapters/paseo/`           | 唯一允许接触 AgentManager、AgentStorage、tool catalog、workspace 和 session event 的位置         |
| `server/team/team-runtime.ts`           | daemon 侧唯一公开 façade；负责安装、启动、停止、注册工具和暴露 RPC handler                       |
| `app/src/teams/` 与 `components/teams/` | feature-owned state、forms 和 UI；共享 workspace UI 只保留入口、tab target 和 panel registration |

核心代码不得 import Team 内部文件，只能依赖 façade 或协议快照；Team domain/application 不得反向依赖 Paseo 核心实现。用一个依赖边界测试扫描非法 import。现有 `server/team/` 实验代码可在 feature capsule 内直接替换，不保留双栈或 adapter；通用 chat/agent 修复继续复用。每个实现提交把“feature 内新增/修改”和“核心接入小补丁”分开，降低每日 rebase 的冲突面。出现第二个真实宿主或独立发布需求后，再把 domain/application 提取为 workspace package。

### 首发与能力门

1. `teamMissions` 是唯一能力门；App 在一个入口判断，声明该 capability 的 socket 才接收 Team/Mission snapshot。
2. 新 App 遇到未声明 capability 的 daemon 时要求升级 host，不用旧 RPC 拼装降级路径。
3. Team profile 是唯一 roster authority；所有新 Member 必须一次提供 Role、Level、至少一个 Skill 与 execution profile。
4. 创建 Team 只写 roster；启动 Mission 才创建 room、Lead participant 和后续选中的 participants。Mission 结束归档 participant sessions，不归档 Team。
5. 开发期实验数据不迁移。测试使用独立 `PASEO_HOME`，本地验证需要时直接清理旧 Team 数据。

### Replan、成员与故障状态机

当前 Mission 的授权来自它已采用的 roster snapshot，不直接跟随 Team profile。所有故障先落 durable state，再触发通知；不能靠下一段 prompt 修复。

| 事件                                 | 状态与允许动作                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team Member add/edit                 | profile revision 增加，只影响未来 Mission。当前 Lead 可在没有受影响 active Assignment 时用 `adoptTeamRevision` replan，向 Mission 追加 snapshot；旧 Assignment 继续引用旧 snapshot。                                                                                                                                  |
| Team Member remove / lead change     | handle 形成永久 tombstone，永不复用。当前 Mission 涉及时，普通 profile mutation 拒绝；必须用原子“cancel/transfer open work → archive participant → append adopted snapshot → profile tombstone/新 lead”操作。旧 Assignment 仍引用旧 snapshot。                                                                        |
| Lead participant archive/hard-delete | Mission 进入 `needs_attention`，停止新 dispatch，保留 assignments、leases 和 outbox。用户显式选择 snapshot 内替代 Lead 并 replan，或 cancel Mission；daemon 不自动猜替代者。                                                                                                                                          |
| Assignee archive/hard-delete         | queued 工作取消并交回 Lead；accepted Assignment 进入 `needs_attention`，不自动重放。hard-delete 的 turn 记 unknown/failed reason 后才释放 lease；新 participant 只接新 Assignment。                                                                                                                                   |
| Reviewer archive/hard-delete         | 未 dispatch 的 review 可按同一 snapshot 重新匹配并生成新 id；accepted review 不自动重放，捕获证据后进入 `needs_attention`，由 Lead replan 或用户取消。final verification reviewer 同样处理。                                                                                                                          |
| Provider unavailable/dispatch reject | 规划能力来自冻结的 provider capability snapshot，dispatch 前由 adapter 重新校验。尚未 accepted 的瞬时失败按确定性 backoff 有限重试；未认证、二进制/模型缺失或重试耗尽转 `blocked(provider_unavailable)` 与 `needs_attention`，不自动降级 model。Lead 可 replan 给其他合格 Member，或用户修复 provider 后显式 resume。 |
| accepted turn 缺 report              | turn 结算后捕获 delta，execution lease 转 `report_hold`；最多两个非抢占 recovery turn 索要报告。仍缺失时进入 `needs_attention`，Lead 只能接受补交报告、以 recovery Assignment 原子接管 hold，或取消 Mission。原工作绝不重放。                                                                                         |
| Ownership audit attention            | 用户按保存的 path/fingerprint 逐项决定归属、外部排除或取消；Lead 不能单独豁免越界。所有决议落审计，解决后恢复进入 attention 前的状态，并仅释放已解决的 hold/dispatch gate。                                                                                                                                           |
| participant rebind                   | 同一 memberId 可在没有 accepted active Assignment 时显式创建新 binding epoch；旧 agentId 与既有 Assignment 不改写。accepted Assignment 永不换绑。                                                                                                                                                                     |
| blocked/failed replan                | 必须带 expected plan revision。只能修改未 dispatch 的工作；旧项以 `canceled + supersededBy` 终止并创建新 id。dispatched/settled identity、scope、report 和 snapshot revision 不可改。                                                                                                                                 |
| Mission cancel                       | 先写 `canceling` intent，停止新 dispatch，再中断 active turns、取消 open work、保留 workspace diff/report，归档 participants，最后置 `canceled`。重复执行幂等。                                                                                                                                                       |
| Team archive / participant unarchive | active Mission 先走 cancel，再归档 Team。终态 Mission 的 agent 被外部 unarchive 时清 Team/Mission labels 并 evict；active Mission 仅在 binding epoch 仍当前且未替换时恢复 availability，否则同样 evict。                                                                                                              |
| Fatal Mission failure                | reconciliation 先写 `failing` intent，停止 dispatch，捕获 accepted turn/diff，归档 participants，再置 `failed`；重复执行幂等。Assignment/provider/报告/审计类问题不能走此捷径。                                                                                                                                       |

### 协同验收场景

| 场景                 | 必须证明                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| 同 Role、不同 Level  | 高风险架构工作选择高 Level；边界清楚的实现优先最小充分 Level，避免浪费最强模型                        |
| API + UI + 测试      | 三个不相交 ownership 可并行；集成测试等待 API/UI artifact 后再派发                                    |
| 共享 workspace 冲突  | 重叠 mutable scopes 不并行，明确 handoff 后才能转移 ownership                                         |
| blocked 与失败       | 无无限重试、无 busy-wait；仅未接受派发可重试，其他失败稳定回到 Lead，revision 冲突不覆盖新计划        |
| 缺报告与审计冲突     | `needs_report` 有限索要后进入明确恢复动作；ignored build output 不误报，真实越界必须由用户留痕解决    |
| 多 Team 同 workspace | workspace 级 lease 阻止跨 Mission 重叠，合法不相交 owner 的变化不会互相污染                           |
| daemon crash/restart | Mission、plan revision、Assignment identity、participant binding 和未投递报告全部恢复且不重复创建工作 |

除确定性测试外，真实 provider 协同继续使用 `docs/testing.md` 的评分门：至少两种任务形状连续三次达到 8/10、无零分且 delivery 为 2；记录计划时间、并行度、成员空闲率、重做、scope 冲突、tool calls 和 token 开销。

### 首发验收补充契约

以下两项与上面的 v2 方向一起冻结：

- **Mission 冻结可解释快照**：Mission 不只保存 `rosterRevision`，还冻结启动时的 Member、Skill 与 execution profile 快照；显式 replan 采用新 Team revision 时追加 snapshot，不覆盖旧版本。历史 Assignment 的匹配理由、provider 配置和 mention 身份始终可重建。
- **最终验收进入 DAG**：Workstream 显式区分 delivery、integration 与 verification。每个 Mission 计划必须有一个依赖全部交付路径的 verification Workstream；存在满足硬要求的其他 Member 时，其 owner 必须不同于所有可写 delivery owner，否则保存 override reason。它的结构化报告与成功 turn 同时落盘后，Mission 才能从 `verifying` 进入 `completed`。

## Agent Teams v2 执行拆解

按下列顺序连续执行。每个子项都是独立里程碑：先写失败测试，再实现，再跑定向测试、全仓 typecheck、lint、format，最后做 fresh change review。不得用后一项的代码补前一项的验收缺口。

### BASE-0 · 封板实验实现修复基线

**依赖**：无。**范围**：当前 worktree 中除 v2 领域文件和本规划外的已完成实验实现改动。

- 固化 Tab 右侧 `+` 创建 Team、成员 Agent 不自动开 Tab、可读 mention、“我”的作者显示、composer 设置入口、成员列表与编辑、Team tools、任务可见性和真实 provider 修复。
- 先关闭 BASE-0 review 的两个遗留：mention handle 改为持久化 append-only 分配，招募新 Role 不得重编号既有成员或改变历史 @ 寻址；scroll retention 状态机抽成纯 TypeScript controller + typed fake，删除 JSDOM/React hook mounting/`vi.fn` 违规测试，保留真实 Playwright 证据。
- 把精选截图、三轮真实协同记分卡和原始运行信息移入 `.codestable/audits/`；临时 `dogfood-output/` 不作为唯一证据源。
- 重跑受影响的定向测试、typecheck、lint 和 format，进行一次覆盖整个未提交 diff 的 fresh review；通过后形成单独 milestone commit。
- 验收：追加成员前后逐个比较既有 handle 保持不变，历史 mention 仍解析原 Member；定向测试不违反 `docs/testing.md`；实验实现可独立回滚、复测和对比，v2 后续失败时不会污染这条已知可工作的基线。该里程碑不形成兼容或迁移契约。

### V2-ITEM-1 · 冻结领域内核

**依赖**：BASE-0。**范围**：`packages/protocol/src/team/v2-types.ts` 与 `server/team/domain/`。

- 保留已实现的 Team、Mission、Workstream、Assignment、成员匹配、路径冲突、DAG 和双事实完成校验；Member 的 Role、Level、Skills 与 execution profile 在创建时全部必填，并补上 versioned Mission roster snapshots、Workstream/Assignment kind、`needs_attention`、`report_hold` 和可审计 workspace baseline policy。
- 固化 required/preferred skills、runtime capabilities、owner/reviewer 独立匹配与解释、规范化路径、plan/assignment revision、binding epoch、workspace scope lease，以及 final verification Workstream 的跨聚合不变式。Mention handle 按 canonical lowercase token 校验语法与唯一性。
- Assignment 允许 running + reportRecorded 合法中间态，任何 dispatched/settled 状态必须有 runtimeAgentId；TeamMission 聚合拒绝重复 participant/assignment id、错误 mission/workstream 引用、未知依赖和 assignment cycle。
- 领域层保持纯函数，不 import AgentManager、WebSocket、文件系统或时钟；时间和 id 都由调用方注入。
- 验收：全部领域不变式和上述 contract review finding 都有反例测试；快照、review、verification 与 report recovery 用例通过，fresh review 无 blocker。

### V2-ITEM-2 · 协议、能力门与 Client SDK

**依赖**：V2-ITEM-1。**范围**：protocol/client，不接 server 业务。

- 新增单一 `server_info.features.teamMissions` 能力门和对应 per-socket client capability；v2 UI 只在这一处判定，不把若干子能力拼成推断。
- 新增 `team.profile.*` 的 create/list/inspect/update/archive 与 `team.mission.*` 的 start/list/inspect/cancel/attention-resolve 请求/响应，以及 profile/mission authoritative snapshot 广播；共 10 组 RPC，全部使用 dotted namespace 和 correlated request id。
- 请求使用 idempotency key 或 expected revision；wire schema 不 transform/catch/preprocess，不收窄既有消息。Team/Mission 新消息只发送给声明 `teamMissions` 的 socket。
- 验收：new client 遇到未声明 capability 的 daemon 不发送 Team/Mission mutation；混合 socket 中只有声明 capability 的连接收到 authoritative snapshot；生成 inbound validator、client build 和定向测试通过。

### V2-ITEM-3 · 持久化与恢复

**依赖**：V2-ITEM-2。**范围**：feature-owned TeamProfileStore、MissionStore 与 startup reconciliation。

- Team profile 与 Mission 分文件存储；Team 记录 activeMissionId 和持久化 start intent，Mission 保存 versioned roster snapshots、participants、plan、assignments、workspace ownership intervals、scope leases/report holds、workspace baselines、reports、attention items、recipient attention outbox 与 completion outbox。
- start/finish 使用预分配 id、per-team 串行、revision CAS 和可重放阶段记录；任何崩溃点都只能暂时阻塞，不能创建第二个 active Mission 或重复 participant。
- v2 是首个公开存储格式，不读取、迁移或标记实验实现文件。损坏的 Team/Mission 单文件必须隔离，其他资源继续加载；reconciliation 只收敛 v2 自身未完成的 start/finish intent 与 outbox。
- 验收：全新安装、重复启动、部分写入、原子 rename 前后、损坏单文件、并发 start，以及每个 v2 start/finish crash window 都有定向测试；不存在 migration marker、backup 或旧格式分支。

### V2-ITEM-4 · Feature capsule 与 Team/Mission 生命周期

**依赖**：V2-ITEM-3。**范围**：`server/team/application/`、`server/team/adapters/paseo/` 与 `team-runtime.ts` façade。

- application 只依赖 Team-owned ports；AgentManager、AgentStorage、workspace、provider registry、tool catalog 和 session events 只能从 Paseo adapter 进入。Mission room 由 Team persistence 拥有，不保留 legacy adapter、双写或旧 RPC/tool/broadcast 分支。
- 创建 Team 只持久化 profile，不创建 room、Agent session 或 assignment；启动 Mission 先落盘，再创建 room 和 Lead participant，其他 participant 按被选中工作懒创建。
- Mission 完成/失败/取消时归档 participant sessions，保留 Team profile、Mission history 和 room；关闭 Team/Agent Tab 仍只是布局动作。
- 增加显式 `TeamMissionsRuntimeOptions`：隔离 test/dev daemon 可开启 v2 runtime/capability，production bootstrap 在 ITEM-9 前固定关闭；能力广告必须由 runtime ready 决定，不能只看文件或静态常量。
- 验收：依赖边界测试拒绝非法 import；核心只保留 runtime install、RPC 转发、feature 声明等薄接线；ProviderCapabilityResolver 使用 registry/manifest 的 typed fake，不做 auth mock；生命周期真组件测试覆盖 stored-only agent、重启和 test-only capability 开关。

### V2-ITEM-5 · Agent 协同工具面

**依赖**：V2-ITEM-4。**范围**：结构化查询、命令、权限和最小唤醒 prompt。

- `team_status` 返回 Team/Member profile、当前 participant 和负载；`mission_status` 返回 plan revision、DAG、Assignment、blocker、report、artifact 和依赖。
- Lead 用 `mission_plan` 原子提交完整 Workstream 计划，用支持 batch 的结构化 `assign_task` 按 plan revision 创建 Assignment Contract；Team/Mission catalog 不注册 `{assigneeAgentId, prompt}` scalar 形态，schema 层直接拒绝。assignee/reviewer 用 `assignment_report` 报 completed/blocked/failed 或 accepted/changes_requested。
- `team_message` 按 memberId/handle 定向并写 room + recipient attention outbox；`team_member_history` 按 memberId 和 missionId 解析历史 participant，每次调用重新校验成员与 Mission 权限。v2 catalog 移除阻塞式 `chat_wait`。
- 验收：错误身份、旧 plan revision、越权 member、额外 mention、未 provision/非 participant、终态 Mission、v2 scalar assign 全部拒绝；busy 后投递、cursor ack、三次未确认 attention、binding successor、cancel reason、去重和 crash replay 可测。把 prompt 缩到“身份 + missionId + 下一工具动作”后，所有团队事实仍可由工具恢复。

### V2-ITEM-6 · DAG 调度、恢复与收敛

**依赖**：V2-ITEM-5。**范围**：scheduler、outbox、reconciler 和 participant provisioning。

- `mission_plan` 先确定 Workstream owner/reviewer 并保存 match explanation，`assign_task` 一次持久化一批独立工作；调度只释放依赖已满足、Member 空闲且能原子取得 workspace 级 scope lease 的 Assignment。required review 在 delivery 完成后物化独立 review Assignment，final verification 依赖所有交付/review 路径。
- 同一 Member 同时最多一个 active Assignment；不同 Member 的不相交 scope 并行，跨 Team/Mission 的重叠 scope 也由 workspace registry 串行；participant 创建和 dispatch 都以确定性 identity 幂等。baseline 在 lease 后、dispatch 前捕获，并按 audit policy 排除非交付 ignored/runtime output。
- 只有 provider 未接受且未产生 turn 的派发可自动重试；accepted turn 的 unknown/failed/blocked 回到 Lead replan。报告可先于 turn 终态落盘；turn settle 缺报告时转 `report_hold`、最多两个 recovery turn，随后进入有明确出口的 `needs_attention`，原工作永不重放。
- 验收：事件驱动为主、低频 sweep 只补丢事件；seeded 状态机测试随机排列 dispatch/report/turn/crash/restart/replan/provider failure/reviewer loss，始终满足无越依赖、无并发 lease、无重复副作用和最终可收敛。覆盖两个 Team 同 workspace、ignored build output、路径越界、无归属/人类并发编辑的用户 resolve、缺报告三种出口和 Mission fatal failure。

### V2-ITEM-7 · App 状态、副本与表单模型

**依赖**：V2-ITEM-6。**范围**：`app/src/teams/`、host runtime replica、route/tab descriptor。

- 分开 Team profile form 与 Mission start form：Team 只输入 name、Role、Level、Skills、execution profile 和 lead；Mission 输入 objective、constraints、acceptance criteria。
- provider/model/mode/thinking 仍通过非 React form model 管理，late data 作为显式输入；同 Role 多 Member、skill catalog 编辑和完整 Member 画像校验都有模型测试。
- profile/mission 广播按 revision authoritative replace；断线后 list/inspect 补齐，未声明 capability 的 daemon 只显示更新 host 的受控状态，不发送 Team/Mission 请求。App E2E 的隔离 daemon 通过 ITEM-4 的显式 runtime option 广告能力；production 仍关闭。
- 验收：创建成功只导航到 Team tab，不自动打开任何 participant/member Agent tab；用户显式打开的 Team/Agent tab 可关闭且不改变 Team/Mission 生命周期。

### V2-ITEM-8 · Team 聊天与设置 UI

**依赖**：V2-ITEM-7。**范围**：`components/teams/` 与 workspace 的薄入口。

- Team 主面板只承载当前/选定 Mission 的消息时间线和 composer；移除顶部 roster 与独立 Tasks tab。无 Mission 时在同一工作面提供 Mission start 控件。
- composer 左侧设置图标打开自下而上的 AdaptiveModalSheet；采用五个页内层级：Team、Members、Mission、Plan & Assignments、Attention & Lifecycle，不在聊天页复制这些信息。
- Members 页编辑 Role/Level/Skills/execution profile；Mission 页管理目标、验收与历史；Plan 页显示动态 ownership、依赖、scope、报告与 artifact；Attention 汇总权限、blocker、review/replan 与归档动作。
- 所有新增文案同步英语与现有 8 个非英语 locale，插值键一致；Team/Mission/Workstream/Assignment/Attention 术语按 glossary，不在组件里硬编码。
- 验收：Tab `+` 可建 Team、同 Role 可区分、mention 输入/历史只显示 handle 与身份名而非 UUID、人类作者显示“我”；i18n key parity、75% 翻译率与插值测试通过；desktop 与 compact Playwright 通过 ITEM-4 test runtime 覆盖创建、空 Team、规划中、并行执行、blocked、完成和设置编辑截图。

### V2-ITEM-9 · CLI、运行时启用与确定性 E2E

**依赖**：V2-ITEM-8。**范围**：CLI surface、daemon E2E、capability 漂移和恢复矩阵。

- CLI 支持 profile create/list/inspect/update/archive，以及 mission start/list/inspect/cancel；Role/Level/Skills/provider/model 可重复声明并有机器可读输出。
- 新 app/CLI 对缺少 `teamMissions` 的 daemon 明确要求升级，不尝试把 Team/Mission 请求降级成实验实现的 RPC 或 task。
- runtime 安装并完成 v2 startup reconciliation 后才对 production socket 广告 `teamMissions`。隔离真实 daemon E2E 覆盖“创建无 session → Mission 只启 Lead → plan/match → lazy participants → 并行/DAG → report/verify → 归档 participants”，以及每个持久化 crash window。
- 验收：逐项覆盖混合 socket capability、重连 gap、CAS 冲突、重复请求、Lead/assignee/reviewer hard-delete、provider unavailable、participant unarchive/rebind、replan、Mission cancel 和 Team archive；全部只走 v2 外部接口。production 只在 runtime ready 且 v2 reconciliation 完成后广告 `teamMissions`。

### V2-ITEM-10 · 真实协同、QA、文档与最终验收

**依赖**：V2-ITEM-9。**范围**：真实 provider 证据、平台矩阵、canonical docs 和最终 review。

- 用两个固定开发任务形状验收：一组 API/UI/测试可并行，一组 contract→implementation→verification 显式依赖；每种连续 3 次达到 8/10、五维无零分且 Delivery=2。五维统一改为 v2 口径：Workstream fit（硬能力与最小充分匹配）、Coordination（DAG/并行/handoff）、Tool discipline（权威状态只走结构化工具且无阻塞等待）、Delivery（验收/报告/artifact/verification/ownership audit）、Runtime reliability（crash/replan/outbox 收敛且无丢失、死锁或 accepted-turn replay）；每维在 `docs/testing.md` 写出 0/1/2 精确判据，不再引用 responsibility。
- 硬指标为真实 scope violation=0（按 audit policy 排除 ignored/runtime output）、accepted-turn 自动重放=0、重复副作用=0、busy-wait=0、终局 unresolved report/attention=0；并行场景独立任务必须真实重叠，依赖场景不得提前派发。记录 plan latency、eligible idle、tool calls、tokens、rework、report recovery 和 conflict。
- 按 `docs/qa.md` 留存 desktop/compact 关键截图与 iOS/Android/Web/Desktop 六行矩阵；更新 architecture、data-model、agent-lifecycle、testing、glossary 和协议文档，删除实验实现中已经失效的职责描述。
- 验收：fresh final review 无 blocker，owner 对照原始证据验收；clean milestone 上同步 upstream、重跑受影响验证，再按既定 `remote_publish: final` 一次发布。

## v2 横切执行约束

1. **Prompt 非权威**：测试必须证明删改协同说明不会改变授权、调度、恢复和完成；prompt 只包含唤醒原因和下一动作。
2. **同步边界**：每个 milestone 只在 clean worktree 上同步 upstream；Team 逻辑不搬入热核心文件，核心改动只加 façade 调用或协议分发。新增通用修复优先单独上游化。
3. **验证边界**：本地只跑改动相关单文件/场景，禁止全量 suite；每项都跑全仓 typecheck、lint、format，广域验证交 CI。
4. **证据边界**：测试命令、原始输出、provider/model、事件时间线、workspace diff 和截图进入 `.codestable/audits/`；汇总报告不能替代原始证据。
5. **版本边界**：沿用 `continuous / authorized / final`；每项一个可回滚 milestone commit，最终验收前不 remote publish。
6. **能力开关边界**：ITEM-4–8 的 v2 E2E 只能通过隔离 daemon 的显式 option 开启；测试不得修改 production default。ITEM-9 同一测试证明 runtime 未 ready 或 v2 reconciliation 未完成时不广告，完成后按 socket 广告。

以下「目标」至「遗留风险」只保留 BASE-0 实验实现的设计和验收历史，不是公开契约，也不得产生 v2 的迁移、兼容、双写、legacy adapter 或 UI 分支要求。v2 可以复用其中已验证的持久化投递、无抢占和 crash recovery 技术，但以 Mission plan、结构化 Assignment 和最小 DAG scheduler 替换纯 prompt 编排。

## 目标

- 新建面板一键创建 team：lead + 若干成员，跨 provider 混编。
- 协作过程对人可见：team room 为中心，人可随时插话。
- 聚合视图：成员状态、待处理权限请求集中呈现。
- 生命周期可恢复：daemon 在创建/归档中途崩溃后由对账器收敛，不遗留孤儿资源。

## 范围

设计文档 §11 的 7 个 PR 对应本 Epic 的 7 个子项：protocol/client schema、server 基础改造（记录变更事件流、per-turn 终态事实、指定 id 幂等创建、team-store）、chat 改造（作者模型、订阅、所有权与幂等创建、分文件存储与存量迁移）、TeamService（创建事务、task ledger + inbox、归档、工具、简报）、CLI 与 daemon E2E、app 运行时与表单、app 面板与 Playwright E2E。

## v1 非目标

- v1 不含服务端 workflow/DAG 编排引擎；派发智能在 lead agent。v2 改为受 Mission 约束的最小 DAG scheduler，不建设通用 workflow 平台。
- 多层 team 嵌套；成员间强一致任务状态机。
- 唤醒与简报投递的"恰好一次"保证（端到端 at-least-once，最终确认前重复无上限，见 DEC-3）。
- assignment 抢占：派发永不打断 assignee 正在进行的 turn（DEC-3）。
- per-member worktree 合并辅助、team 级 unarchive、无 lead 的 room 常驻模式、per-member inbox（Phase 3 另立）。

## 验收标准

1. 全部子项按设计文档对应章节实现，`npm run typecheck`、`npm run lint` 通过，每个子项的新增测试按 `docs/testing.md` 单文件跑绿，全量验证以 CI 为准；每个子项的证据包含测试命令与原始输出。
2. 设计文档 §10 测试计划的场景**逐条绑定**在下方子项验收要点中，全部有自动化覆盖。
3. 端到端三层证据：① 确定性 daemon 级 E2E（两个不同 provider adapter，覆盖创建 → lead 派发 → 成员完成 → room 汇报含 human actor 插话与 @mention → 多成员 permission 请求与 allow/deny RPC → archive 收敛，ITEM-5）；② App 级 Playwright + 隔离 daemon E2E（team 面板权限聚合两条目独立 allow/deny、关键动作三态，ITEM-7）；③ 按 `docs/qa.md` 至少一次真实 provider 手工 smoke 证据，采用**既有六行 App 平台矩阵**（iOS、Android、Web、Desktop macOS/Windows/Linux）+ 桌面/compact 两档；daemon 侧（存储、迁移 rename）说明 macOS/Linux 覆盖与 Windows/Docker 的覆盖或不适用理由。
4. 协议兼容：老 app + 新 daemon、新 app + 老 daemon 双向不破（feature/caps 按 socket 门控生效）；所有兼容点带**含版本与移除条件**的完整 `COMPAT(...)` 标签；旧协议 fixture 解析测试通过（含 `StoredAgentRecord.turnOutcomes` 的 legacy 解析）。
5. 文档同步：每份正式 doc 的更新归属于具体子项（见子项契约括号内 docs 清单）；设计文档并入正式 docs 并删除的动作在 final acceptance 阶段执行并回写本 Epic。

## 共享语言与概念边界

Team / Lead / Member / Roster / Team room / Remove（退队）的定义以设计文档 §2 为准，落地时同步进 `docs/glossary.md`。关键边界：roster 是成员关系唯一事实源，labels 只是索引；parent label 只表达委派树，与 team 归属无关；**成员数上限只计 roster 中 `state: "active"` 的非 lead 条目（≤ 8，lead 不计入）**；**可唤醒** = 未 archived 且非 running（live 状态优先、storage 兜底，`closed` 可唤醒）。

## 关键决策

- **DEC-1 · Team 是聚合根而非编排引擎**：daemon 只负责创建事务、roster 账本、inbox 投递与生命周期；任务编排智能在 lead。证据：设计文档核心立场及 §13。
- **DEC-2 · 创建事务持久化且两级幂等**：首个原子写落盘 record + roster + `requestFingerprint`（规范化请求指纹，永久保留）+ `creationPlan`（全部预分配 ID 与规范化创建意图，创建完成前不可变，对账器凭它在任意崩溃点重建）；资源级——指定 ID 创建 agent/room"同归属返回既有、冲突拒绝"；简报确定性 clientMessageId；幂等键生命周期三规则（未知结果复用 / 确定失败换新 key / 同 key 异指纹 conflict）；`failed` 由对账器清理并落 `failedCleanupAt`。（设计 §3.1/§4.1/§5.2/§5.7）
- **DEC-3 · task ledger 是持久化 outbox，端到端 at-least-once，无抢占派发**：assignment 落账即含 prompt 与确定性 clientMessageId，状态机 `queued → dispatched(acceptedTurnId) → settled(outcome)`；**派发契约**——assignee 可唤醒才派发（`replaceRunning: false`），busy 保持 `queued` 由状态变化事件触发重试，**per-assignee FIFO 且同一时刻至多一个 dispatched**，永不打断运行中 turn；**结算只因果绑定 acceptedTurnId 对应 turn 的持久化终态事实，按三态规则判定**（查到终态 → 结算；仍是持久化活跃 turn → 等待；两者皆非 → `unknown` 结算入队、lead 求证）；结算与入队一次原子写；三个崩溃窗口分别由重发、重发+去重、终态查询收敛；**泵触发 = 事件为主 + 存在未决项时低频兜底扫描**（事件丢失不重启也收敛）。**无丢失是硬保证；最终确认前重复次数无上限**，去重是 best-effort，副作用放大为已接受风险。（设计 §5.1/§5.3/§12）
- **DEC-4 · roster 进 record，labels 降为索引**。（设计 §3.1/§3.2）
- **DEC-5 · 广播按物理 socket 门控**：`supportsForSource`；chat 推送独立 `chatRoomSubscriptions` 能力。（设计 §4.4）
- **DEC-6 · parent 与 team 解耦**：team archive 显式遍历 roster，cascade 只管委派 subagent；事件派发落盘后异步、不持 per-team 锁；事件流是加速通道，正确性来自持久状态对账。（设计 §3.3/§5.1/§5.6）
- **DEC-7 · team 视图是 workspace panel target**：`/team/:id` 仅 deep-link resolver；lead tab 关闭有显式拦截规则。（设计 §6.3）
- **DEC-8 · revision + hydration 同步契约**：`revision` 持久化、原子 +1、随快照出现在全部 wire 表面，客户端按 per-team last-seen 丢弃旧值；App hydration 用 `includeArchived: false`，list 对 active 集合是 **authoritative replacement**，且 **hydration 期间的 `team_update` 按 connection epoch 缓存、list 提交后按序重放**（收敛"update 新增 list 缺席 team"的集合级竞态）；wire 快照是显式投影。（设计 §3.1/§4.2/§6.1）
- **DEC-9 · chat 存量迁移状态机**：marker 前新格式零写入 ⇒ "存在即跳过"确定性成立；顺序固定 写全部 room → rename `.bak` → 写 marker；四状态恢复表；崩溃注入点为第 k 个房间后、rename 前后、marker 前。（设计 §4.3.4）
- **DEC-10 · mention 唤醒不打断 + 可唤醒定义**：可唤醒 = 未 archived 且非 running，live 优先、storage 兜底（stored-only `closed` 可唤醒）；可唤醒才发 `replaceRunning: false` 唤醒 prompt；running 只落 room；竞态下非替换提交仍不打断。（设计 §4.3.1）
- **DEC-11 · 外部 unarchive 统一规则（正常路径 ≡ 恢复路径）**：恢复条件 = team active 且（非 lead 成员需名额未满；**lead 不占名额、active team 的 lead 恢复无容量条件**）；**其余一切情况**转 `removed`（`removalReason: "unarchive_evicted"`）并清 team labels；`archiving` team 的 unarchive 同样 evict，且对账续跑归档前**先**执行 eviction 补偿——两条路径（事件消费 / 崩溃后对账）执行同一规则、产生同一结果，等价性是显式测试；对账扫描范围含 archived/failed team；不存在"archived team 里的 active 成员"或"entry archived 但 agent 已活跃"的中间态。（设计 §5.6/§5.7）
- **DEC-12 · lead hard delete 收敛 team + 归档目标集合**：active team 的 lead 被 hard delete → 触发 team archive；**creating team 期间的 hard delete 由 deletion guard 同步拒绝**（guard 挂点归 ITEM-2；对账兜底分支保留：语义上应存在却缺失 → 转 `failed` 不重建）；`leadAgentId` 保留为历史引用；事件丢失由对账器兜底。非 lead hard delete 仅落账。**归档目标集合 = roster 中 state active 的 entry；removed/已 archived/记录缺失一律视为已完成，"视为已完成"由 TeamService 专用幂等包装层实现，不改变 user-facing `archive_agent` 的 not-found 契约。**（设计 §5.6/§5.7）
- **DEC-14 · 活跃 turn 标识收敛契约**：持久化活跃 turn 携带 daemon run 标识；启动时非本 run 的活跃 turn 视为陈旧清除（崩溃后 turn 不可能仍在运行），三态判定因此不会陷入永久等待；正常路径终态追加与活跃 turn 清除同一原子写；**TeamService 泵设启动屏障**（reconciliation 完成后才运行）。（设计 §5.1.2）
- **DEC-13 · 招募两阶段事务**：agent-scoped `create_agent` 在 team 语境下条件必填 `teamRole`（缺失/保留字拒绝）；**阶段一（per-team 锁内）**校验 team active + 调用者 active membership + 容量 → 预分配 agentId → 原子写 roster entry + **完整可重放意图**（`StoredTeam.pendingRecruitments` 顶层 server-only 表：provider/settings/title/teamRole/**initialPrompt/确定性 clientMessageId/recruiterAgentId/workspaceId/stage**）；**阶段二（每步 lifecycle fence：team 仍 active）**指定 ID 幂等创建 → stage created → 发 prompt（去重）→ 清意图；fence 失败取消（`recruitment_canceled` 落账 + 归档已建 agent）。对账优先级：active team 按 stage 重放，非 active team 一律取消补偿；重放不可行 → `recruitment_failed`。removalReason enum 相应扩展。（设计 §3.1/§5.4/§5.7）

## 子项契约

- **ITEM-1 · protocol + client schema**
  - owning skill：codestable:cs-feat
  - 交付：`packages/protocol` 的 team/chat 全部新 schema（revision 契约、显式 `TeamSnapshotSchema` 投影、`removalReason`、author 模型、订阅协议、幂等键与 conflict 错误）、labels、`features.*`、`CLIENT_CAPS.*`；`packages/client` 的请求方法与事件 union。
  - 依赖：无。
  - 验收要点：schema 纯净；round-trip 测试；zod-aot 客户端出站校验；旧协议 fixture 解析测试；`COMPAT` 注释含版本与移除条件；server-only 字段（idempotencyKey/requestFingerprint/creationPlan/creationStage/failedCleanupAt/**pendingRecruitments**）确认不在 wire schema，member entry 的 stored/wire 共用形态不含任何 server-only 字段；removalReason 含 recruitment_failed/canceled 两值；`npm run build:client` 后下游 typecheck 不破。
- **ITEM-2 · server 基础改造**
  - owning skill：codestable:cs-feat
  - 交付：AgentManager 多订阅者记录变更事件流（archive/unarchive/delete/label patch，覆盖 stored-only 路径；落盘后异步派发、不持锁；ScheduleService 迁移共用）；**per-turn 终态事实 `turnOutcomes`**（optional capped(100) 字段——形状、AgentManager 单点写入所有权、先持久化再派发事件、snapshot 重建式写入保留该字段）+ **活跃 turn 标识持久化**（带 daemon run 标识、startup 陈旧清除、终态与清除同一原子写，DEC-14）；**deletion guard 挂点**（DEC-12）；AgentManager 指定 id 幂等创建（同 id 同归属返回既有、冲突拒绝）；`team-store.ts`（atomic write、写串行化、损坏容忍、idempotencyKey 索引）。
  - 依赖：ITEM-1。
  - 验收要点：事件流对 stored-only 变更可见；订阅者异常不影响触发操作结果；终态事实先于事件持久化、可按 turnId 查询；**持久化 active turn 后 hard kill → 重启陈旧清除**；guard 拒绝 creating team 成员的 hard delete；**无关 snapshot 写不擦除 `turnOutcomes`**、legacy 记录（无字段）照常解析；指定 id 创建重复/冲突两分支；**schedule 回归明细**——live/stored-only archive 均只完成目标 agent 的未完成 schedule、已完成与无关 schedule 不变、startup orphan sweep 保留；损坏 team 文件跳过策略有测试。（docs：`architecture.md` 模块表、`data-model.md` agent record 字段）
- **ITEM-3 · chat 改造**（独立可发布，不与 team 耦合）
  - owning skill：codestable:cs-feat
  - 交付：`postMessage(actor)` 统一写入边界（mention fanout 入 service）、`author` 作者模型、订阅协议（原子首屏 + cursor + unsubscribe，按 socket 保存清理）、房间所有权 + 指定 id/owner 幂等创建 + owner 专用清理接口、按房间分文件存储 + DEC-9 状态机迁移。
  - 依赖：ITEM-1。
  - 验收要点：subscribe 首屏 + cursor 增量无漏无重；socket 断开清理订阅；`chat_room_message` 新老 socket 混连只达新 socket；owner 房间拒绝通用 delete；指定 id/owner 创建幂等两分支；分文件损坏隔离；**迁移**——状态表全状态、各崩溃注入点（第 k 房间后 / rename 前后 / marker 前）、old-only、两格式并存、重复启动、损坏 legacy，全程保 ID/顺序/时间戳；**mention 四分支**（live idle 唤醒、stored-only closed 唤醒、running 不打断、idle→running 竞态不打断）；旧 `authorAgentId` 兼容。（docs：`data-model.md` chat 存储、`architecture.md` 消息类型）
- **ITEM-4 · TeamService**
  - owning skill：codestable:cs-feat
  - 交付：创建事务（DEC-2）、task ledger（DEC-3：outbox 状态机 + 无抢占派发契约 + 因果绑定 + unknown 结算 + 原子结算入队）、inbox 投递、归档/退队/外部 unarchive 统一规则（DEC-11）/lead hard delete 收敛与 lifecycle 幂等包装层（DEC-12）+ 全量对账（含 archived/failed 与 pendingRecruitments 优先级）+ 泵启动屏障（DEC-14）、启动对账器、agent 工具（`assign_task`/`team_status`/chat 工具/`create_agent` teamRole 两阶段招募事务 DEC-13）、prompt 层 clientMessageId 去重（若现路径缺失）、简报模板（含 deliveryId 跳过与 unknown 求证指引）、`team.*` session handler、不变量（设计 §8）。
  - 依赖：ITEM-2、ITEM-3。
  - 验收要点：`allocated` 后 kill 凭 creationPlan 续跑；批内每个副作用点 kill；同 key 并发；重启后不同 requestId 同指纹重试；重启后改 payload 的同 key conflict；确定失败后换新 key；failed 清理幂等；**派发契约**——busy 时保持 queued 不打断、转 idle 触发派发、同 assignee FIFO 且至多一个 dispatched、首个仍 running 第二个不派发、**丢弃 idle 事件不重启 daemon 由兜底扫描收敛**；**因果绑定与三态判定**——无关 turn 完成不结算、多 assignment 各自结算、**尚未终态的 miss 不结算不释放 FIFO、真实滚出/崩溃中断 → unknown 结算入队**；**招募事务**——三窗口 kill（预留后/建成 prompt 未接受/意图未清）按意图收敛、最后名额并发仅一成功、**预留后 archive/remove 交错 fence 取消零残留**；ledger 三窗口 kill 无丢失；两成员并发完成合并投递；快速完成由 ledger 兜底；lead 忙积压、idle 后一次投递；permission 不终结 watcher；`archiving` 中断续跑；per-team 串行且事件处理不死锁；workspace teardown 并发幂等；`team_update` 混连门控；成员外部 archive/hard delete 落账（removalReason）；**外部 unarchive 全分支且正常/恢复路径等价（含 lead、含 archiving team 先补偿后续跑）**；**lead hard delete → active team 归档收敛 / creating team 转 failed 不重建，事件丢失重启对账兜底**；**归档遍历遇 removed/缺失记录视为完成不抛错**；**招募**——空初始 members 由 lead 全程组队、`teamRole` 缺失拒绝、保留字拒绝、上限校验；成员上限边界（8/9、名额回收、名额满 unarchive 转 removed）；跨 workspace 招募；detach 无关性。（docs：`glossary.md`、`agent-lifecycle.md`、`data-model.md` team/inbox 文件）
- **ITEM-5 · CLI + daemon E2E**
  - owning skill：codestable:cs-feat
  - 交付：`paseo team create/ls/inspect/archive/remove`（幂等键按设计 §4.1 生命周期）；确定性 daemon 级 E2E 脚本（两个 provider adapter，覆盖验收标准 #3 ① 的完整闭环）。
  - 依赖：ITEM-4。
  - 验收要点：E2E 以自动化脚本形式存在并跑绿；术语与 glossary 一致。（docs：`architecture.md` CLI 命令列表）
- **ITEM-6 · app 运行时 + 新建表单**
  - owning skill：codestable:cs-feat
  - 交付：`runtime/team-sync/`（authoritative replacement + **connection epoch 缓存重放** + per-team revision、hydration 建模）、store/selectors、subagents track 去重、keyed `TeamFormModel` 与 New Team 入口（确认页成本提示；模板默认 lead 用工具支持最好的 provider；幂等键生命周期）。
  - 依赖：ITEM-4。
  - 验收要点：revision 乱序测试（update 先到、旧 list 后到；重连 hydration）；断线期间 archive、重连列表缺席 → replacement 收敛；**hydration 期间 `team_update` 新增 list 缺席 team → epoch 缓存重放后存在**；selector 纯函数测试（roster join、subagents track 去重、聚合状态优先级 needs_input > running > idle）；表单遵循 `docs/forms.md` golden pattern；老 daemon 连接时入口隐藏；New Team 提交的 pending/success/failure 状态浏览器覆盖。
- **ITEM-7 · app team 面板**
  - owning skill：codestable:cs-feat
  - 交付：workspace tab target `{kind:"team"}`、deep-link resolver、close policy（lead tab 拦截）、room pane（订阅协议消费、长消息折叠）、成员条、权限聚合、侧栏条目、compact 适配、Playwright + 隔离 daemon 的权限聚合 E2E。
  - 依赖：ITEM-6。
  - 验收要点：`docs/expo-router.md` 约束不破（startup restore 场景验证）；关闭 lead tab 不静默归档 team；Playwright E2E——两成员同时 permission、聚合条两条目、独立 allow/deny 后 UI 状态正确；archive/remove/post 动作 pending/success/failure 覆盖；native 冷启动恢复 team tab；`docs/qa.md` 证据（六行 App 平台矩阵 + 桌面/compact 两档；daemon 侧覆盖说明）。

## 最终交付索引

设计文档 `docs/refactors/agent-teams-design.md` 已删除，其内容分派到各自主题的正式文档：

| 主题                                                                        | 去处                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| 术语（Team / Lead / Team role / Assignment / Recruitment）                  | `docs/glossary.md`                                 |
| 生命周期、成员 tab 的关闭语义、lead 与 team 的收敛                          | `docs/agent-lifecycle.md` §Teams、§Tabs vs archive |
| 持久化形状（`StoredTeam`、roster、ledger、`turnOutcomes`）                  | `docs/data-model.md` §7                            |
| 模块分层、RPC 与广播、`team.mission.room.*` 订阅协议、`onAgentRecordChange` | `docs/architecture.md`                             |
| team 深链路由与 handshake 先后                                              | `docs/expo-router.md`                              |
| CLI                                                                         | `docs/architecture.md` 的 CLI 一节                 |

实现索引：

| 层       | 位置                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protocol | `packages/protocol/src/team/`、`packages/protocol/src/messages.ts`、`agent-labels.ts`                                                                                                                                 |
| daemon   | `packages/server/src/server/team/`（service、store、inbox、pump、tools、scheduler、runtime）                                                                                                                          |
| CLI      | `packages/cli/src/commands/team/`                                                                                                                                                                                     |
| app      | `packages/app/src/teams/`、`packages/app/src/runtime/team-sync/`、`packages/app/src/components/teams/`、`packages/app/src/panels/team-panel-registration.tsx`、`packages/app/src/navigation/team-route-resolution.ts` |
| E2E      | `packages/server/src/server/team-e2e.e2e.test.ts`（daemon）、`packages/app/e2e/browser/team-panel.spec.ts`（浏览器）                                                                                                  |

## 整体验收

| #   | 标准                                                               | 结论                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 全子项实现；typecheck/lint 通过；每子项测试跑绿并留证据            | 满足。`npm run typecheck` / `npm run lint` / `npm run format:check` 全绿；`packages/server/src/server/team` 225 passed；app 侧 teams + team-sync + subagents + navigation + permission-actions 共 158 passed；CLI team 15 passed；i18n 资源 36 passed。逐子项证据在 `.codestable/work/epic-agent-teams.md`。 |
| 2   | 设计 §10 场景逐条绑定并有自动化覆盖                                | 满足。三个曾缺的场景已补：workspace teardown × team archive 并发（`team-lifecycle.test.ts`）、跨 workspace 招募（`team-recruitment.test.ts`）、detach 无关性（`agent-manager.test.ts`，改用真实 team labels）。                                                                                              |
| 3①  | 确定性 daemon E2E（双 provider，创建→派发→完成→room→权限→archive） | 满足。`packages/server/src/server/team-e2e.e2e.test.ts` 15 例，真 daemon、真 WebSocket、`claude` + `codex` 两个 adapter，已纳入 `test:integration`。                                                                                                                                                         |
| 3②  | App 级 Playwright + 隔离 daemon                                    | 满足。`packages/app/e2e/browser/team-panel.spec.ts` 4 例：广播到达侧栏、deep link 解析、**走 UI 建 team**（菜单→表单→provider→确认页成本→提交→落到 team tab→daemon 复核）、两成员权限聚合与独立作答（含"provider 不带 actions"的回落）、room 发言三态。                                                      |
| 3③  | `docs/qa.md` 六行平台矩阵 + 真实 provider 手工 smoke               | **未做**。人工走查，owner 于验收时在 PR 描述里补。模板见下。                                                                                                                                                                                                                                                 |
| 4   | 协议双向兼容；COMPAT 带版本与移除条件；legacy fixture 解析         | 满足。新 wire schema 无 `.transform/.catch/.preprocess`；`ChatMessage.author` optional、`authorAgentId` 保持必填；`team.update` 与 `chat.room.message_posted` 按 socket 门控且各有变异验证过的测试；`turnOutcomes` legacy 解析走真实读盘 + schema。                                                          |
| 5   | 文档同步；设计文档并入正式 docs 并删除                             | 满足。见「最终交付索引」。                                                                                                                                                                                                                                                                                   |

### QA 证据模板（owner 走查后填）

| 平台            | 桌面 / compact | 已测 | 备注 |
| --------------- | -------------- | ---- | ---- |
| iOS             | compact        |      |      |
| Android         | compact        |      |      |
| Web             | 桌面 + compact |      |      |
| Desktop macOS   | 桌面           |      |      |
| Desktop Windows | 桌面           |      |      |
| Desktop Linux   | 桌面           |      |      |

真实 provider smoke 至少覆盖：新建 team（跨 provider 混编）→ lead 派发 → 成员完成 → 结果回到 lead → 权限聚合条一允一拒 → room 里人插话 → 归档。daemon 侧说明 macOS/Linux 覆盖与 Windows/Docker 的覆盖或不适用理由。

## 遗留风险

- token 成本：一键 N agent；缓解已落子项：确认页成本提示（ITEM-6）、lead 简报按需派发（ITEM-4）。
- **投递重复（已接受风险，owner 裁决确认）**：at-least-once 语义下最终确认前重复次数**无上限**；clientMessageId/deliveryId 去重是 best-effort 削减；assignment 重复可能触发成员重复执行工具副作用，由各 agent 既有 permission 流程约束破坏性操作；provider 出现幂等接受协议后升级。
- **unknown 结算**：`acceptedTurnId` 从 `turnOutcomes`（cap 100）滚出的极端积压下，assignment 以 `outcome: "unknown"` 结算，lead 需向成员求证；无丢失但增加一次往返。
- design review 达阶段轮次上限后由 owner 裁决进入复核阶段；复核阶段的最终结论与残余项见 work 游标。
- lead 工具调用可靠性因 provider 而异；缓解：模板默认 provider（ITEM-6）。
- room 消息纪律依赖 prompt 实测调优；长消息折叠兜底（ITEM-7）。
- chat 存量迁移一次性执行后 legacy 以 `.bak` 保留，回滚需手工；DEC-9 状态表与全部注入点有测试覆盖。
- ScheduleService 迁移到共享事件流是既有功能回归面；回归契约固化在 ITEM-2 验收要点。
