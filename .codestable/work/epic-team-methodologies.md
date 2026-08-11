---
epic: ../epics/team-methodologies.md
phase: planning
approved_revision: pending
current_item: null
next_action: owner 确认 proposed Epic、17 个子项契约与执行/提交/发布策略
blocked_by: null
item_progression: pending
milestone_commit: pending
remote_publish: pending
---

## 子项进度

- [ ] TM-ITEM-1
- [ ] TM-ITEM-2
- [ ] TM-ITEM-3
- [ ] TM-ITEM-4
- [ ] TM-ITEM-5
- [ ] TM-ITEM-6
- [ ] TM-ITEM-7
- [ ] TM-ITEM-8
- [ ] TM-ITEM-9
- [ ] TM-ITEM-10
- [ ] TM-ITEM-11
- [ ] TM-ITEM-12
- [ ] TM-ITEM-13
- [ ] TM-ITEM-14
- [ ] TM-ITEM-15
- [ ] TM-ITEM-16
- [ ] TM-ITEM-17

## 临时决策与证据

- 2026-08-11：恢复唯一 proposed 永久 Epic `.codestable/epics/team-methodologies.md`；未发现重复 work
  游标或可应用 lesson。
- 2026-08-11：`agent-teams:V2-ITEM-11` 是 TM-ITEM-6 的跨 Epic 前置；TM-ITEM-1 至 TM-ITEM-5 的
  portable 构建路径不受该前置阻塞。
- 2026-08-11：拆解采用 tracer-bullet 边界。Paseo 子项同时拥有 protocol、daemon、App/CLI 与定点证据；
  不按 package 横向拆成不可独立验收的任务。
- 2026-08-11：建议首次 owner gate 选择 `parallel / authorized / final`。仅 TM-ITEM-9/10/11 作为明确的
  同时激活批次；TM-ITEM-4→5 保持依赖顺序，TM-ITEM-14→15 因共享 controller CAS/Attention 写路径按
  该顺序串行激活。确认前策略保持 pending。
- 2026-08-11：fresh design review Round 1 核对 Epic `17d98767…84cac` 与游标 `ae14f7fc…0342a`，发现
  package handoff 无 owner、TM-ITEM-11 至 16 缺用户面、版本矩阵未展开和 capability replan 缺真实触发
  证据。修订保持 17 个 ID：TM-ITEM-3/6 闭合 publish→sync，用户面下放各门禁子项，TM-ITEM-5 接管
  双宿主安装一致性，TM-ITEM-17 收敛为 Paseo 最终门。
- 2026-08-11：Round 2 核对 Epic `28177fba…7dbfe2` 与游标 `809d9840…9abf6f`，判定首轮 5 项全部
  resolved；新 blocking 是游标错误地将依赖 TM-ITEM-4 的 TM-ITEM-5 列为并行。修订删除该批次，并因
  共享 CAS 写面将 TM-ITEM-14/15 明确串行激活。执行推进到 TM-ITEM-6 时，若
  `agent-teams:V2-ITEM-11` 尚未完成，主流程必须同步设置 `blocked_by`，不得以当前 planning 阶段的
  `null` 继续。
- 2026-08-11：Round 3 核对 Epic `7b22855b…b34633` 与游标 `f4fcaa5a…1608c3`；Round 2 的 1 个
  blocking 与 3 个 minor 全部 resolved，本轮 0 blocking / 0 important，允许提交 owner gate。
