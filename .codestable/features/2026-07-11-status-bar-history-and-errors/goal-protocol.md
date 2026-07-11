---
doc_type: feature-goal-protocol
feature: 2026-07-11-status-bar-history-and-errors
status: ready
---

# Goal 执行协议

1. 读取 design、checklist、goal-plan 与 goal-state，确认用户已批准范围仍为 app-only。
2. 按 checklist 完成 implementation。每个行为 step 使用 RED -> GREEN -> VERIFY；例外必须在证据中写明 `TDD exception` 与替代证据。
3. 运行 implementation gates，写入 step 证据、ledger、DoD 和 scope 结果；将 state 更新为 `review/ready`。
4. 运行独立 `cs-code-review`。有 blocking 则修复并重跑；通过后将 state 更新为 `qa/ready`。
5. 运行 `cs-feat` QA。失败或阻塞则修复后重新 review 和 QA；通过后将 state 更新为 `acceptance/ready`。
6. 运行 `cs-feat` acceptance，更新 checklist checks 和必要证据。通过后先写 `complete/passed`，再输出 `CS_FEATURE_GOAL_COMPLETE`。

## Goal 模式约束

- 设计确认后的普通 checkpoint 以报告、状态和证据替代；只有 handoff 条件可以停止。
- 严格禁止改 errors、server、protocol、client SDK、feature gate、RPC、agent lifecycle、archive、分页或额外 fetch。
- 静态空闲路径必须与交互 trigger 为不同组件边界：不能在创建 open state/effect 后再判空。
- handoff 前先写 `stage: handoff`、`status: blocked`、`handoff_reason`、`handoff_next`，再输出：

```text
CS_FEATURE_GOAL_HANDOFF
Reason: <具体阻塞>
Next: <建议动作>
```

Handoff 条件：需要改变 approved design/范围/公开契约；独立 reviewer pending/failed/blocked；同一失败三轮；核心环境缺失；用户要求暂停或改向。
