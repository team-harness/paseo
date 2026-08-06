---
epic: ../epics/agent-teams.md
phase: executing
approved_revision: 74667ea6e2b559834cbf8f6f7ec717d415917df36e718391620e39fae3935a79
current_item: ITEM-1
next_action: 执行 ITEM-1（protocol + client schema），owning skill = codestable:cs-feat
blocked_by: null
item_progression: continuous
milestone_commit: authorized
remote_publish: final
---

## 子项进度

- [ ] ITEM-1 protocol + client schema
- [ ] ITEM-2 server 基础改造
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
