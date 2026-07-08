# status-bar-session-pins goal protocol

1. Read `goal-plan.md`, `goal-state.yaml`, `status-bar-session-pins-design.md`, and `status-bar-session-pins-checklist.yaml`.
2. Execute checklist steps S1-S6 in order. Update checklist step status immediately after each step passes its exit signal.
3. Behavior-changing steps use TDD micro-loop unless a `TDD exception` is recorded with substitute evidence.
4. Run implementation gates and scope grep from the checklist.
5. Run code review. If blocking findings exist, fix only those findings and rerun review.
6. Run QA. If QA fails or blocks, fix only failed/blocked items, then rerun review and QA.
7. Run acceptance, update checklist checks, and record final evidence.
8. Print `CS_FEATURE_GOAL_COMPLETE` only when implementation, review, QA, and acceptance are all passed.

Goal mode changes normal checkpoints into written reports and state updates. Stop only for handoff conditions from `goal-plan.md`.

Handoff format:

```text
CS_FEATURE_GOAL_HANDOFF
Reason: <specific blocker>
Next: <recommended action>
```
