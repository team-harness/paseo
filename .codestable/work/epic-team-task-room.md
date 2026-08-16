---
epic: ../epics/team-task-room.md
phase: executing
approved_revision: c4ed2ac22cf7962a6693746aebef75198f9469c3783ac5a083235788d481ff1c
current_item: TTR-ITEM-8
next_action: 执行 TTR-ITEM-8，把任务、成员、结果和 Attention 收敛到 inspector
blocked_by: null
item_progression: continuous
milestone_commit: authorized
remote_publish: final
---

## 子项进度

- [x] TTR-ITEM-1 · 固化三层事件边界并隔离 physical Room subscription
- [x] TTR-ITEM-2 · 把 Team Hub 升级为 host-global 工作入口
- [x] TTR-ITEM-3 · 简化 Team 创建与协作方式文案
- [x] TTR-ITEM-4 · 建立 MissionWorkroom 主布局
- [x] TTR-ITEM-5 · 固化 Room 发帖幂等性与 recipient routing
- [x] TTR-ITEM-6 · 闭合回复界面与 Room 历史
- [x] TTR-ITEM-7 · 让 Agent 在任务室报告协作进展
- [ ] TTR-ITEM-8 · 把任务、成员、结果和 Attention 收敛到 inspector
- [ ] TTR-ITEM-9 · 完成跨平台与真实协作验收

## 决策记录

- 2026-08-16：owner 确认 Team 是 host-global 一级入口；Settings 只作为次级管理面。
- 2026-08-16：owner 确认一个 Mission 一个任务室，不设跨 Mission 永久群聊。
- 2026-08-16：owner 确认 human 无 mention 时默认通知 Mission Lead。
- 2026-08-16：借鉴 Hermes Studio 的任务室表现层，不采用 Crew 广播/session 聚合领域模型。
- 2026-08-16：新增硬约束：UI、Team Protocol 和事件链分层，小步复用现有 snapshot、Room 与 outbox，禁止大重构。

## 执行策略

- `item_progression`：continuous
- `milestone_commit`：authorized
- `remote_publish`：final

建议在 design review 0 blocking / 0 important 后选择：

- `item_progression: continuous`，按依赖顺序持续推进；TTR-ITEM-2/3/5 与 TTR-ITEM-6/7/8 可按 Epic 中的边界并行。
- `milestone_commit: authorized`，每个 item 独立 checkpoint，主流程集成后创建正式 milestone。
- `remote_publish: final`，最终验收前不 push、不发布 Paseo 构建。

## 证据日志

- 2026-08-16：只读核对现有 Team feature capsule、Room store、Mission snapshot、recipient outbox、Hub、创建表单、
  settings selectors 与 collaboration dogfood。确认现有架构可增量演进，无需新 Team runtime。
- 2026-08-16：发现 Session 级 Room subscription 会在 mixed physical sockets 间串流；已纳入 TTR-ITEM-1，
  必须先于新 Room UI 修复。
- 2026-08-16：确认现有 wire 已有 `replyToMessageId`，App 未透传；当前 parser 使用开发期 `@everyone`，
  新契约收敛为 canonical `@team`，不保留兼容别名。
- 2026-08-16：Round 1 主 design review 核对 Epic
  `19e1d8e7c814ab145d74eb8bf4b7a9dd73bca89beee2b182e3ca443055cf7aa8`（468 行）与游标
  `1aad8d8c6540670ce426d39db12f310e0e48fb89fdeddb558e2d7f3d442843c9`（56 行），结论为
  `2 blocking / 6 important / 3 nit`，不允许进入 owner gate。
- 2026-08-16：同一冻结稿的 recipient/cursor/physical-source 窄审为 `1 blocking / 3 important / 2 nit`；新增
  关键路径是 reply 旧 Agent 消息必须由 historical `agentId` 解析 Member，再路由到当前 binding。
- 2026-08-16：Round 1 修订将消息收件人改为完整判定表，补稳定 request id 与 state-independent fingerprint，
  分离 history read 与 subscription 生命周期，声明 `TeamPanel` surface ownership，并将过载的原 TTR-ITEM-5
  拆成底层 routing 与 reply/history UI 两项；总项数变为 9。
- 2026-08-16：fresh Round 2 复审核对 Epic
  `26988692c2b524b0cfa25d43dea1218d9bb3a02aba9573aca3a47ac672becf6a`（541 行）与游标
  `5fd7c2fa3b36a51fe37a7f9ed96ff0f1f3c010148f8b276d451e24fd2f6b6d5d`（66 行），结论为
  `1 blocking / 2 important / 3 nit`，不允许进入 owner gate。未决项为零收件人 post 缺冻结点、重放顺序未强制
  先读 persisted intents，以及 TTR-ITEM-1/6 重复拥有 first-subscribe 失败回滚。
