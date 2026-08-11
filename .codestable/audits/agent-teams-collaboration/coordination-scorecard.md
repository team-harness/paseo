# Agent Team 协同验收记分卡

## 判定规则

| Gate         | 判定                                              | 当前结果    |
| ------------ | ------------------------------------------------- | ----------- |
| 机制可靠性   | 所有确定性契约必须通过，不计平均分                | PASS        |
| 单次规划质量 | 五项各 0-2 分；总分至少 8，无 0 分，交付必须 2 分 | PASS        |
| 规划稳定性   | 修复后连续 3 次规划质量达标，覆盖至少两种任务形态 | PASS（3/3） |

机制可靠性已经覆盖 roster 与 handle 持久化、同成员 FIFO、跨成员并行、busy 不打断、crash 同 taskId 重投、完成事件去重和任务账本归零。

## 已有运行评分

| 场景                                    | 职责匹配 | 拆分边界 | 派发效率 | 协调开销 | 交付质量 | 总分  | 判定                        |
| --------------------------------------- | -------- | -------- | -------- | -------- | -------- | ----- | --------------------------- |
| Stable work allocator（事件驱动修复前） | 2        | 2        | 2        | 0        | 2        | 8/10  | 基线未达标，不计稳定 streak |
| Event-driven normalizeTags（修复后）    | 2        | 2        | 2        | 2        | 2        | 10/10 | 达标，streak 1/3            |
| Coordination Run 2 Current              | 2        | 2        | 2        | 1        | 2        | 9/10  | 达标，streak 2/3            |
| Coordination Run 3 dependency gate      | 2        | 2        | 2        | 1        | 2        | 9/10  | 达标，streak PASS（3/3）    |

第一轮的 Lead 调用了两次 `chat_wait`，因此协调开销为 0。normalizeTags 派工后立即结束回合，由两个完成事件分别唤醒；`chat_wait` 为 0，成员职责零越界，最终测试 `18/18` 通过。

Run 2 使用两个真实 `assign_task`，执行重叠 61.9 秒；Lead 在两个完成事件后各调用一次 `team_status`，`chat_wait` 为 0，最终测试 `10/10`。Builder 没有按要求发送房间简报并错误判断 `@lead` 不可用，但 daemon 完成事件和任务账本没有丢失状态，因此协调开销记 1 分。完整证据见 [run-2/report.md](run-2/report.md)。

Run 3 严格等待 Stage 1 settle 后才派发 Stage 2；两个成员均使用注入的 Team 工具发布房间简报，`chat_wait` 为 0，最终测试 `7/7`。Implementer 在 `chat_read` 前多尝试了一次 shell CLI 读取，因此协调开销记 1 分。完整证据见 [run-3/report.md](run-3/report.md)。

## 每次运行必须记录

1. 固定任务、Team roster、每位成员职责、provider 与 model。
2. 每个 taskId、目标成员、派发/接受/完成时间和 completionEventId。
3. `team_status`、等待类调用、重复消息、重投和未确认完成事件数量。
4. 每位成员的文件变更、职责越界、冲突、返工和最终验证结果。
5. 五项评分、原始证据位置，以及该次运行是否延续稳定 streak。

## 已完成运行

- Run 2：已完成。Builder 只写实现，Verifier 只写黑盒测试，评分 `9/10`。
- Run 3：已完成。Lead 等待阶段一完成事件并验收后才派发阶段二，评分 `9/10`。
- 三次连续运行均达标，并覆盖并行与显式依赖两种任务形态，规划稳定性为 `PASS（3/3）`。
