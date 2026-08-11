---
epic: ../epics/agent-teams.md
phase: acceptance
approved_revision: 075d13827cf8aa470b484f6a99d5ba444a0ea70c115333efb6b01b1d1d798104
current_item: null
next_action: 等待 owner 最终验收；接受后更新永久 Epic 终态、清理执行游标并按 remote_publish 策略发布
blocked_by: null
item_progression: continuous
milestone_commit: authorized
remote_publish: final
---

## 子项进度

- [x] ITEM-1 protocol + client schema
- [x] ITEM-2 server 基础改造
- [x] ITEM-3 chat 改造
- [x] ITEM-4 TeamService
- [x] ITEM-5 CLI + daemon E2E
- [x] ITEM-6 app 运行时 + 新建表单
- [x] ITEM-7 app team 面板

## Agent Teams v2 子项进度

- [x] BASE-0 封板当前 v1 修复基线
- [x] V2-ITEM-1 冻结领域内核
- [x] V2-ITEM-2 协议、能力门与 Client SDK
- [x] V2-ITEM-3 持久化与恢复
- [x] V2-ITEM-4 Feature capsule 与 Team/Mission 生命周期
- [x] V2-ITEM-5 Agent 协同工具面
- [x] V2-ITEM-6 DAG 调度、恢复与收敛
- [x] V2-ITEM-7 App 状态、副本与表单模型
- [x] V2-ITEM-8 Team 聊天与设置 UI
- [x] V2-ITEM-9 CLI、运行时启用与确定性 E2E
- [x] V2-ITEM-10 真实协同、QA、文档与最终验收

## Agent Teams v2 规划证据