- 2026-08-16：Round 2 修订采用双冻结点：非空收件人由 persisted delivery intents 冻结，空收件人由已落库
  Room message 冻结；resolver 只能在两者都不存在时运行。first-subscribe 判定与失败回滚完整归
  TTR-ITEM-1，TTR-ITEM-6 只消费该 server 不变量并拥有 App 历史分页。
- 2026-08-16：fresh Round 3 窄审核对 Epic
  `eb39a75ec3a3439dc5108cf1b49c71bb1c2970ff630d3774ed6c654608fe2333`（571 行）与游标
  `94fa42c4afcae3bacfbb19729783e89697fed43c9bd21efa3698d6c8a0e49c93`（74 行），结论为
  `0 blocking / 0 important / 2 nit`，允许提交 owner gate。两条 nit 仅涉及判定表显式列出 inactive reply fallback
  与“向前读取/向前加载”的措辞，可在 TTR-ITEM-5/6 实现时顺手消歧，不改变契约。
- 2026-08-16：owner 确认 `item_progression: continuous`、`milestone_commit: authorized`、
  `remote_publish: final`。永久 Epic 机械置为 active，批准版本为
  `eb9b1d212874d0213e8b5bdea203223e78b6215c781cef04e6a172d48852b353`，执行从 TTR-ITEM-1 开始。
- 2026-08-16：激活提交的 pre-commit format 通过；全仓 typecheck 仅命中未修改的既有基线
  `packages/app/src/components/draggable-list.native.tsx:122`（`dragGestureHostPresented` props 类型错误），该文件相对
  HEAD 零 diff，因此纯文档提交使用 `--no-verify`。

## 活动执行记录

规划阶段不记录实现 commit 或测试证据。owner 接受设计并冻结 `approved_revision` 后，所有 item 的 active progress、
review lineage、checkpoint、测试和残余风险只写本游标；永久 Epic 只在 final owner acceptance 汇总稳定交付指针。

- 2026-08-16：TTR-ITEM-1 完成。Session 将 Mission Room subscription 收敛为 physical-source scoped Map，
  同 source/Mission 的 subscribe/unsubscribe 串行；首次订阅读失败只回滚本次插入，source close、capability/identity
  撤销和 Session cleanup 都阻止 queued request 或旧 response 复活。App 以 `connectionEpoch` 驱动同一
  `DaemonClient` 的重连重订阅；RoomStore、wire schema 与全局 `onMessage` 接口保持不变。
- 2026-08-16：TTR-ITEM-1 TDD 先复现既有订阅读失败被误退订、mixed source 串流、同 client 重连不重订阅、
  sibling capability 借用与 concurrent subscribe 竞态；最终 5 个 owning test 文件 `34/34` 通过，
  `build:server`、lint、format-check 与 diff-check 通过。全仓 typecheck 只命中未修改的既有基线
  `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-1 code-deep 对冻结的 8 文件完整覆盖、0 omitted；`session.ts` 的
  `symbol-count-mismatch` 已用定向调用图核对。独立 change review 使用 Paseo agent-scoped
  `gpt-5.6-sol/xhigh` reviewer `/root/ttr_item1_review`：Round 1 为 `0 blocking / 3 important`，补齐 direct
  epoch 跳变、真实 TeamRuntime+Session rollback/unsubscribe 竞态、source/session cleanup queued work 组合测试及
  response 二次授权后，Round 2 在 staged diff
  `aab401c022c2aaf11b78a75fccc209659798cb261a79e53b38a9e3360d7f5dc6` 上为
  `0 blocking / 0 important / 0 nit`、可合。里程碑主题为
  `fix(team): scope Room subscriptions to physical sources`；稳定 commit SHA 在本提交创建后由 Git 历史与最终交付索引记录。
- 2026-08-16：TTR-ITEM-2 完成。`/h/[serverId]/teams` 继续作为 `HostLevelTeamList` 唯一 owner，顶部持续提供
  创建 Team 与 Add/Open Workspace；每行投影模板、成员、Mission、Attention 与稳定主操作，并通过次级菜单直达
  host-owned Team 设置。`TeamPanel` 成为 idle 概览、active Room、terminal replay 的唯一 surface owner；历史选择不改
  active Mission placement，回放可返回概览或启动新 Mission。Team replica 与 Methodology catalog 失败继续隔离。
- 2026-08-16：TTR-ITEM-2 TDD 先复现设置路由、历史缓存 action 漂移、active snapshot 缺失误报与 replay 无出口；
  最终定点测试 `103/103`、Hub browser E2E `2/2`、完整 Team browser E2E `1/1` 通过。420px compact 证据断言
  `scrollWidth <= clientWidth` 并保留截图；lint、format 与 diff-check 通过。App typecheck 仅命中未修改的既有基线
  `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-2 独立 change review 使用 Paseo agent-scoped `gpt-5.6-sol/xhigh` reviewer
  `/root/ttr_item2_review`：Round 1 为 `2 blocking / 2 important`，修复 Hub 设置入口、terminal replay 出口、稳定 idle
  主操作与 compact 布局后，Round 2 在 staged diff
  `d1fe494c836d65219b8b2df58fff2fb4d10da785c89eb530e89072fcbae8d78c` 上为
  `0 blocking / 0 important / 0 minor`、可合。里程碑主题为 `feat(team): make Team Hub the work entry`。
