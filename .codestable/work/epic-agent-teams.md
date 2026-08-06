---
epic: ../epics/agent-teams.md
phase: executing
approved_revision: 74667ea6e2b559834cbf8f6f7ec717d415917df36e718391620e39fae3935a79
current_item: ITEM-3
next_action: ITEM-3 续：把 session.ts 的私有 resolveAgentIdentifier 抽成模块函数，再把 chat/post handler 切到 chatService.post() 并在 bootstrap 注入 notifier
blocked_by: null
item_progression: continuous
milestone_commit: authorized
remote_publish: final
---

## 子项进度

- [x] ITEM-1 protocol + client schema
- [x] ITEM-2 server 基础改造
- [ ] ITEM-3 chat 改造
- [ ] ITEM-4 TeamService
- [ ] ITEM-5 CLI
- [ ] ITEM-6 app 运行时 + 新建表单
- [ ] ITEM-7 app team 面板

## 临时决策与证据

- canonical 设计：docs/refactors/agent-teams-design.md（v2，已经外部评审一轮，v1→v2 变更见其 §13）。
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

## ITEM-3 · chat 改造（进行中）

已完成并提交（均为 checkpoint，非里程碑）：

- `6ae83dc42` 分文件存储 + DEC-9 迁移状态机。`$PASEO_HOME/chat/rooms/{room-id}.json` + `.migrated` marker，per-room 写队列；迁移顺序 写全部 room → rename `.bak` → 写 marker，7 个场景测试（全新安装、完整迁移、第 k 个房间后中断、rename 后 marker 前中断、marker 已存在时 legacy 重现、重复启动、损坏 legacy）。
- `cdfb871d9` author 模型 + `post()` 写入边界 + `ChatMentionNotifier` 端口。旧消息读回按 agent 归属；人类作者不进 `listRoomPosterAgentIds`（其 id 是 clientId，交给 mention fanout 会去找不存在的 agent）。

剩余三块，按此顺序：

1. **切 handler 到 `post()`**（下一步）。卡点：`chat-schedule-loop-session.ts` 的 fanout 编排要搬进 service 的 notifier，而 notifier 需要 `resolveAgentIdentifier` —— 它是 `session.ts:4118` 的私有方法（约 50 行，id 前缀/名称模糊匹配），只依赖 agentStorage/agentManager，应抽成模块函数供两处共用。notifier 在 `bootstrap.ts` 注入：chatService 于 :809 构造、agentManager 于 :840，顺序决定了要用 setter 而非构造参数。曾起过头并已 `git restore` 回退，当前行为与改动前一致，无半迁移状态。
2. 房间所有权（`ownerKind`/`ownerId`/`displayName`）+ 指定 id/owner 幂等创建 + owner 专用清理接口；通用 `chat/delete` 拒绝有 owner 的房间。
3. 订阅协议：`chat.room.subscribe/unsubscribe` + `chat.room.message_posted` 广播，原子首屏 + cursor + `afterCursor`/`hasMore`（语义已在 ITEM-1 冻结），订阅按物理 socket 保存与清理。

### 实现决策

- **方法名 `post` 而非设计文档的 `postMessage`**：lint 规则 `unicorn/require-post-message-target-origin` 把任何该名字的调用当作 `window.postMessage` 报错（6 处）。重命名比每个调用点加 disable 干净。
- **`dispatchMessage` 保留为 deprecated 兼容入口**：现有调用方（session handler、schedule/loop 通知）仍在用；`post` 是新的唯一写入边界，切完 handler 后再评估能否移除。
- **notifier 失败不影响投递**：消息已在房间里，让 post 失败会告诉作者"没发出去"，比漏一次通知更糟。