- 2026-08-08：owner 将 v1 设计改为“用户维护 Role/Level/Skills/execution profile；Lead 按 Mission 动态生成职责”，并要求 Team 模块降低对 Paseo 核心的耦合。原批准 hash 仅覆盖 v1，新增 v2 契约后失效，故 `approved_revision` 重置为 `pending`；phase 保持 `executing`，不回退历史状态。
- 2026-08-08：owner 明确 Agent Teams 尚未上线，v2 是首个公开持久化、RPC 与 UI 格式。删除旧 Team 数据迁移、legacy adapter、双写、format marker、降级恢复、Legacy Mission UI/E2E 与 `needs_configuration`；Member 创建时必须具备完整 Role/Level/Skills/execution profile。单一 `teamMissions` capability gate 继续负责未来 App/daemon 版本漂移。owner 直接批准删除性收敛后的 Epic revision `075d13827cf8aa470b484f6a99d5ba444a0ea70c115333efb6b01b1d1d798104`。
- 当前 worktree 的实验实现 follow-up 已有 3/3 真实协同稳定性证据、desktop/compact 截图和定向自动化结果，但尚未形成独立里程碑；先执行 BASE-0，避免与 v2 实现混成一个不可归因 diff。
- V2-ITEM-1 已有 10 个文件 / 92 个测试的起始实现，以及一次 12/12 hash 一致的独立只读 review。规划复核发现旧 Member 不可无损映射到必填 Level/Skills、`rosterRevision` 无法单独解释历史 Mission、Mission 缺少显式最终 verification 三个契约缺口，因此该子项暂不勾完成。
- 实验实现的真实 provider 经验继续作为 v2 设计约束：fake E2E 不能证明模型实际调用 Team tools；`chat_wait` 会阻塞无抢占派发；role mention 若不是稳定 handle 会失效。v2 最终门同时要求确定性 runtime E2E、真实 provider 连续评分和消息/地址截图。
- 执行策略沿用 owner 已授权的 `continuous / authorized / final`。每个 item 通过 change review 后自动进入下一项；只在 clean milestone 边界同步 upstream，最终验收通过后一次 remote publish。
- v2 design review 轮 1：fresh reviewer = Paseo subagent `v2_epic_design_review`，冻结目标 `2e90161e…750e33`，结论“建议先改”，4 blocking + 1 important。已写入：逐 v1 RPC 行为映射与 downgrade policy；plan reject + durable scope lease + workspace baseline/path audit；v2 移除 blocking `chat_wait` 并增加 recipient attention outbox；replan/member/participant/cancel/archive 状态表；required/preferred skill、独立 reviewer 和 v2 Workstream fit 评分。
- v2 design review 轮 2：fresh reviewer = Paseo agent `69e89a5f`（claude/claude-opus-5 · max · plan mode），冻结目标 `a45ee185…de6046`，target valid，结论“建议先改”，2 blocking + 9 important + 6 minor。已按证据修订为 v2.7：audit policy 排除 ignored/runtime output并增加用户 resolve；`needs_report → report_hold → 有限 recovery → replan/cancel` 出口；workspace 级跨 Team lease；真实 review Assignment；provider capability snapshot 与 failure 分支；test/dev capability option；v1 broadcast/room rename；downgrade fingerprint conflict；v2 scalar assign 拒绝；legacy Mission 首屏；i18n；Mission failed/outbox/五维评分/既有 v1 文件原地包装。第三轮只核对这些修订，不扩实现范围。
- v2 design review 轮 3：同一 Paseo reviewer 复核冻结目标 `f89a1873198ceb4eefb6a632a208902584b4607d2e81f6cc6a468b1b03bccc92`（464 行），首尾 hash 一致，结论 **design review 通过**。上一轮 2 blocking + 15 findings 全部 resolved；新增 2 important + 3 minor 均明确不阻止 owner gate。
- 轮 3 的状态图、Mission attention RPC 与 session capability route 约束继续有效。Team 级 profile attention、migration conflict、legacy Assignment/adapter、legacy × v2 workspace 与 CLI/UI 决议约束已被 2026-08-08 owner 首发格式决策废止，不得进入后续实现。
- BASE-0 change review 轮 1：fresh reviewer = Paseo agent `20f59121`（claude/claude-opus-5 · max · plan mode），冻结 staged target `0486604b…77cbbe`（10389 行 / 124 files），target valid，结论“建议先改”，1 blocking + 1 important + 2 minor。修复：更正按 roster 顺序分配 handle 的矛盾断言；compat role alias 不再占用完整历史 roster 中已持久化的 handle，避免同角色新人继承离场成员旧地址；glossary 补充 `@server-2-2`。房间改名顺序保持“幂等 room side effect → Team write”：反向会让 room 失败后的重试被 Team 同值短路；新增 Team 写入首次失败、重试收敛测试固定该语义。定向回归 4 files / 85 tests、全 workspace typecheck、lint 均通过，等待同一 reviewer 复核修订目标。
- BASE-0 change review 轮 2：同一 reviewer 复核 `cdc25d4c…f4a5a7`（10458 行 / 125 files），首尾 target valid，上一轮 B-1/I-2/M-3/M-4 全部 resolved 或反驳成立，结论 **可合**，0 blocking / 0 important。Reviewer 新报 N-2：退役 handle 虽不再作为 room role alias，但惰性 token 仍可能经通用 agent title 精确匹配命中同名新人。Owner 判定该路径会破坏“历史地址不改指向”的完整保证，因此将 inactive canonical handle 在 room-local resolver 中标为不可投递，禁止进入全局 id/prefix/title fallback；新增红测后实现，等待第 3 轮只读复核。
- BASE-0 change review 轮 3（本阶段最后一轮）：同一 reviewer 核对最终 target `8d8567fc…dba4af`（10479 行 / 125 files），首尾 target valid，N-2 resolved，结论 **可合**，0 blocking / 0 important。Null sentinel 不会吞 active handle、agent id、`@everyone` 或未知 token；team room 内历史 handle 优先于队外同名 title 是有意行为。剩余 N-1 为 non-blocking minor：离场 handle 仍渲染为普通 mention chip，消息会留在 room 但无人被唤醒；在 V2-ITEM-8 把 Member state 透入 message directory 并弱化离场 chip，不回改已封板 v1 地址语义。
- V2-ITEM-1 实现：14 个新增 protocol/domain 源码与测试文件。Member 固化完整 Role/Level/Skills/execution profile；Mission 冻结 versioned roster/provider/tool/capability；Workstream 固化 required/preferred/runtime requirements、owner/reviewer 独立匹配、解释、override 与 plan revision；Assignment 固化 kind、revision、binding epoch、workspace baseline、execution lease/report hold；Mission 固化 durable attention、audit policy、final verification 质量门与可恢复状态机。Participant identity 改为 `(memberId, bindingEpoch)`，显式 rebind 后旧 Assignment 继续精确引用旧 agent/epoch。
- V2-ITEM-1 change review 轮 1：fresh reviewer = Paseo agent `86257ac1`（claude/claude-opus-5 · max · plan mode），冻结 staged target `3654b8f1…50a08`（5206 行 / 15 files），首尾 target valid，结论“建议先改”，5 blocking + 8 important + 4 minor。修复：scope 前缀与 concrete file path 分离；accepted turn 以 turn/runtime/outcome 精确事实注入；Mission 聚合调用 Assignment contract；current plan 的 approved review/final verification 双事实门；queued cancel 不伪造 runtime evidence；review read-only 与 Assignment scope 包含；planning attention + durable suspended status；wire policy 叶子放宽、domain 固化 canonical policy/recovery 上限；matcher 解释可重算；archived participant、supersededBy、Workstream 状态与 Team start readiness 全部闭合。
- V2-ITEM-1 TDD 证据：每条新增契约先见红再实现；首轮修复后的 7 个定向文件 **144/144 passed**。`npm run build:client`、全 workspace `npm run typecheck`、`npm run lint` 均 exit 0；复杂聚合按 attention/verification/snapshot/selection/participant/assignment/completion 拆为纯函数，lint complexity 无豁免。
- V2-ITEM-1 change review 轮 2：同一 reviewer 复核冻结目标 `452199fd…860f`（6691 行 / 15 files），确认上一轮 17 项全部 resolved，仅新增 N1 blocking：replan 后错误拒绝已结算的旧 revision Assignment，并只用当前 revision delivery 判断 accepted，导致聚合无法收敛。修复将 completed/canceled 旧项保留为历史事实，delivery/review acceptance 可复用已完成历史项，final verification 仍严格锚定当前 plan revision，并要求其 subjects 覆盖复用的历史交付。新增 revision 1 delivery + revision 2 final verification 正例与 stale final 精确反例，定向文件 **52/52 passed**；随后全 workspace typecheck、lint 均 exit 0。
- V2-ITEM-1 change review 轮 3：同一 reviewer 复核冻结目标 `bf87f755…980f`（6727 行 / 15 files），N1 resolved；新增 R3-I1/R3-I2 两项 important：历史 Assignment 因 revision 门控跳过 role/scope 校验，且聚合没有历史 Workstream 契约可判断旧交付能否满足改写后的验收标准。Owner 不接受依赖写入时校验的弱化方案，新增 append-only `workstreamPlanSnapshots`：旧 Assignment 必须解析到精确 revision 的 plan 并按原 owner/reviewer/scope 校验；snapshot revision 唯一且必须早于当前 plan；只有 objective、deliverables、acceptance、scope、依赖和硬能力契约兼容的 completed delivery/review 才能被当前 Workstream 与 final verification 复用。新增历史角色篡改、越界 scope、可写 review、缺/重复/非历史/错 revision snapshot、语义改写拒绝和跨 revision 收敛正例；最终 protocol + Mission 两文件 **71/71 passed**，`build:client`、全 workspace typecheck、lint 均 exit 0。
- V2-ITEM-1 change review 轮 4：同一 reviewer 复核冻结目标 `0e88bf76…17381`（7095 行 / 15 files），R3-I1/R3-I2 resolved，结论 **可合**，0 blocking / 0 important。历史 Assignment 按 `(planRevision, workstreamId)` 解析精确快照，所有 revision 都经过 role、review read-only 与 scope containment 校验；历史交付仅在完整 Workstream 语义契约兼容时复用，final verification 仍锚定当前 revision。里程碑提交：`d435255c3 feat(teams): freeze mission domain contracts`。
- V2-ITEM-1 Round 4 nit 处置：required-review 用例已改为精确 issue 断言；snapshot `status` 明确只作历史证据。Owner 决定跨 owner 允许复用语义契约完全相同的已完成交付：旧 Assignment 保留原 owner，新的未完成工作仍按当前 plan owner 派发，不把人员变更伪装成交付失效。
- V2-ITEM-2 实现：新增 10 组 `team.profile.*` / `team.mission.*` dotted correlated RPC、Team/Mission authoritative snapshot、单一 `teamMissions` server feature 与 `team_missions` per-socket capability；Mission 增加独立 aggregate revision。DaemonClient 在单一边界拒绝未声明 capability 的 daemon 且不降级/不发送，暴露 10 个 SDK 方法与双 snapshot 事件；Session 只追加两个按物理 socket 分流的薄路由，不接业务 handler，也不向 production 广告 capability。
- V2-ITEM-2 change review 轮 1：fresh reviewer = Paseo agent `v2_item2_change_review`，冻结 staged target `11038068…dc2ab`（2025 行 / 14 files），结论“建议先改”，1 blocking + 2 important。有效修复项：Team snapshot 增加 `activeMissionId`；Team/member create 与 patch 强制 Level、非空 Skills、execution profile；SDK `COMPAT(teamMissions)` 补版本与删除日期。Reviewer 要求的 legacy origin/Mission ledger/migration attention 依据旧 Epic；owner 随后明确功能未上线并删除该范围，因此复审必须以新批准 revision 为准，不得重新引入这些字段或 RPC。
- V2-ITEM-2 change review 轮 2：同一 reviewer 复核新批准 Epic 与冻结 target `8bea9339…f159d`（2646 行 / 20 files），确认 legacy finding 已被 owner scope supersede，其余 finding 全部 resolved；结论 **可合**，0 blocking / 0 important / 1 minor。唯一 minor 是测试 ID `member-migrated` 暗示已废止的迁移语义，随后按 reviewer 建议关闭。
- V2-ITEM-2 封板：reviewer 明确上述 minor 可选且不阻塞合并；按其建议只把测试 ID 改为 `member-existing`，未改变产品行为。修复后单文件 **8/8 passed**、全 workspace typecheck、lint、format 与 diff check 均通过；minor-only target `9d3f4425…3a415`（2647 行 / 20 files），review gate 保持 0 blocking / 0 important。
- V2-ITEM-2 TDD 证据：协议、Client、Session 三层均先见红；首发格式收敛后的完整定向回归 **9 files / 124 tests passed**。`npm run build:client`（含 validator 生成）、全 workspace `npm run typecheck`、定向 lint、format 与 `git diff --check` 均 exit 0。
- V2-ITEM-3 实现候选：新增 feature-owned `TeamProfileStore`、`MissionStore`、跨 Store start/finish transaction 与 startup reconciler。Team profile 和 Mission 使用独立 per-file JSON、预分配 ID、原子写、wire/storage 双 revision CAS、持久化 start/finish 阶段、ownership/outbox 恢复态；v2 首发路径不读取、迁移、标记或备份任何实验格式。
- V2-ITEM-3 change review 轮 1：fresh reviewer = Paseo agent `v2_item3_change_review`，冻结 staged target `e10cab73…bd83`（3727 行 / 10 files），首尾 target valid，结论“建议先改”，2 blocking + 2 important。修复：start saga 改为 `reserved → mission_written → room_created → lead_created`，Mission 与预分配 Lead binding 在任何 room/Agent 外部副作用前落盘；Mission start key/fingerprint 永久保存在 Mission Store，运行中、终态和 daemon 重建后均返回原 Mission；reconciler 校验 Team/workspace 双向归属；generic profile/Mission update 禁止绕过 start/finish saga 修改 active link 或终态字段。
- V2-ITEM-3 change review 轮 2：同一 reviewer 复核冻结目标 `4c6a6a54…a4415`（4138 行 / 10 files），B1/B2/I3 resolved，I4 仍有可变 updater 原地改写比较基准的绕过路径；新增 N1 blocking：不同幂等键可并发初始化冷索引，较晚旧快照覆盖已追加映射并导致重复 Team/Mission。修复为 Store 级共享 initialization promise，全部创建只向同一个 Map 追加且初始化失败可重试；generic updater 接收 `structuredClone`，所有 transaction/identity 比较保留原始记录作为基准。
- V2-ITEM-3 change review 轮 3：同一 reviewer 复核冻结目标 `9d20efe6…d0351`（4316 行 / 10 files），I4/N1 resolved，上一轮全部 finding 保持关闭；新增 R3-B1 blocking：`updateRecoveryState` 仍把可变 recovery arrays 直接交给 callback，原地 push 后返回同对象会在内存中看似成功但跳过原子写。修复为 recovery state 同样使用 clone + 深比较，并用新 Store 实例重启读取 outbox 的回归锁定真实持久化。
- V2-ITEM-3 change review 轮 4：同一 reviewer 窄复核冻结目标 `8f2295b1…66b2e`（4363 行 / 10 files），R3-B1 resolved，结论 **可合**，0 blocking / 0 important。Recovery updater 原地修改后由新 Store 重启读取确认 `storageRevision` 与 outbox 均已持久化；此前 Mission-first、永久 start 幂等、双向归属、transaction field guard 与冷索引并发修复均保持关闭。
- V2-ITEM-3 TDD 证据：4 个定向文件 **49/49 passed**。覆盖 fresh install/restart、create/start/finish 永久幂等、不同 key 冷索引并发、并发 CAS 与并发 start、generic/recovery mutate-then-copy/in-place updater 持久化守卫、每个 start/finish 阶段、Mission write/stage advance/Lead binding/finalize crash 窗口、rename 前后临时文件、部分/损坏/错 identity 单文件隔离、Team/workspace 双向链接 attention、recipient/completion outbox 重放；终态写入原子取消未确认 recipient attention。全 workspace typecheck、定向 lint、format 与 `git diff --check` 均 exit 0，review gate passed。
- V2-ITEM-4 实现候选：新增 Team-owned application ports、`TeamMissionService`、Paseo provider/room/participant adapters 与 v2 runtime façade。创建 Team 只写 profile；Mission 以 `Mission → room → Lead participant → active link` 的持久化阶段续跑，成功后的 start key 在 Team 状态或 provider 可用性变化后仍返回原 Mission；取消归档全部 participant，但保留 Team、Mission 与 room。归档前核对 Agent 的 Team/Mission ownership，stored-only Agent 走 durable lifecycle command。production bootstrap 固定 `{ enabled: false }`，禁用安装不创建 v2 目录；test/dev 显式开启后只在 reconciliation 完成时广告 `teamMissions`。实验 Team service、RPC、tool、prompt、scheduler、inbox 与旧广播分支已删除，不保留 migration、legacy adapter 或双栈。
- V2-ITEM-4 TDD 证据：9 个定向文件 **46/46 passed**。覆盖 capsule import 边界、仅 profile 创建、start 副作用顺序、永久 start replay、部分 start 重启、取消保留历史、未知 Member 拒绝、并发 Attention resolution 收敛、runtime ready/stop、provider registry capability、room 幂等、stored-only 与跨 Mission ownership 归档、禁用安装无存储、按物理 socket RPC/snapshot 与 canonical mention handle。全 workspace typecheck、21 文件定向 lint、format 均 exit 0；owner 冻结前自审新增的 5 条反例均先红后绿。
- V2-ITEM-4 change review 轮 1：fresh reviewer = Paseo agent `v2_item4_change_review`，冻结 staged target `37bc6e8b…c903f99b`（14112 行 / 45 files），结论“建议先改”，4 blocking + 1 important。修复：owned stored-only Lead 在 daemon 重启后通过真实 `AgentManager + AgentStorage` 恢复为 live；mention roster 按 `(teamId, roomId)` 解析对应 Mission 的冻结 snapshot，终态历史 room 不再借用当前 Team roster；Team Store 原子保存永久 handle tombstone，active/pending Mission 拒绝普通 remove/lead change，archive 与 start 在 Store 串行快照上互斥；Attention resolution 复用领域 kind 矩阵，`cancel_mission` 与 resolution 审计原子进入 finish saga，completed/failed 内部入口补齐且 completion 受完整质量门控制；bootstrap 只 import `team-runtime.ts` façade，边界测试动态扫描全部 domain/application 生产文件与核心 Team imports。
- V2-ITEM-4 review 修复 TDD 证据：新增/修订用例覆盖真实 stored-only 重启、历史 room/当前 room 隔离、删除后重启再招募不复用 handle、active/pending roster fence、start/archive 两种竞争顺序、非法 Attention 决议不落盘、Attention cancel participant archive crash 后 startup reconcile、premature completion reject、fatal failure finish，以及 façade import。受影响文件累计 **143 个不重复定向测试通过**；`npm run build:client`、全 workspace `npm run typecheck`、18 文件定向 lint、format 与 `git diff --check` 均 exit 0。
- V2-ITEM-4 change review 轮 2：同一 reviewer 复核冻结目标 `0b5af6db…509fd`（15298 行 / 52 files），确认轮 1 finding 全部关闭；新增 3 blocking + 2 important。修复：待启动 Mission 可经 finish saga 取消并原子清除 start intent，终态 Mission 在任何 room/Lead 副作用前停止重放；start intent 冻结 Team name，room 重放不受后续改名影响；reconcile 按 intent 隔离外部失败，失败 Team 持久进入 `lead_unavailable` Attention，其他 Team 同轮继续；只开放已接入真实副作用的 `external_change` / `cancel_mission` resolution，其余明确拒绝；Team archive 改为持久化 saga，活跃或待启动 Mission 先取消、participant 清理完成后再归档 Team，崩溃由同一 archive intent 续跑。
- V2-ITEM-4 Round 2 修复 TDD 证据：5 个定向文件 **71/71 passed**，覆盖 pending cancel 后重启不建 Lead、room rename crash window、坏/好 Team 恢复隔离、7 类未实现 Attention 副作用拒绝、pending/active Mission Team archive、participant archive crash 后重启收敛、archive/start 竞争、archive Store 阶段单调与 reconciler action。全 workspace `npm run typecheck`、10 文件定向 lint、format 与 `git diff --check` 均 exit 0。全部存储字段与 RPC 行为都是 v2 首发契约，未增加旧格式解析、迁移、旧 RPC 或双栈分支。
- V2-ITEM-4 change review 轮 3（该 reviewer 的终轮）：冻结目标发现 2 blocking + 2 important。B1：Mission start 的 `createLead` 外部副作用窗口可与 cancel/archive 交错并留下孤儿 Agent；B2：损坏的 archive intent 可恢复另一个 Team 的 Mission；I1：finish/archive 恢复失败只存在进程内 blocked set，用户快照不可见；I2：archive 错把 correlated `requestId` 当业务幂等键。Owner 按 finding 逐项收口：所有 lifecycle mutation 共用 per-Team serializer；archive Mission 在任何副作用前校验 Team/workspace ownership，reconciler 对缺失/错归属链接只产 attention 且不派恢复动作；Team/Mission 快照持久化 `lifecycleRecoveryFailure`，包含 intent、业务幂等键、错误、retry action、attempts，重复失败递增，成功终态原子清空；archive RPC/SDK 要求独立 `idempotencyKey`，façade 不再从 `requestId` 推导。
- V2-ITEM-4 Round 3 修复 TDD 证据：受影响的 17 个精确定向文件累计 **307/307 passed**。新增 createLead×cancel/archive 门闩、archive 跨 Team/跨 workspace 污染、Mission cancel/Team archive 持久失败、重启读取、当前 revision 重试、attempt 递增、成功清理与 façade 幂等键路由反例；`npm run build:client`、全 workspace `npm run typecheck`、定向 lint 均 exit 0。Review lineage 已到终轮，owner 依据红绿测试与质量门关闭 4 项 finding；实现继续遵守 v2 首发格式，不增加实验格式读取、迁移、legacy adapter、旧 RPC 或双栈。
- V2-ITEM-5 实现候选：新增 `TeamCollaborationService` 与 Paseo tool/history/message adapters，注册 `team_status`、`mission_status`、`team_member_history`、`mission_plan`、结构化 batch `assign_task`、`assignment_report`、`team_message`、非阻塞 `chat_read` 八个工具；schema 层拒绝 scalar assign，不注册 `chat_wait`。所有调用按 caller Agent 重新解析当前 Mission participant；plan 使用冻结 roster/capability 与确定性 matcher，daemon 保存 owner/reviewer explanation；Assignment batch 先完整校验再原子落账。
- V2-ITEM-5 消息与 prompt 契约：directed message 先持久化确定性 outbox intent，再以 caller-owned message id 写 Mission room；ChatService 一致重放在 mention eligibility 前短路，Team adapter 禁止通用 mention fanout，由 durable attention scheduler 独占唤醒。`chat_read` 立即返回并推进 Member cursor/ack；未写 room 的 outbox 暴露 `post_recipient_message` 恢复动作，已写 room 后才暴露 recipient attention。Lead start prompt 只含 Team/Member/Mission 身份与 `mission_status → mission_plan` 下一动作，重放按确定性 clientMessageId 去重，不含 objective、roster 或协作算法。
- V2-ITEM-5 TDD 证据：11 个精确定向文件 **115/115 passed**；matcher 重构后的 application 文件 **18/18 passed**。负例覆盖非 participant、归档 participant、越权 history、非 Lead plan、旧 plan revision、缺 final verification、失败 batch 零部分写入、额外 mention、未 provision recipient、错误 assignee report、终态 Mission，以及 Lead 在 pending start active-link 窗口恢复工具事实。全 workspace `npm run typecheck`、`npm run lint`、定向 format 与 `git diff --check` 均 exit 0；原始命令记录见 `audits/agent-teams-v2-item-5/verification.md`。
- V2-ITEM-5 change review 轮 1：fresh reviewer = Paseo agent `v2_item5_change_review`，冻结 staged target `e62a11db…ab299`（4280 行 / 26 files），首尾 target valid，结论“建议先改”，3 blocking + 2 important。修复：真实 recipient attention adapter 消费 durable outbox，busy 不抢占并在 turn settle 后重试，三次未确认进入 durable attention，binding replacement 生成确定性 successor；replan 原子 supersede blocked/failed/needs-report Assignment、接管 report hold 并允许复用历史 completed turn；caller-owned chat id 重放先重试持久化；`team_message` 与 lifecycle 共用 per-Team coordinator，aggregate CAS 内重验 sender/recipient binding；final verifier 排除写入者后重跑完整 matcher 排名，并保留 full-roster 审计解释。
- V2-ITEM-5 review 修复验证：13 个精确定向文件 **161/161 passed**，其中 collaboration service **27/27 passed**；全 workspace `npm run typecheck`、`npm run lint`、30 文件 format 与 `git diff --check` 均 exit 0。实现仍为单一首发 Team/Mission 格式，不含 migration、legacy adapter、双写或旧 UI/tool/RPC fallback。
- V2-ITEM-5 change review 轮 2：同一 reviewer 复核冻结 target `f2caf85d…3d2e`（5625 行 / 30 files），上一轮 final verifier ranking 已 resolved，结论“建议先改”，2 blocking + 2 important。修复：participant unavailable 进入 durable attention，notification delivery 持久化退避且 `restore_notification` 原子重置；needs-report replan 在释放 scope 前保存 path/fingerprint delta handoff；Mission 校验通过 `AgentStorage` 适配器读取真实 active/terminal turn fact，不再从 Assignment 状态反推；chat failed-write replay 补齐普通 mention fanout 且仅一次；crash replay 与 eligibility 两个后台 pump 共用 per-Team coordinator，并以两个 gated cancel race 固化顺序。
- V2-ITEM-5 Round 2 修复验证：7 个受影响定向文件累计 **143/143 passed**，collaboration service **32/32 passed**；全 workspace `npm run typecheck`、`npm run lint`、`npm run format:check`、工作区与 staged `git diff --check` 均 exit 0。等待同一 reviewer 复核修订 target；未加入 migration、legacy、双写或 fallback。
- V2-ITEM-5 change review 轮 3：同一 reviewer 复核冻结 target `060e73dc…1eff`（6483 行 / 33 files），确认 background coordinator finding resolved，结论“建议先改”，2 blocking + 3 important。修复：`participant_unavailable` 可由 Lead 在同一 plan CAS 内以 replan resolution 收敛；terminal turn event 追加到 Mission 自有 accepted-turn ledger，不再依赖 AgentStorage 的 100 条保留上限；report-hold delta 通过 replacement `inputRefs` 稳定引用并由 `mission_status` 对成员公开；ChatService 在落盘失败时回滚内存消息，避免后续写入与重启吞掉 mention fanout；并发 `restore_notification` 的 revision loser按持久化 resolution 幂等返回。
- V2-ITEM-5 Round 3 修复验证：10 个受影响定向文件累计 **160/160 passed**；新增超过 100 条无关终态后的 replan、handoff 成员查询、失败写→后续写→重启、双 runtime 同 resolution 门闩等反例。全 workspace `npm run typecheck`、`npm run lint`、`npm run format:check`、工作区与 staged `git diff --check` 均 exit 0；等待同一 reviewer Round 4。实现仍为单一首发 Team/Mission 格式，不含 migration、legacy、双写或 fallback。
- V2-ITEM-5 change review 轮 4：同一 reviewer 复核冻结 target `bd1e413d…a2ef3`（7045 行 / 33 files），确认 delta handoff、Chat failed-write、并发 restore 与 background coordinator resolved，结论“建议先改”，2 blocking + 1 important。修复：replan 原子取消对应 unavailable delivery；每次 `restore_notification` 生成确定性 `:recovery` successor，领域层拒绝重复 Attention id；terminal event 先从 Agent labels 路由到单 Mission，再用 Mission 内有序队列重试首次 ledger/storage 失败，坏 Mission 不阻塞其他 Team，非 Team turn 零 Mission I/O；startup reconciliation 回填 crash-window fact。
- V2-ITEM-5 Round 4 修复验证：7 个受影响定向文件累计 **170/170 passed**；覆盖 participant 两轮 replan、notification 两轮 restore、重复 Attention id、首次 ledger 写失败后 101 个后续 turn、非 Team 零 Mission I/O、跨 Mission 故障隔离与 startup backfill。全 workspace `npm run typecheck`、`npm run lint`、`npm run format:check` 与 diff gate 均 exit 0；等待同一 reviewer Round 5。未加入 migration、legacy、双写或 fallback。
- V2-ITEM-5 change review 轮 5：同一 reviewer 复核冻结 target `e83193cd…b270`（7546 行 / 35 files），确认 Attention generation、accepted-turn durable retry 与 terminal event 单 Mission 路由全部 resolved，结论 **可合**，0 blocking / 0 important / 0 minor。`restore_notification` 的低频 successor 驱动明确归 V2-ITEM-6 scheduler；本项已经提供持久状态与可重放入口。
- V2-ITEM-5 封板：定向回归最终 **170/170 passed**，全 workspace typecheck、lint、format check 与 diff gate 全绿。实现只有首发 Team/Mission 格式，不含 migration、legacy adapter、双写、旧 RPC/tool/UI fallback 或 downgrade 路径。
- V2-ITEM-6 实现：新增 Mission DAG scheduler、workspace 级 scope lease registry 与 Paseo dispatch/snapshot/turn-fact adapters。调度按依赖、Member slot、provider readiness 与稳定优先级派发；execution lease、`report_hold`、历史 ownership interval、recipient attention、有限 report recovery、participant loss、review/replan 和终态 cleanup 都以 durable 状态驱动，重启后无 busy-wait、无自动重复 provider work。
- V2-ITEM-6 崩溃与收敛证据：finish saga 按 `requested → dispatch_stopped → participants_archived → evidence_prepared → finalized` 重放，accepted turn、captured delta、report/handoff 与 ownership evidence 精确绑定 intent；provider acceptance window 使用 durable unknown fence，provider 边界前失败可 CAS 释放，边界后禁止自动重发；链式 A→B→C report-hold transfer、跨 Team 同 workspace lease、daemon restart、late report、archive/cancel/fatal failure 与坏 Mission 隔离均有真实 Store/AgentStorage 定向测试。
- V2-ITEM-6 change review：fresh Paseo reviewer `6c24a253` 沿同一 lineage 逐轮核验 scheduler、finish saga、provider acceptance 与 Agent close 竞态；最终冻结 target `09efb623…0e6`（16555 行 / 40 files），结论 **可合**，0 blocking / 0 important。最终 `agent-manager.test.ts` **176/176 passed**，受影响定向测试均由对应 owner 报告 green；全 workspace `npm run typecheck`、`npm run lint`、`npm run format` 与 staged diff check 均 exit 0。
- V2-ITEM-7 实现：App 新增按 revision authoritative replace 的 `teamMissions` profile/Mission 副本、断线 list/inspect 补齐与历史读取状态；Team profile 与 Mission start 使用非 React form model，支持多 Team 选择、Role/Level/Skills/execution profile、late provider data 与 unknown outcome 冻结重试；Team participant tab 的关闭只改布局，不归档 Agent 或改变 Mission。
- V2-ITEM-7 change review：同一 Paseo reviewer `6c24a253` 复核最终候选 `6d4aa64f…c4b8fc`（4722 行 / 34 files），确认旧 TeamSync 门控、冷启动缺 Agent 关闭策略、连接切换 history 收敛、迟到表单成功和 update 丢响应重试全部闭合，结论 **可合**，0 blocking / 0 important。Update 请求 key + semantic fingerprint 与 profile mutation receipt 原子持久化，真实文件 Store 重启后不重复执行 mutation；无 key 请求保留 CAS 并带 `COMPAT(teamProfileUpdateIdempotency)` 清理标签与解析测试。
- V2-ITEM-7 验证：协议/Client/ProfileStore/Service/App 提交链 **72/72 passed**，Team profile form model **10/10 passed**，协议兼容补测 **9/9 passed**；`npm run build:client`、全 workspace `npm run typecheck`、`npm run lint`、`npm run format:check` 与 staged diff check 均通过。
- V2-ITEM-8 实现与证据：Team 主 Tab 只承载 Mission room 与 composer；设置入口位于 composer，desktop 使用居中 sheet、compact 使用上拉 sheet，包含 Team、Members、Mission、Plan & Assignments、Attention & Lifecycle 五页。Tab `+` 可创建 reusable Team profile，创建时不 provision Member 或打开 Agent Tab；Mission 另行选择 Team 启动。mention 使用稳定 handle，人类作者显示本地化“我/You”。Playwright 隔离 daemon 流程 **1/1 passed**，13 张 desktop/compact 状态截图与六行平台矩阵进入 `audits/agent-teams-v2-ui/`；App v2 单测 **128/128 passed**，HostRuntime **69/69 passed**。
- V2-ITEM-9 实现与证据：CLI 提供 `team profile create/list/inspect/update/archive` 与 `team mission start/list/inspect/cancel`；production runtime 在 HTTP listener 绑定并注入 Agent MCP URL后启动 reconciliation，ready 后才广告 `teamMissions`。`assignment_report` 对无关 Mission CAS 变化有界 rebase，Assignment revision 或 Participant binding 变化拒绝，残余 Mission CAS 返回 typed code。确定性真实 daemon E2E **1/1 passed**，覆盖 lazy provision、agent-scoped Team tools、两 delivery 真并行、独立 review、dependency-gated integration、final verification、Participant archive、exactly-once side effect、重启快照与第二 Mission list/inspect/cancel；CAS 定向回归 **47/47 passed**，protocol/client/CLI 单测 **146/146 passed**，真实 CLI binary 集成通过。原始输出进入 `audits/agent-teams-v2-runtime/`。
- V2-ITEM-10 fresh 证据：候选基线 `3e9daa79e` 上，真实 Codex 的 `parallel_delivery` 与 `recovery_dependency` 两种固定任务形状各连续 3 次达标，六次总分均为 **8**、五维无零且 Delivery=2。并行形状三次 `maxParallelAssignments=3`；恢复依赖形状三次 `after_lead_participant_write` 故障注入均生效，启动幂等重放后收敛。六次 validation violation、scope conflict、rework、accepted-turn replay、unresolved report 与 unresolved Attention 均为 0，verification 全通过；测试侧无重试。证据校验器已经对真实观测到的 contract amendment 链、required review、两种 final Workstream 依赖形态建立精确 DAG 与反例门。六份 `allowlisted_v1` manifest、六份 sanitized provider JSONL 与两份 Vitest run log 进入 `audits/agent-teams-v2-real-provider/`；自由文本与 workspace/tool/chat/verification 内容只持久化 digest、bytes 或 count。正式 architecture/data-model/agent-lifecycle/testing/glossary/protocol docs 已收敛到 v2 首发模型。
- V2-ITEM-10 final acceptance：fresh managed reviewer 首轮发现 runtime 顶层 reconciliation 错误被吞、App 用冻结 provider snapshot 隐藏可用 replacement Lead 两项 important；两项均以鉴别性红测修复。runtime 原 reviewer 随后发现 unreadable pending Mission 会越过动作隔离并放大为 daemon 启动失败；修复把 profile/Mission 读取、block 判定与 replay 收进统一动作边界，真实双 Team 文件存储回归证明坏 Mission 保留、健康 Team 继续恢复。最终冻结 target `4ded35f8…97c0d1`（41420 行 / 90 files），fresh final acceptance 与 runtime follow-up 均判定 **0 blocking / 0 important，可合**。最终增量验证：service **66/66 passed**、runtime install **15/15 passed**、App selector **5/5 passed**；全 workspace typecheck、lint、format 与 staged diff check 均通过。