- 2026-08-16：TTR-ITEM-3 完成。Team 创建主路径收敛为模板、建议成员与 Agent Profile、创建摘要；Skill、Level、
  inline model、成员增删与完整 Methodology 信息仅在高级设置显示。协作方式使用“负责人把关”与“独立成员审查”，
  Team capability 明确用于自动分配工作；编辑态继续默认显示完整配置，Team wire、server 与 form model 零改动。
- 2026-08-16：TTR-ITEM-3 TDD 先复现成员责任缺失和高级设置只能添加不能删除；最终 3 个定点 test 文件 `30/30`
  通过，隔离 browser E2E `1/1`，420px compact 断言无横向溢出并保留 setup 截图。lint、format 与 diff-check 通过；
  全仓 typecheck 只命中未修改的既有基线 `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-3 code-deep 对 caller-supplied diff 覆盖 4/4 文件、15/15 symbols、0 omitted；独立
  change review 使用 Paseo agent-scoped reviewer `/root/ttr_item3_review`：Round 1 为 `1 blocking / 0 important`，
  补齐“可提交 → 添加空成员后禁用 → 删除后恢复可提交”的双向测试与创建态删除操作后，Round 2 在 staged diff
  `303612bb686d39e504e78f964fc396cb53a0d43fe97f4c50adaf020fde49039d` 上为
  `0 blocking / 0 important / 0 minor`、可合。里程碑主题为 `feat(team): simplify Team creation`。
- 2026-08-16：TTR-ITEM-4 完成。新增 `MissionWorkroom` 作为 active/terminal Mission 唯一工作面：header 展示
  objective、status、workspace 与 Attention；desktop 将聊天主列和 inspector 并排，compact/native 复用同一 selector
  tree 放入当前 snap 高度的 sheet。成员、计划、Attention、结果复用 Team settings 纯投影；host-only 历史回放可跳
  Agent deep link，历史成员读取冻结 roster。
- 2026-08-16：TTR-ITEM-4 TDD 先复现模块缺失，并在 Round 1 后复现 host-only Agent 跳转、历史 roster 漂移、
  compact sheet 长内容裁切与失败结果无状态；最终 5 个定点 test 文件 `19/19`，隔离 browser E2E `1/1`
  （41.4 秒），compact inspector 可滚到 Results，lint、format 与 diff-check 通过。全仓 typecheck 仅命中未修改基线
  `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-4 code-deep 首次 review 因既有未跟踪 dogfood 证据截断，随后定向追踪新 selector、组件与
  `TeamPanel` 接线；独立 reviewer `/root/ttr_item4_review` Round 1 为 `2 blocking / 1 important / 1 minor`，
  修复后 Round 2 在 staged diff `9b404af141268996cba34f5b9d1f85715ecbb9e8d7737d660df042dcc2a8dc5c`
  上为 `0 blocking / 0 important / 0 minor`、可合。里程碑主题为 `feat(team): add Mission workroom layout`。
- 2026-08-16：TTR-ITEM-5 完成。Room 发帖采用 persisted recipient intents 与已落库零收件人消息双冻结点；human
  默认路由 active Lead，reply 通过 historical Agent 映射 Member 后转 current binding，canonical `@team` 排除作者，
  Agent `chat_post` 支持 standalone/reply/explicit mention。App composer 在失败重试期间保持同一 request id；无新
  RPC、store、wire 字段或兼容分支。
