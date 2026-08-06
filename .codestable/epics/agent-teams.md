---
status: active
created: 2026-08-06
work: ../work/epic-agent-teams.md
---

# Agent Teams：多 agent 协作小组

## 起点

Paseo 已有多 agent 基元（agent-scoped `create_agent` 委派、subagents track、chat rooms、labels、workspace/worktree），但没有把它们组合成可用的产品概念：用户无法一键创建一个跨 provider 的协作小组，无法在一个视图里看到小组的协调过程、成员状态与待处理权限。

详细设计已定稿并经过外部架构评审一轮、Epic design review 阶段一（3 轮）、复核阶段（3 轮已达上限）修订（当前 v2.6）：**`docs/refactors/agent-teams-design.md` 是本 Epic 的 canonical 设计文档**，本文档不复述其内容，只固化契约与拆解。设计文档在 final acceptance 阶段并入正式 docs 并删除，届时同步更新本节的 canonical 引用与"最终交付索引"。

## 目标

- 新建面板一键创建 team：lead + 若干成员，跨 provider 混编。
- 协作过程对人可见：team room 为中心，人可随时插话。
- 聚合视图：成员状态、待处理权限请求集中呈现。
- 生命周期可恢复：daemon 在创建/归档中途崩溃后由对账器收敛，不遗留孤儿资源。

## 范围

设计文档 §11 的 7 个 PR 对应本 Epic 的 7 个子项：protocol/client schema、server 基础改造（记录变更事件流、per-turn 终态事实、指定 id 幂等创建、team-store）、chat 改造（作者模型、订阅、所有权与幂等创建、分文件存储与存量迁移）、TeamService（创建事务、task ledger + inbox、归档、工具、简报）、CLI 与 daemon E2E、app 运行时与表单、app 面板与 Playwright E2E。

## 非目标

- 服务端 workflow/DAG 编排引擎；派发智能在 lead agent。
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

（accepted 时填写）

## 整体验收

（acceptance 阶段按"验收标准"逐条记录证据）

## 遗留风险

- token 成本：一键 N agent；缓解已落子项：确认页成本提示（ITEM-6）、lead 简报按需派发（ITEM-4）。
- **投递重复（已接受风险，owner 裁决确认）**：at-least-once 语义下最终确认前重复次数**无上限**；clientMessageId/deliveryId 去重是 best-effort 削减；assignment 重复可能触发成员重复执行工具副作用，由各 agent 既有 permission 流程约束破坏性操作；provider 出现幂等接受协议后升级。
- **unknown 结算**：`acceptedTurnId` 从 `turnOutcomes`（cap 100）滚出的极端积压下，assignment 以 `outcome: "unknown"` 结算，lead 需向成员求证；无丢失但增加一次往返。
- design review 达阶段轮次上限后由 owner 裁决进入复核阶段；复核阶段的最终结论与残余项见 work 游标。
- lead 工具调用可靠性因 provider 而异；缓解：模板默认 provider（ITEM-6）。
- room 消息纪律依赖 prompt 实测调优；长消息折叠兜底（ITEM-7）。
- chat 存量迁移一次性执行后 legacy 以 `.bak` 保留，回滚需手工；DEC-9 状态表与全部注入点有测试覆盖。
- ScheduleService 迁移到共享事件流是既有功能回归面；回归契约固化在 ITEM-2 验收要点。