## 临时决策与证据

- canonical 设计：docs/refactors/agent-teams-design.md（v2，已经外部评审一轮，v1→v2 变更见其 §13）。**验收阶段已按 Epic 要求并入正式 docs 并删除**——下文对它的引用都是当时的事实，去处见 epic 的"最终交付索引"。
- 2026-08-06 起草 proposed Epic；lessons/v1 目录无相关命中。
- design review 阶段：reviewer = Paseo agent `9db31667`（codex/gpt-5.6-sol · max thinking · 异构最强，受管理结构化委派创建，无回退）。
  - 轮 1（目标 `5a723409…`/`928f6e60…`）：建议先改再合，4 blocking + 6 important。
  - 处理：设计文档升 v2.1（revision 契约、创建事务持久化幂等 + creationStage、inbox at-least-once + deliveryId 去重、chat 迁移策略冻结、mention 不打断、事件派发时序、成员上限边界）；Epic 新增 DEC-8/9/10，§10 场景逐条绑定子项验收，文档/缓解归属子项，E2E 与平台矩阵标准强化。
  - 轮 2（目标 `4e6d9872…`/`99e002c6…`）：建议先改再合。resolved：B1/I2/I4/I5/I6；unresolved：B2/B3/B4/I1/I3；new：NF-1（unarchive×上限，blocking）、NF-2（stored-only 可唤醒）、NF-3（wire 措辞）。
  - 处理：设计文档升 v2.2——资源级幂等创建（指定 id agent/room、owner 清理接口、批内注入点）、幂等键生命周期三规则、inbox 端到端语义降为 at-least-once + ledger 漏事件重建 + completionEventId 定义、DEC-11 外部 unarchive 冻结、迁移状态表（marker 前零写入 ⇒ 存在即跳过，写→rename→marker 固定顺序）、可唤醒定义（storage 兜底四分支）、TeamSnapshot 显式投影；Epic 同步 DEC-2/3/9/10 改写 + DEC-11 新增 + ITEM 验收补绑（混连门控、快速完成、selector、Playwright 权限聚合 E2E）。
  - 轮 3（目标 `7e0166f4…`/`8dc4de99…`，最后一轮）：建议先改再合。resolved：B4/I1/I3/NF-2/NF-3；unresolved blocking：B2（缺持久化 creationPlan）、B3（ledger 两端窗口 + 终态事实无持久查询面）、NF-1（archived team 对账缺口）；new important：重复无上限表述、hydration 缺席语义、平台矩阵对齐 qa.md。
  - 轮次上限已到（3/3），不再对轮。三项 blocking + 三项 important 的修复已按 reviewer 建议写入 v2.3（creationPlan + requestFingerprint、ledger outbox 状态机 + acceptedTurnId 因果绑定 + per-turn 终态事实持久化归 ITEM-2、archived/failed team 对账 + removalReason、at-least-once 重复无上限表述、authoritative replacement、六行平台矩阵）。v2.3 未经复审，交 owner 裁决。
  - 当前冻结：epics/agent-teams.md `a8b77c3d…99fe`、docs/refactors/agent-teams-design.md `67333392…e328`。