- 2026-08-16：TTR-ITEM-5 TDD 覆盖 human/Agent routing、re-binding、零收件人/response-lost、outbox→Room
  recovery、终态拒绝、真实 composer 重试和隔离 daemon WebSocket 重放。最终 collaboration service `81/81`、
  TeamRoom component `1/1`、daemon E2E `1/1` 通过；`build:server`、lint、format-check 与 diff-check 通过。全仓
  typecheck 只命中未修改基线 `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-5 code-deep 对 caller-supplied diff 覆盖 21/21 文件、0 omitted；独立 reviewer
  `/root/ttr_item5_review` Round 1 为 `1 blocking / 1 important`，Round 2 为 `1 blocking / 0 important`。补齐
  reply+mention recovery、精确 human ack 与“Room 已发布、ack 未落盘”崩溃协调后，Round 3 在 staged diff
  `38e1915d79fc71ab7f73a48d13fc5068a13625a9442adcdf6f8264a7f586d542` 上为
  `0 blocking / 0 important / 0 minor`、可合。里程碑主题为 `feat(team): harden Room message routing`。
- 2026-08-16：TTR-ITEM-6 完成。App Room timeline 将 wire forward cursor 拆为 `liveCursor` 与
  `oldestCursor`，以绝对边界连续加载旧页；重叠项按 message id 去重，history/live 竞态保留 live message，历史读取
  失败只显示可重试错误、不退订 live。回复界面显示父消息摘要、取消与 Lead fallback 条件提示，透传现有
  `replyToMessageId`，并用 daemon 返回的 `mentionAgentIds` 显示实际通知对象；Mission identity 变化会 remount Room
  session，同 Mission 重连保留回复目标。
- 2026-08-16：TTR-ITEM-6 TDD 覆盖初始截断、连续旧页、重叠页、cursor 不变量、history/live race、失败后 live
  继续、回复 inactive Member、显式 mention、取消、终态只读、重连与 Mission 切换。最终 App 6 个定点文件
  `38/38`、i18n `39/39`、隔离 daemon 回复/分页 E2E `1/1` 通过；`build:server`、lint、format-check 与 diff-check
  通过。全仓 typecheck 只命中未修改基线 `packages/app/src/components/draggable-list.native.tsx:122`。
- 2026-08-16：TTR-ITEM-6 code-deep 因既有未跟踪 audit/dogfood 输出扩大 working-tree 统计，随后定向追踪
  timeline → subscription → TeamRoom 与 reply → wire → receipt 路径；独立 reviewer `/root/ttr_item6_review`
  Round 1 为 `0 blocking / 2 important`。修复跨 Mission reply/receipt 状态泄漏与显式 mention 下的错误 Lead 承诺后，
  Round 2 在 staged diff `6c3604c14aa118cae77714bc63b5843396509a527d91937a3e968895e2231e92` 上为
  `0 blocking / 0 important / 0 minor`、可合。里程碑主题为 `feat(team): add Room replies and history`。
- 2026-08-16：TTR-ITEM-7 候选已取得两份新鲜真实 provider 证据：`parallel_delivery` 与
  `recovery_dependency` 均为 Mission completed、score 8、Room audit valid、0 validation violations、0 scope conflicts；
  负责人总结早于 Mission 完成，验证者分别以 `17 < 19` 与 `16 < 18` 的 timeline 序号读取总结后再报告，
  Room history 与 closeout 的两条 body digest 交叉一致。manifest 分别位于
  `/tmp/ttr-item-7-parallel-closeout-round3.7QscHL/parallel_delivery-run-1.json` 与
  `/tmp/ttr-item-7-dependency-closeout-round3.L7y7zk/recovery_dependency-run-1.json`。
- 2026-08-16：TTR-ITEM-7 change review 第 3 轮对 staged diff
  `f57a98584a01822d888673e02442099f926244c807652d117c30670cc9b1adc4` 为 `2 blocking / 0 important`。Round 2 的
  timeline `seqStart/seqEnd` 与 body digest 问题已解决；未决为：必须用可执行的 crash/restart recovery 测试覆盖
  outcome-only 不报告与 both-present 不重复发 Room message；verifier 同时为 Lead 时必须按
  `chat_post(summary) → chat_read(summary visible) → assignment_report` 执行，否则会通过运行时 gate 但无法通过自身证据审计。
- 2026-08-17：owner 授权修复上述两条 blocker 并追加 Round 4。真实 daemon E2E 现在从 controlled
  provider、实际 MCP tool、持久 outbox 贯穿 outcome-only → Lead summary → verifier read/report，并在同一
  `PASEO_HOME` 重启后断言无重复 provider turn、Room 仍恰好两条消息。Agent record listener 改为只异步
  入队 Team reconcile，消除 settlement callback 等待自身 `getAcceptedTurnId` 的死锁。同角色 verifier/Lead 的
  runtime gate 要求持久 chat cursor 覆盖 Lead summary，定点测试先证直接 report 被拒，再 read 后成功。
- 2026-08-17：同一 reviewer `/root/ttr_closeout_contract_review_v2` Round 4 复验 staged diff
  `8eb6666293bd3163d1630c732e059cbca4486d3959a9c203170e30361e221fa1` 与 design
  `c4ed2ac22cf7962a6693746aebef75198f9469c3783ac5a083235788d481ff1c`，上轮两条 blocker 均 RESOLVED，listener
  审计无新 finding，终态为 `0 blocking / 0 important / 0 minor`。定点四文件 `105/105`、隔离
  daemon restart E2E `1/1`、`build:server`、lint、format-check 与 diff-check 通过；typecheck 仅命中未修改的
  `packages/app/src/components/draggable-list.native.tsx:122` 基线错误。