- owner gate（2026-08-06）：裁决 = 换 fresh reviewer 复核 v2.3；版本控制策略已定 continuous / authorized / final（已写 frontmatter）；拆解最终确认待复核清零后补。
- v2.3 复核阶段（新审查阶段，新 lineage）：fresh reviewer = Paseo agent `dfda1b8e`（codex/gpt-5.6-sol · max thinking，owner 要求的第二意见）。
  - 轮 1（目标 `a8b77c3d…`/`67333392…`）：前阶段 6 项中 5 项 closed；not closed：R3-NF-1（lead unarchive 正常/恢复路径不一致）；new blocking：NEW-B1（busy 派发契约缺失）、NEW-B2（招募 role 来源）、NEW-B3（hydration 集合级竞态）、NEW-B4（lead hard delete 无状态转换）；new important：NEW-I1（终态事实持久化形状/保留）。
  - 处理：设计文档升 v2.4——unarchive 统一规则（正常≡恢复，含 lead）、无抢占派发契约（可唤醒才派发、per-assignee FIFO、至多一个 dispatched、unknown 结算）、`create_agent` 条件必填 `teamRole`、hydration epoch 缓存重放、lead hard delete → team archive 收敛、`turnOutcomes` optional capped(100) 形状/所有权/擦除保护；Epic DEC-3/8/11 改写 + DEC-12/13 新增 + ITEM-2/4/6 验收补绑。
  - 轮 2（目标 `80177dd0…`/`49bbc828…`）：resolved：NEW-B1/B2/B3；unresolved：R3-NF-1（lead 容量措辞矛盾 + archiving 恢复路径不等价）、NEW-B4（creating 期 lead 删除会重建 + 归档遍历撞 removed/缺失记录）、NEW-I1（滚出与未终态不可区分）；new：R2-B1（事件丢失 pump 永久沉睡）、R2-B2（招募无事务/容量预留）。
  - 处理：设计文档升 v2.5——归档目标集合冻结（仅 active entry，removed/缺失视为完成，lifecycle 命令不抛错）、archiving 对账先 eviction 补偿再续跑、creating 期 lead 删除转 failed、终态判定三态规则（终态/活跃 turn/unknown，活跃 turn 标识持久化归 ITEM-2）、pump 低频兜底扫描、招募两阶段事务（roster 预留 + pendingRecruitment 意图先行）；Epic DEC-3/11/12/13 改写、ITEM-2/4 补绑。
  - 轮 3（目标 `ca2fa8b8…`/`ce8c2bc1…`，本阶段最后一轮）：resolved：R3-NF-1、R2-B1；unresolved blocking：NEW-B4（creating 期删除无 tombstone 不可判定）、NEW-I1（活跃 turn 无崩溃收敛契约）、R2-B2（招募意图不完整/无 fence）；new important：R3-I1（pendingRecruitment schema 位置）、R3-I2（lifecycle 缺失语义与 user-facing 冲突）。reviewer 处置：三项 blocking 均"实现前解决"（设计层可修），importants "实现中解决"；at-least-once 重复/unknown/60s 延迟明确可接受为已知风险。
  - 处理：v2.6——creating 期 deletion guard（同步拒绝，ITEM-2 挂点）、活跃 turn 带 daemon run 标识 + startup 陈旧清除 + 终态清除原子写 + 泵启动屏障（DEC-14 新增）、招募意图完整持久化（initialPrompt/clientMessageId/recruiter/workspace/stage）+ lifecycle fence + `recruitment_failed/canceled` + 对账优先级、pendingRecruitments 移 StoredTeam 顶层（wire 不含）、lifecycle 缺失语义改 TeamService 专用包装层（不改 user-facing）。
  - 复核阶段两轮上限均已用尽（阶段一 3 轮 + 阶段二 3 轮）。v2.6 未经机械复核。owner 于 2026-08-06 选择亲自审阅后终裁（拆解确认随终裁一并给出）。当前冻结：epics/agent-teams.md `44c36639…934d`、docs/refactors/agent-teams-design.md `85dcdea4…f24d`。
- owner 终裁（2026-08-06）：**接受 v2.6，确认拆解，进入 executing**。Epic 置 active，批准 hash `74667ea6e2b559834cbf8f6f7ec717d415917df36e718391620e39fae3935a79`（置 active 后的完整文件）。
- 落地位置：paseo 托管 worktree `/Users/wyattfang/.paseo/worktrees/3rvhzvvc/agent-teams`，分支 `feat/agent-teams`（branch-off from main @ ab3291fe2），workspace `wks_7b47678f73195706`。Epic/设计/游标三份文件已复制入 worktree，内容 hash 与主 checkout 冻结值一致。
- 残余风险（owner 接受）：at-least-once 重复、unknown 结算、事件丢失后至多约 60s 延迟；R3-I1/R3-I2 两项 important 为"实现中解决"，已写入 ITEM-1/ITEM-4 验收。

## ITEM-1 · protocol + client schema（完成 2026-08-06）

交付：`packages/protocol/src/team/{types,rpc-schemas}.ts`（实体 + 显式 wire 投影 `toTeamSnapshot` + 5 组 dotted RPC + `team.update` 广播）、`agent-labels.ts` 的 `TEAM_ID_LABEL`/`TEAM_ROLE_LABEL` 与 getter、`chat/types.ts` 的 author 模型与房间所有权、`chat/rpc-schemas.ts` 的订阅协议、`messages.ts` 五处 union 接入 + 两个 feature gate、`client-capabilities.ts` 两个能力、`packages/client` 的 7 个方法与 2 条 DaemonEvent。

证据：protocol 相关 54 passed、client 113 passed（含 4 个新测试）、protocol 全量 559 passed（1 failed 为基线预存项 `messages.server-info.test.ts > agentWorkspaceInheritance`，已用 stash 在干净基线复现）、`generate:validators` 编译新出站 schema 成功、`build:client` + 全 workspace `typecheck` exit 0 / 0 error、lint + format 干净。

change review：1 个阶段 2 轮，reviewer = Paseo agent `dfa8546a`（codex/gpt-5.6-sol · max，异构最强，受管理结构化委派，无回退）。轮 1（指纹 `7a7f3bd0…`）2 blocking + 2 important；轮 2（指纹 `77ac819b…`）全部 resolved，结论**可合**，无新发现。

### 实现决策（设计文档在 active 期间不改，决策记录在此）

- **广播命名改用 dotted**：设计 §4.2/§4.3 写的是 `team_update` / `chat_room_message`，实现为 **`team.update`** / **`chat.room.message_posted`**。依据：`docs/rpc-namespacing.md` 明令不再新增 flat 名，且仓库最新广播已是 dotted（`agent.provider_subagents.update`、`project.update`）。DEC-8 的 revision / authoritative replacement 语义不变。ITEM-6 消费这两个名字。
- **订阅协议细化（ITEM-3 必须遵守）**：设计 §4.3.2 只说"cursor 增量补齐"，未给入口。实现冻结为——请求 optional `afterCursor`、响应必填 `hasMore`；不带 `afterCursor` 返回最新 `limit` 条，带则返回该 cursor 之后的升序增量；`hasMore` 为真表示 gap 长于一页，客户端用刚得到的 cursor 继续拉，期间实时广播按 cursor 合并。缺这个入口会在"断线期间新增消息数 > 首屏页大小"时永久丢消息（review 轮 1 blocking 2）。
- **COMPAT 标签只打在真 shim 上**：`features.teams`、`features.chatRoomSubscriptions`、两个 `CLIENT_CAPS` 是可删除的 gate，标 `v0.3.0` + 2027-02-06。`ChatRoom` 所有权字段与 `ChatMessage.author` 的 optional 是**永久** wire 形态（协议既禁止 optional 翻 required 也禁止删字段），不打标签；将来要删的是 daemon 的 `authorAgentId`/`author` 双写逻辑，标签归 ITEM-3 的那段代码。
- **`create_agent` 的 `teamRole`（DEC-13）留给 ITEM-4**：它是 agent 工具目录的入参，不在 protocol 的 team/chat schema 范围内。

### 环境事实（后续子项复用）

- worktree 首次 `npm install` 会因 electron 二进制直连官方源超时而整体回滚；用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` + 本机代理 `127.0.0.1:7890` 可装成。
- 新 worktree 未构建时，pre-commit 的全量 typecheck 会因跨包 dist 缺失而报大量 TS2307；先跑 `npm run build:server`（含 highlight/server/cli）与 `npm run build:client`。
- 跑测试用 `./node_modules/.bin/vitest`；`npx vitest` 会解析到 npx 缓存的版本并因根 `vitest.config.ts` 的依赖而失败。

## ITEM-2 · server 基础改造（完成 2026-08-06）

交付：AgentManager 多订阅者记录变更事件流（`AgentRecordChange`：archived/unarchived/labels_changed/deleted/turn_settled + `onAgentRecordChange` 返回 unsubscribe，替换原单槽 `setAgentArchivedCallback`，ScheduleService 迁移）；`turnOutcomes`（optional capped 100）与 `activeTurn`（带 daemon run 标识、startup 陈旧清除）持久化 + `whenTurnStateSettled` 屏障；`AgentStorage.mutate` 队列内读-改-写；deletion guard（`registerAgentDeletionGuard`/`assertAgentDeletable`/`AgentDeletionRefusedError`，挂在删除 RPC 首个副作用前）；指定 id 创建的冲突保护与 `reuseIfOwnedBy` 复用判定 + per-id 串行；`team/team-store.ts`（原子写、per-id 与 per-key 串行、损坏容忍、idempotency 索引）。

证据：`vitest run packages/server/src/server/{agent,team,schedule}/ session.test.ts --exclude "**/*.e2e.test.ts"` → **1936 passed / 0 failed**（21 skipped）；`npm run typecheck`（全 workspace）exit 0；lint + format 干净。基线核验：改动前 agent-manager.test.ts 为 153 passed / 0 failed（stash 验证）。

change review：1 个阶段 3 轮（上限），reviewer = Paseo agent `dddac5db`（codex/gpt-5.6-sol · max，异构最强，受管理结构化委派，无回退）。轮 1（`4e1af3c5…`）3 blocking + 2 important；轮 2（`2189e4da…`）B3/I2 resolved，其余未闭合 + 1 new important + 1 nit；轮 3（`cdcb8283…`）I4/N5 resolved，B1/B2/B3 仍 unresolved 并给出明确方向。轮次已尽，按 cs-feat 不再对轮；三项均按 reviewer 方向修复后交 owner 裁决，owner 于 2026-08-06 裁决接受并确认下述两处判断。

### 实现决策（设计文档 active 期间不改，决策记在此）

- **DEC-14 的顺序保证落在 `turn_settled` 事件链内**：热路径实测对 `await` 敏感（前台 run 跟踪、usage basis 轮转、replacement 三处观察其时序，加 await 会打破 4-5 个既有测试）。故 `settleTurnRecord` 是一条 detached 链：先 `await recordTurnOutcome` 且**仅在确实写入时**才派发 `turn_settled`，订阅者收到事件时 outcome 必然已落盘。
- **`whenTurnStateSettled(agentId)` 是三态判定的前置屏障**：ITEM-4 的 ledger 与兜底扫描在读存储判定 turn 命运**之前**必须 await 它；它在写入失败时 **reject**，调用方据此延后重试而不是就地结算。缺这一步会把运行中的 turn 误判为 `unknown`。
- **所有"非替换语义"的记录写入必须走 `AgentStorage.mutate`**：队列外 read-spread-upsert 会让并发写互相擦除，且 `carryForwardRecordOnlyFields` 只能救 `undefined`、救不了陈旧的显式值。已改：metadata/label、live archive（`markRecordArchived`）、`archiveSnapshot`、`unarchiveSnapshot`、`setTitle`、session 的 attention 清理。`archivedAt` 的保留也从队列外移进 carry-forward。后续子项新增写路径时沿用此规则。
- **owner 裁决确认的两处收窄**（reviewer 建议改、owner 接受现状）：① stored-but-not-live 的复用以 `AgentAlreadyExistsError`（携带记录）表达，而非 discriminated result——调用点仅 ITEM-4 一处且必然要写分支，改 result 类型会污染所有既有调用方；实际加载归 ITEM-4。② config 匹配只比 provider + cwd（agent 身份），不比 settings（可变配置，其变化不改变"是不是同一个 agent"）。
- **遗留 nit**：`onAgentRecordChange` 的 API 注释仍笼统称"触发操作等待订阅者"，与 detached 的 `turn_settled` 不符（`architecture.md` 已精确区分）。reviewer 标为可接受，下次触碰该文件时顺手修正。

### 经验（后续子项复用）

- 动核心文件前**先在干净基线跑一次目标测试文件**再归因。本子项一度把 4 个失败当作预存在，实际全是自己引入的。
- 跑回归时明确排除 `*.e2e.test.ts`：`*.real.e2e` / `*.local.e2e` 需要真实 provider 凭据或本地资源，混进来会产生 9 个与改动无关的失败。
- 测试的失败注入点会随实现路径迁移而**静默失效**（本子项 cascade 测试原本 spy `upsert`，写路径改走 `mutate` 后测试假绿）。改写入路径时要检查现有注入点。

## ITEM-3 · chat 改造（实现完成，待变更评审）

已完成并提交（均为 checkpoint，非里程碑）：

- `6ae83dc42` 分文件存储 + DEC-9 迁移状态机。`$PASEO_HOME/chat/rooms/{room-id}.json` + `.migrated` marker，per-room 写队列；迁移顺序 写全部 room → rename `.bak` → 写 marker，7 个场景测试（全新安装、完整迁移、第 k 个房间后中断、rename 后 marker 前中断、marker 已存在时 legacy 重现、重复启动、损坏 legacy）。
- `cdfb871d9` author 模型 + `post()` 写入边界 + `ChatMentionNotifier` 端口。旧消息读回按 agent 归属；人类作者不进 `listRoomPosterAgentIds`（其 id 是 clientId，交给 mention fanout 会去找不存在的 agent）。

已完成的后续提交：

- `f779113eb` mention fanout 入 service。`ChatMentionHandler` 两阶段：`validate` 在写入前可拒（mention 风暴仍是拒绝，不是"存了但没人通知"），`notify` 在写入后（此时消息已存在，失败不能告诉作者没发出去）。`resolveAgentIdentifier` 从 Session 私有方法抽成 `agent/resolve-agent-identifier.ts` 模块，session 与 fanout 共用，行为不变。
- `ff29f8c25` 房间所有权。指定 id/owner 幂等创建两分支（同 owner 复用 / 异 owner 拒绝，无 owner 的占用 id 也拒绝）、owner 专用 `discardOwnedRoom`（已不存在视为成功）、通用 delete 拒绝有 owner 的房间。
- `71b7477ad` service 层订阅seam：`readRoomPage`（page + cursor + hasMore）与 `onRoomMessage`；抛异常的订阅者既不丢消息也不阻塞其他订阅者。
- `240a9c25c` session 层订阅。按物理 socket 保存与清理，广播按 socket 门控 `CLIENT_CAPS.chatRoomSubscriptions`（同一 session 可挂不同版本的 socket）。订阅先注册再发首屏响应，关掉两者之间的窗口。dispatch 挂在 `dispatchAgentTimelineMessage`——其余 chat dispatcher 不接 `source`。
- `cfd3886a7` DEC-10 唤醒不打断 + 分文件损坏隔离。

### DEC-10 的实际状态（原实现违反）

接手时 mention 走 `sendPromptToAgent` 默认 `replaceRunning: true`，会取消 running agent 正在跑的 turn；`isChatMentionTargetEligible` 只排除 archived/error/internal，**不含 running**。两处都改：

- 新增 `isChatMentionTargetWakeable`——live 优先（stored 记录是 turn 边界的快照，可能滞后两个方向），无 live entry 即无内存会话，正是该唤醒的那个。
- `sendPromptToAgent` 新增 `replaceRunning` 参数（默认 true 保持既有行为），mention 是唯一传 false 的调用方，关掉"判定后 turn 才启动"的竞态。

### 实现决策

- **方法名 `post` 而非设计文档的 `postMessage`**：lint 规则 `unicorn/require-post-message-target-origin` 把任何该名字的调用当作 `window.postMessage` 报错（6 处）。重命名比每个调用点加 disable 干净。
- **`dispatchMessage` 已在第三轮评审中收为 `private appendMessage`**：`post` 是唯一写入边界，全部调用方都切过去了。
- **notifier 失败不影响投递**：消息已在房间里，让 post 失败会告诉作者"没发出去"，比漏一次通知更糟。

### 验收要点覆盖

| 验收点                               | 测试落点                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| subscribe 首屏 + cursor 增量无漏无重 | `chat-service.test.ts` "room pages and live subscription" 5 例 + "a page taken now lines up with the cursors that follow it"                                        |
| socket 断开清理订阅                  | `session.test.ts` "stops forwarding once the socket goes away"                                                                                                      |
| 混连只达新 socket                    | `session.test.ts` "does not forward to a socket that never claimed the capability"（变异测试验证：移除门控行即失败）                                                |
| owner 房间拒绝通用 delete            | `chat-service.test.ts` "refuses a generic delete of an owned room"                                                                                                  |
| 指定 id/owner 创建幂等两分支         | 同上 "returns the existing room when the same owner asks again" / "refuses an id that belongs to a different owner" / "refuses a taken id that has no owner at all" |
| 分文件损坏隔离                       | `chat-service.test.ts` "damaged room files" 3 例（坏 JSON、结构不符、名字释放）                                                                                     |
| 迁移全状态 + 崩溃注入点              | `chat-storage-migration.test.ts` 7 例                                                                                                                               |
| mention 四分支                       | `chat-mentions.test.ts` "waking a mentioned agent" 4 例 + `agent-prompt.test.ts` "leaves a run in flight alone when replaceRunning is false"                        |
| 旧 `authorAgentId` 兼容              | `chat-service.test.ts` "treats a message written before the author model as an agent"                                                                               |

### 独立变更评审（codex，fresh）

结论"不满足契约"，5 条 finding，其中 4 条 blocker。已全部处理（`8d794e956`），每条都先有失败测试：

| finding       | 实质                                                                                                                                   | 处置                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 迁移        | 部分迁移后 legacy 变更被跳过丢消息；**一个坏房间导致整个 payload 校验失败后仍写 marker，全部有效房间永久丢失**；坏 JSON 抛异常阻止启动 | 不跳过重写（`6ec77a84a`）；房间逐条校验；`absent`/`unreadable` 判别，unreadable 不写 marker |
| 2 订阅        | 读页→注册之间丢消息；按房间名 unsubscribe 无效但回成功；socket 中途断开后订阅被重建且无人清理                                          | 新增 `resolveRoomId`，先注册后读页；unsubscribe 也解析；注册前校验 socket 仍活              |
| 3 cursor      | 并发 post 全部拿到同一 cursor（实测 `[3,3,3]`），客户端按 cursor 去重会丢消息；`afterCursor` 超界原样返回                              | cursor 取自 `messages.push` 返回值；超界钳制                                                |
| 4 DEC-10      | stale stored `error` 否决 live idle（恢复后的 agent 永不再被 mention）；`replaceRunning:false` 测试是装饰性的                          | `lastStatus` 让位 live，`internal`/`archivedAt` 仍由 stored 权威；测试改注入真实抛错        |
| 5 所有权/边界 | 同 id 同 owner 异配置静默返回旧房间；`ownerKind` 无 `ownerId`；`dispatchMessage` 绕过 fanout                                           | 配置冲突报错；owner 必须成对；`dispatchMessage` → `private appendMessage`                   |

**未接受的一半**：评审主张 `error` 状态的 agent 应可唤醒。eligibility（要不要通知）与 wakeability（通知是否启动 turn）是两个问题，排除 error 是改动前既有的产品行为，DEC-10 的"可唤醒"只管后者。已在复核请求中说明并请其按 epic 原文反驳。

**评审未发现、自查发现的**：旧格式消息读回时 `author` 为 undefined——原测试只覆盖了写入侧兜底，读取路径无兜底。加 `withAuthor` 在加载时补齐（带 COMPAT 标签）。

### 第二、三轮复核

同一 reviewer 又跑了两轮，每轮都找到真 blocker。全部接受并修复（`28da9837a`、`d823059c1`）。

**第二轮**（5 条）：unreadable legacy 只是不写 marker 但仍允许写入，新房间会被后续迁移抹掉 → 加只读状态；legacy 是全集不是上界，其未列出的 room 文件要删（降级期间删的房间会复活）；post 排队期间房间被删，其 persist 删文件反被当成写成功 → 检查房间仍在；订阅失败不回滚、按名 unsubscribe 无效 → 回滚 + 房间移除广播；`withAuthor` 伪造 agent 身份 → 删除。

**DEC-10 我判断错了**：我主张 eligibility 与 wakeability 分层、error 不该被通知。reviewer 给出 `docs/refactors/agent-teams-design.md:222` 与 epic:44，两处都明确列出 live `idle/error`、stored `closed/idle/error` 为可唤醒。契约写死了状态集合，我的分层论证不成立。已按契约改，并撤掉锁死错误行为的测试。

**第三轮**（5 条）：**roomId 未校验导致路径穿越**（`../../teams/victim` 可写/删 chat 目录外文件）→ 限定单路径段 + 文件名与 id 必须一致；id 复用时"存在"≠"同一个房间" → 引入 incarnation（创建与删除都递增）；removal 事件在 await 后才发，期间重建会误伤新订阅 → 与删除同步发布；迁移清理的 readdir 失败被吞 → 只忽略 ENOENT，否则中止在 rename 前；`listRoomPosterAgentIds` 把无 author 的旧消息当 agent → 只认明确标记为 agent 的。

**一处诚实标注**：id 复用竞态靠不变式论证而非测试——检查点落在重建前还是后由微任务顺序决定，没有可注入的延迟点。保留的测试覆盖可观察规则（复用 id 的房间从空开始）。

### 后续执行约束：保持 upstream 可持续同步

本仓库是 `team-harness/paseo` fork，upstream `getpaseo/paseo`。冲突成本 ≈ 删改的既有行数 × 该文件在 upstream 的变更频率。实测近三月 upstream 提交数：`session.ts` 136、`messages.ts` 81、`agent-manager.ts` 61、`bootstrap.ts` 60；而 `chat-service.ts` 仅 3、`chat-schedule-loop-session.ts` 1。

ITEM-4 起遵守：

1. **核心文件只加不改**。新增 case/方法/字段可以；重命名既有 API、搬走既有逻辑不行。已违反两处（`agent-manager.ts` 的 `setAgentArchivedCallback` 被替换、`session.ts` 的 `resolveAgentIdentifier` 被搬走），用户认可后续再补薄壳。
2. **逻辑进 `server/team/`，`session.ts` 里只留 dispatch 转发**。
3. **必须改既有函数时留一行 delegate**，把冲突面从几十行压到一行。
4. **不动既有持久化格式**。chat 存储改造是这轮唯一的存量数据改造，侥幸落在 upstream 低频文件上。
5. **新功能测试写新文件**（`session.team.test.ts` 之类），不要往 `session.test.ts` 塞——它是 upstream 最热的文件。
6. **通用性修复推回 upstream**：路径穿越、cursor 重复、mention 打断 running agent 都是 upstream 自身的 bug，推回去才能永久消除冲突源。

## ITEM-4 · TeamService（完成）

十二个切片，200 个测试在 `packages/server/src/server/team/` 下。

| 提交        | 内容                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `c9811c46a` | 创建事务（DEC-2）：计划先落盘、分阶段、幂等键 + 持久化指纹、并发共用一次执行                                        |
| `67c4c683d` | 生命周期：archive / removeMember / DEC-12 hard delete 收敛 / DEC-11 unarchive 统一规则                              |
| `f6802051b` | ledger（DEC-3）：assignment 状态机、同 assignee FIFO 且至多一个 in-flight、结算与入队同一写、delivery 按内容派生 id |
| `ab3b0583d` | 派发泵：无抢占契约、三态结算、每趟返回"是否还有未决"供兜底扫描                                                      |
| `5ca1ea56b` | 启动对账器（§5.7）：creating 续跑 / archiving 先 evict 再续 / failed 一次性清理 / active 校验                       |
| `847ea72c4` | 招募两阶段事务（DEC-13）：座位与完整意图同一写、每步 lifecycle fence、对账重放                                      |
| `218032537` | `team.*` 五个 RPC + `team.update` 广播，全部经 `toTeamSnapshot` 投影                                                |

### 实施中的判断

- **store 接受预分配 id**：设计 §5.2 要求"预分配全部 ID"，而房间内部名是 `team-{teamId}`——若 id 由 store 生成，计划就无法在首次写入时完整落盘。`NewTeam.id` 改为可选。
- **per-team 串行**：创建计划、生命周期操作、泵各自有队列。资源级幂等是崩溃恢复的保证，不该被用来兜并发。
- **对账器快照陈旧是真 bug**：`evictAgentsThatCameBack` 原先用入口快照判断，会覆盖同一趟里前面步骤刚关闭的 entry。改为重新读取。
- **变异测试验证了七处不变式**：派发门控、running turn 不结算、容量预留、fence 取消、wire 投影、对账 lead 缺失不重建、对账 eviction 顺序。每处移除后对应测试都转红。

### 收尾三批（`1788d2a05` 起）

| 内容           | 落点                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------- |
| agent 工具     | `team-tools.ts`——`assign_task` / `team_status` / 三个 chat 工具 + `create_agent` 招募钩子 |
| 兜底扫描       | `team-scheduler.ts`——只在"还有未决"时排下一趟，空账本不留定时器                           |
| 组合与接线     | `team-runtime.ts`——网关、事件订阅、删除守卫、工具注册；daemon 侧只多一次调用              |
| 三态屏障       | `team-turn-lookup.ts`——判定前先 await `whenTurnStateSettled`，reject 则不结算             |
| 真组件集成测试 | `team-runtime.test.ts`——真 AgentManager / AgentStorage / ChatService                      |

**上游触点**：`bootstrap.ts` +1 次调用、`session.ts` 一行分发 + 一个 emit、`websocket-server.ts` 追加末位参数、`paseo-tools.ts` 三处（schema 扩展、钩子调用、`registerExtraTools` 通用缝）。

### 第八轮复核：8 条 blocker，全在 runtime 网关

新 reviewer、新血统。全部属实并已修复：

1. **标签键自造**——runtime 里另写了一套 `paseo.team.id`，protocol 是 `paseo.team-id`。幂等创建认不出自己建的 agent，对账在首次启动就给每个成员补上一对假标签。
2. **`archiveAgent` / `setLabels` 要求已加载**——成员是懒加载的，重启后归档在第一个成员上抛错，team 永久卡在 `archiving`。改走 stored-capable 路径。
3. **标签是 patch**——删除要写 `null`，写子集只会合并，什么都没删掉。
4. **turn id 读早了**——`startAgentRun` 返回时 turn 还没开；读到 null 被泵当作"provider 拒绝"，同一 assignment 每趟重派，成员每趟真执行一次。
5. **delivery 确认信号取自同一字段**——要么永不确认（lead 反复读到第一批、再没有第二批），要么在静默 no-op 后确认（丢完成通报，违反"无丢失"）。
6. **成员身份按"出现在 roster"判定**——离队的 agent 仍能读写原 team 房间，且再也建不了 agent。`removed` 是历史。
7. **`create_agent` 宣传了 `teamRole`/`inheritTeam` 又拒收**——普通路径是 strict 解析。在委派缝上剥离。
8. **事件回调死锁**——发射方 await 监听器，而监听器触发的 team 操作要拿 per-team 锁，归档 team 与自己死锁。改为不 await。

另两条 should-fix 同批修复：pass 进行中到达的触发被丢弃（改为让该趟再走一圈）；泵在首次对账完成前就可达（加 `reconciled` 闸门）。

再一批 should-fix：`features.teams` 从未广播；创建/退队的 `team.update` 只发给发起方；招募没写 parent label；assignee 离队后 queued 任务永远悬挂（改为结算 `canceled`）；唤醒规则两份实现合一，stored 分支改问 `activeTurn` 而非会陈旧的 `lastStatus`。并移除了契约没要求的"role 必须唯一"。

**教训**：这 8 条全部藏在 `team-runtime.ts` 里，而该文件当时零测试——理由是"它只是组合，正确性靠被组合的单元"。不成立。网关不是组合，是两份契约之间的适配层，而"方法没做到接口承诺的事"对提供该方法的假替身完全不可见。补的 `team-runtime.test.ts` 用真组件跑，变异验证四处（归档路径、标签清除、turn 屏障、创建复用）全部转红。

### 独立变更评审（codex，同一 reviewer，四轮）

三轮共 13 条 blocking，全部修复。每轮都挖出上一轮修复留下的更深一层问题——这块状态机的交错面确实大。

**第一轮**（5 条）：ledger 读失败用空态覆盖导致永久丢失；pump joiner 拿到陈旧的"无工作"；归档把所有失败当"已消失"；removed 成员会被复活；创建与生命周期事件不共用锁。另：指纹只排序顶层 key；招募只 fence team lifecycle 不 fence 自己的 entry。

**第二轮**（4 条 + 1）：lead 归档未持久转 archiving（事件后半段崩溃则 team 永久 active）；创建重放不持锁；招募的最终校验与清意图是两步；损坏 ledger 静默报告"无工作"；对账看不见 labels。另：lead role 指纹与 plan 不一致。

**第三轮**（4 条 + 1）：创建仍会为已归档 team 建资源（守卫只护住记录不护住资源）；对账跳过 lead 导致少一态；重放把"已被别的 pass 提交"当成"已失效"从而归档刚招募成功的 agent；readability 是 TOCTOU；settings 非 JSON 值会让指纹不可判定。

**我犯的三个错，都是 reviewer 抓到的**：

1. DEC-10 的 error 状态——我用产品直觉推翻了契约白纸黑字的状态集合。
2. 锁测试用了两个 TeamService 实例＝两把锁，测了个寂寞。
3. 崩溃测试用抛异常模拟崩溃——异常被 catch 转成 `failed`，七个崩溃点没有一个走到恢复路径；删掉整个 `creating` 恢复分支测试仍全绿。改成"把记录放回 kill 会留下的样子"后才真正生效。

### 崩溃窗口覆盖（`team-crash-recovery.test.ts`）

创建的七个副作用点各一条（room、三个 agent、三条简报），重启用全新 store+service，断言世界里每样恰好一份。ledger 四个窗口：落账未发、provider 已接受未记账、turn 已终态未结算、已通报未确认。

### 第九轮复核：4 条 blocker，全是"用不回答该问题的东西做判断"

1. **归档靠错误消息判定 not-found**——`Unknown agent` 也是"live 查不到"说的话，teardown 与 team archive 交错就会把还在跑的成员记成已归档。改为问记录。
2. **唤醒只看 `activeTurn`**——关闭一个跑到一半的 agent 只清内存不清盘，于是 `kill_agent` 之后该 agent 在本次 daemon 运行内永远唤不醒。回到 DEC-10 的 `lastStatus`，`activeTurn` 只用来救"崩溃留下的 running"。
3. **team 记录读不出被当成"人都走了"**——store 对损坏文件是跳过策略，把这份沉默读成离队会把排队的真实工作全部取消。且 `archived` 成员按 DEC-11 可以回座，只有 `removed` 是终态。
4. **搭车的 pass 回答的是它可能没读到的账本**——这正是 runtime 测试不稳的原因。合并逻辑收进拥有账本的 pump：pass 期间到达的触发让它再走一圈，于是每个调用方返回时都知道有一趟 pass 可能看见了它的工作。

同批：单个 dispatch 抛错不再带走整趟 pass；out-of-band 接受成为第三种答案（结算 `unknown`，而非永远重发）；`assign_task` 不再等泵；事件处理进串行队列（`serial-queue.ts`）并且两处泵唤醒改为不等待——否则一个 handler 会把它后面的所有事件都堵住。

**这一轮最贵的教训**：`team-runtime.test.ts` 的"事件保序"用例反复失败，追下去发现的不是测试问题，而是"handler 里等泵、泵等首次对账"这条真实的阻塞链。测试写不稳的地方，往往是产品里有条等待链没想清楚。

---

## ITEM-5 · CLI + daemon E2E（完成）

`paseo team create/ls/inspect/archive/remove`（`packages/cli/src/commands/team/`）+ 14 条 daemon 级 E2E（`team-e2e.e2e.test.ts`，真 daemon、真 WebSocket、两个 provider adapter），已纳入 `test:integration` 跑 CI。

**上游触点**：`cli.ts` +4、`client/src/index.ts` +2、`cli-surface.test.ts` +19、`architecture.md` +1、`bootstrap.ts` 暴露 `teamRuntime`。

### 评审：3 blocker，两条是我的测试在自欺

1. **mention 唤醒测试空转**——等的是 `status !== "running"`，而刚建出的 agent 是 `initializing`，这条件在简报还没开始时就满足了。于是后面看到的"它跑起来了"是简报那一趟。把 `postChatMessage` 整行删掉测试照样绿。改为读记录里的已结算 turn，断言 mention 开出的是**第二**趟，且没被点名的成员一趟都没多开。
2. **permission 测试只证明了往返**——断言 `resolved.requestId === request.id`，而 client 的关联逻辑本来就保证这点，只可能超时失败；没有任何东西检查这个答复意味着什么。改为两个成员同时请求、一允一拒，断言副作用：允许的工具跑了，拒绝的没跑。
3. **验收点名的派发闭环整块没做**——`lead 派发 → 成员完成 → 通报 lead` 在 daemon 级别一条都没有。补上：lead 调它自己注册的 `assign_task`，此后测试不再驱动泵，成员 turn 结束这件事本身触发结算与投递。为此 daemon 暴露了 `teamRuntime`（假 provider 走不到 MCP）。

**CLI 侧四条**：`--lead` 收的是 provider 而非 `role=provider`（daemon 无论如何会把 lead 的 role 覆盖成 `lead`，问了也是白问，而设计文档写的就是 `--lead codex/gpt-5.6-sol`）；补 `--idempotency-key`——没有它，socket 在 daemon 已提交后断开就会让用户多出一整个 team（一次请求六个 agent），这正是这把钥匙存在的理由；成员数不再把 lead 算进去；`inspect` 返回 team 本身加名册，否则脚本读不到 `lifecycle`。

**教训**：这两条空转断言都是"等一个此刻恰好为真的状态"而不是"等一件已经发生的事实"。turn 的终态在记录里，状态只是一瞬间的读数。

---

## ITEM-6 · app 运行时 + 新建表单（完成）

`runtime/team-sync/`（replica + selectors + TeamSync）、`teams/`（表单模型、加载态、提交、两个适配器）、`components/teams/new-team-sheet.tsx`，76 个测试。

**epoch 缓存重放直接复用了 directory-sync 的 `DirectoryTransactionOwner`**——那本来就是这道栅栏，再写一个只会多一处会漂移的实现。

### 评审：3 blocker，同一形状——"看起来是那个答案，其实不是"

1. **同 key 重试拿回的可能是一个创建失败的 team**。原代码只看"team 非空"就报成功，把死 id 交给调用方，且永不轮换 key，之后每次重试都指向同一具尸体。
2. **daemon 用"空列表 + 错误消息"回答读失败**。把它当权威集合提交，会因为一次目录读出错而抹掉客户端持有的全部 team。
3. **抛错的 list 没有任何地方记录错误，也没接线去听**。连接时一次超时就让界面静默地等到这条连接结束。

接线上还有两条更隐蔽的：`serverInfo` 在连接之后才到，把"还不知道"读成"不支持"会在问出口之前把问题定死（现在支持性是三值的，并由 serverInfo 落地重新触发）；`reconcileServerId` 只销毁不重建，teams 会永远停在 connecting（现在注册与销毁各走一个 helper，同时把 host-runtime 这个上游高频文件的合并面缩到一处调用）。

另外补齐了 forms.md 规则 3/4——provider 解析是模型状态而非外壳的 effect，且按 host 隔离。

---

## ITEM-7 · app team 面板（完成）

room 主区 + 名册 + 权限聚合条 + compact 适配（`components/teams/team-panel.tsx`、`team-room.tsx`）、tab target `{kind:"team"}` 走 panel registry、deep-link resolver `/h/:serverId/team/:teamId`、侧栏 team 条目，加一条真浏览器 E2E。

**上游触点**：`workspace-screen.tsx` 两处、`sidebar-workspace-list.tsx` 与 `sidebar-status-list.tsx` 各一行 JSX + 一个 import、`register-panels.ts` +2、host `_layout.tsx` +1、`fake-agent-client.ts` 三处（多选权限请求）。面板自己注册进 registry，没有改 workspace-screen 的分发。

### 评审：4 blocker + 一处契约偏离

偏离最贵：契约 §6.3 写的是"关闭 lead 的 tab 不走归档"，我做成了"确认后归档"，并且只在提交信息里论证了这个改动——评审指出**确认对话框不是那个差别**：team 从面板结束，因为那是唯一能说清代价的地方。现在 lead 的 tab 关闭即走人，批量关闭问同一个规则（批量归档一样彻底，只是更安静），并提示归档在哪。

四个 blocker：权限行自造 Allow/Deny（把 N 选一答成选项一，带 bespoke id 的请求会被解析成"取消"）；面板从不读 `team.lifecycle`（归档后按钮全在原地，于是归档一个 team 唯一可见的结果是什么都没变）；两个破坏性动作没有 `confirmDialog`（design.md §14 明令，且 team 级 unarchive 是 Phase 3 未做项）；gateway 测试两个方法共用一个 `vi.fn`，"移除调用 removeTeamMember"对着归档的实现也绿。

### 侧栏那次：测试比我更清楚哪个组件在渲染

team 行加进了 `sidebar/sidebar-workspace-row.tsx`——**没有任何地方 import 它**。真正画行的是 `sidebar-workspace-list` 和 `sidebar-status-list`。单测不会发现（没有组件测试），typecheck 也不会（文件本身合法）。是浏览器 E2E 找到的，而它能找到是因为它先开页面再建 team：先建 team 只会证明连接时那次列表读。

顺带纠正了一个我自己的错误推断：我以为 app 从未声明 teams capability，加了两行；实际 `DaemonClient` 的 hello 默认就带着它们，两行是重复的，已删。

### 第二轮评审：5 blocker，四个是"测试全绿"下的空洞

1. **权限行对大多数 provider 画不出按钮**。上一轮把"自造 Allow/Deny"修过了头：只渲染 `request.actions`，而 Claude 只给 plan 请求带 actions，普通工具权限的 actions 是 `undefined`。于是 team 面板上出现一行"reviewer: Bash"、零个按钮，同时 tab 和侧栏挂着永久的 attention 点。规则现在收敛到 `resolvePermissionActions`，agent-stream 与面板共用：有 actions 用它的，没有就回落到标准两项，question 一个都不给。
2. **两个确认框的取消按钮显示 `common.cancel` 字面量**。键是 `common.actions.cancel`，i18next 缺键返回键名。没有组件测试、E2E 也从不按这两个按钮，任何东西都发现不了。
3. **room 没有发言入口**。Epic 目标第二条与 §10 都点名了 post 三态，它就是不存在——既没实现也没改契约，只是消失了。
4. **§6.4 去重规则是有测试、零调用点的死代码**。招募的 recruit 挂在 lead 的 subagents track 上，带着 track 自己的生命周期动作——正是面板该独占的那些。
5. **完成的成员被读成"等你输入"**。`requiresAttention` 结束时也会置位，而 `needs_input` 说的是权限，`deriveAgentStateBucket` 一直就是这么定义的。

should-fix 里两条同一形状：路由把"handshake 还没到"读成"daemon 太老"（冷启动 deep link 会说"升级你的 daemon"，且不给重试）；client 为空时动作与作答静默返回（确认过的破坏性动作什么都没发生，读起来像成功了）。

**变异测试第二次救场**：路由的两个 guard 对调，8 条测试全绿——两条相关用例分别覆盖 `supported:true+connecting` 与 `supported:false+online`，而现实中真正出现的组合 `supported:false+connecting` 一条都没有。E2E 也是：第一版用 mock provider 的 plan 请求（少数带 actions 的），把"只渲染 request.actions"这个 blocker 变异回去照样通过。给 mock 加了一个不带 actions 的工具权限请求后才抓得住。

---

## 最终验收评审第一轮：一个 blocker 让 Epic 的第一条目标不存在

`NewTeamSheet` **没有任何渲染点**。ITEM-6 造了 sheet、表单模型、provider 解析、提交路径共约 840 行，全都测过；ITEM-7 造了面板。把 sheet 挂进 workspace 这一步，两个子项都以为是对方的。于是"新建面板一键创建 team"在成品里不存在，只能走 CLI 或裸 RPC。三条浏览器 E2E 全部 `workspace.client.createTeam(...)` 直接打 daemon，所以谁也发现不了。

它同时是全仓唯一一个零 i18n 的 team 组件——**没被渲染过所以没人发现**，两件事是同一件事。

另外两条：

- `team.update` 的按 socket 门控零测试。看起来像那条测试的 E2E 连了三个 client，而那是三个 session；DEC-5 说的是**同一 session 的两条 socket**，把循环换成 `this.emit` 广播给全部 socket 照样绿。
- `failed` team 从不做 unarchive 补偿，尽管 §5.7 把它和 `archived` 写在同一条。daemon 停机期间被 unarchive 的成员，留下"entry 说 archived、agent 在跑"——DEC-11 宣称不存在的状态；而且 `create_agent` 的招募钩子会找到这个 failed team 并拒绝，这个 agent 从此再也招不了人。

还有一条隐蔽的：给 sheet 补文案时，插入脚本的 marker 匹配到了 `sidebar.workspace`，**整个 `teams` 命名空间落进了 `sidebar` 里**。面板与房间此前渲染的一直是键名本身，而没有一条断言看过那些文字——E2E 只断言了团队名（数据）和 testID。

## 验收评审第二轮：我自己的修复引入了一个 blocker

改 `selectMemberActivity` 去对齐 `deriveAgentStateBucket` 时，我给 `TeamMemberAgent` 加了 `pendingPermissionCount`，而 store 持有的是 `pendingPermissions` 列表——**没有任何调用点赋值过它**。selector 的入参是结构化的，缺的可选字段一路 `undefined`，typecheck 全程沉默；单测手工构造了那个 count 所以是绿的。结果：两个成员挂在权限上时，面板写"Working"，侧栏点是蓝的，tab 徽标从不变琥珀——聚合这个东西存在的唯一理由失效了。评审用真浏览器复现了它。

改法是让 selector 直接吃列表，并把测试的 fixture 建在 store 自己的 `Agent` 类型上：字段名对不上就是编译错误，不再是静默的 0。浏览器测试也加了一条"两成员被挡住时面板说什么"。

同轮还修了：`failed` 对账把要 evict 的成员先归档了（`archiving` 分支的顺序才是对的，且 `cleanUpFailed` 读的是这一趟开始时的快照）；建 team 的失败文案是硬编码英文；无 client 时提交静默无反应。

## 验收评审第三轮：可以验收

无 blocker。剩两条一行修复也带上了：lifecycle 分支的英文串（现在有自己的文案键，"key 指向一个没跑起来的 team"和"被拒绝"是两句话），以及我删 openCount 时连带删掉的 `serverId` key——计数器确实不改变行为，host 会。

**三轮验收评审的共同形状**：每一轮的 blocker 都不是"写错了"，而是"接线少了一环，而现有测试恰好绕过了那一环"。入口没挂载、门控没测同 session、聚合的输入名字对不上——三件事都在全绿的测试套件下活了很久。

### 待办

owner 验收 + QA 证据（docs/qa.md 六行平台矩阵，owner 已认领，模板在 epic 的「整体验收」节）。
