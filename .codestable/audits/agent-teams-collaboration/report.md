# Paseo Agent Teams Dogfood 报告

| 字段    | 值                                                                  |
| ------- | ------------------------------------------------------------------- |
| 日期    | 2026-08-07                                                          |
| App URL | http://localhost:8081                                               |
| 范围    | Team 创建、职责、Tab、房间、@提及、任务队列、成员历史、真实模型协同 |
| 结果    | 机制可靠性 PASS；单次规划质量 PASS；规划稳定性 PASS（3/3）          |

## 真实协作结果

| 场景                       | 规划与派工                                                 | 调度与完成                                                                               | 交付质量                                                   |
| -------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Stable work allocator      | Lead 按职责把源码与黑盒测试并行分给 Implementer / Verifier | 两个任务均有独立 taskId、acceptedTurnId、completionEventId；最终 pendingCompletions 为空 | `8/8` 通过；Implementer 只改 `src/`，Verifier 只改 `test/` |
| Event-driven normalizeTags | Lead 派工后立即结束回合；`chat_wait` 调用为 `0`            | 第一次完成后 `team_status` 仍有 1 项便退出；第二次完成后才集成；无轮询、无重复投递       | `18/18` 通过；职责零越界；无新增依赖                       |
| Coordination Run 2 Current | Lead 用两个 `assign_task` 并行派发实现与黑盒测试           | 执行重叠 61.9 秒；两次完成各触发一次 `team_status`；`chat_wait` 为 `0`                   | `10/10` 通过；职责零越界；评分 `9/10`                      |
| Coordination Run 3         | Lead 先派契约，settle 并验收后才派实现                     | 两个完成事件各触发一次 `team_status`；无提前派发；`chat_wait` 为 `0`                     | `7/7` 通过；职责零越界；评分 `9/10`                        |

Daemon 的单次派发落盘耗时约 8 ms。两项任务在不同成员上重叠执行；模型生成两份详细任务说明约需 10-12 秒。定向算法验证覆盖同一成员 FIFO、不同成员并行、busy 不打断、crash 后同 ID 重送、完成事件批处理与恰好一次确认。

协同验收分为两个独立 Gate：机制可靠性必须通过全部确定性契约；规划质量按职责匹配、拆分边界、派发效率、协调开销和交付质量评分。修复后已有三次连续合格运行，并覆盖并行与显式依赖两种任务形态，规划稳定性为 PASS。完整评分见 [coordination-scorecard.md](coordination-scorecard.md)。

## 自动化验证

| 检查                                                                                                             | 结果                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Server 协同核心：pump / inbox / crash recovery / scheduler / runtime / tools / prompts / session / WebSocket E2E | 9 文件，`144/144` 通过                                        |
| 受影响的 Protocol / CLI / App / Chat / Team 单测                                                                 | 21 文件，`324/324` 通过                                       |
| App host runtime（App 专用 Expo 配置）                                                                           | `66/66` 通过                                                  |
| Client SDK 职责字段转发                                                                                          | 定向用例通过；`build:server` 通过                             |
| Browser Team E2E                                                                                                 | `8/8` 通过；协作证据场景 8.9 秒                               |
| 真实模型开发协作                                                                                                 | Stable allocator `8/8`；normalizeTags `18/18`                 |
| Handle 追加稳定性                                                                                                | Protocol / Store / Recruitment / Tools / Prompts `82/82` 通过 |
| 仓库质量门槛                                                                                                     | `npm run typecheck` 通过；`npm run lint` 0 warning / 0 error  |

Browser E2E 的隔离 daemon 显式启用 `mcp.injectIntoAgents`，生产默认关闭及创建守卫保持不变。

## 已修复问题

### ISSUE-001：历史消息暴露 Agent UUID

- 严重性：Medium
- 修复：根据 Team roster 把旧 UUID / 旧前缀 mention 映射为当前 handle；人类消息显示“我”，且不可误点为 Agent。
- 证据：[修复前](screenshots/11-current-real-team.png) / [成员 mention 修复后](screenshots/12-current-real-team-after.png) / [人类 mention 修复后](screenshots/13-current-real-team-human-fixed.png)

### ISSUE-002：未启用 Paseo tools 时仍可创建 Team

- 严重性：High
- 修复：创建前检查 `mcp.injectIntoAgents`；关闭时直接返回可操作错误，且不创建 Team、房间或 Agent 残留。
- 原因：Agent 收到要求使用 Team tools 的提示，但运行时根本没有工具，最终会退回错误 daemon 的 CLI 或失去协同能力。

### ISSUE-003：成员在 Lead 派工前自行开工

- 严重性：High
- 修复：成员首轮只接收身份、职责、handle 与房间；完整团队任务不再作为成员首轮提示。真正的 `assign_task` 回合才授予执行权限。
- 真实复验：两个成员初始化完成后均 idle，Git 工作区保持 clean；Lead 派工后才出现变更。

### ISSUE-004：Lead 用 `chat_wait` 重复等待成员

- 严重性：Medium
- 修复：Lead 派工并公告后结束回合，由 daemon 完成事件唤醒；每次唤醒调用 `team_status`，仅在 openTasks 为 0 时集成。
- 真实复验：第二个场景 `[Chat Wait]` 调用数为 0，两次完成通知各触发一次状态判断，最终队列为空。

### ISSUE-005：追加成员可能重命名旧成员 handle

- 严重性：High
- 修复：未持久化 handle 严格按 roster 顺序分配；Agent ID 和已持久化 handle 仍全局保留。追加职责名碰撞的成员只会改变自己的后缀，不会重命名历史地址。
- 回归覆盖：已有 `@server` / `@server-2` 后追加职责 `server-2`，旧地址保持不变，新成员得到 `@server-2-2`。

### ISSUE-006：成员可能误用 provider-native 通信

- 严重性：Medium
- 状态：Fixed
- 复现：Run 2 的 Builder 完成实现后没有调用 Team room 工具，并在最终回复中错误声称“no `@lead` agent is connected”；同队 Verifier 使用 `[Chat Post]` 成功。
- 修复：Lead、初始成员和追加成员 briefing 都明确区分注入的 `chat_post`、`team_message` 与 provider-native `send_message`；公共规则由同一 helper 生成。
- 回归：`team-prompts.test.ts` 6/6；Run 3 的两个成员都用 `chat_post` 发布可审计交付，Lead 依靠完成事件收口，未丢任务。
- 证据：[Builder 历史（修复前）](run-2/screenshots/09-builder-history-message-gap.png) / [Run 3 最终房间（修复后）](run-3/screenshots/11-team-room-final.png)

## UI 证据

| 页面 / 行为                | 截图                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Tab 右侧 `+` 可创建 Team   | [01-tab-plus-team-entry.png](screenshots/01-tab-plus-team-entry.png)                         |
| 成员职责为必填字段         | [02-team-form-with-responsibilities.png](screenshots/02-team-form-with-responsibilities.png) |
| 创建确认                   | [03-team-confirmation.png](screenshots/03-team-confirmation.png)                             |
| 创建后只打开 Team Tab      | [04-created-team-only-tab.png](screenshots/04-created-team-only-tab.png)                     |
| 团队协作房间               | [05-development-collaboration-room.png](screenshots/05-development-collaboration-room.png)   |
| 可读 @mention 自动补全     | [06-readable-mention-autocomplete.png](screenshots/06-readable-mention-autocomplete.png)     |
| 人类消息显示“我”           | [07-human-message-as-you.png](screenshots/07-human-message-as-you.png)                       |
| 完成任务账本               | [08-completed-task-ledger.png](screenshots/08-completed-task-ledger.png)                     |
| 按需打开成员历史           | [09-member-history-opened-on-demand.png](screenshots/09-member-history-opened-on-demand.png) |
| 紧凑宽度布局               | [10-collaboration-room-compact.png](screenshots/10-collaboration-room-compact.png)           |
| CLI 创建后不自动开成员 Tab | [10-workspace-loaded.png](run-3/screenshots/10-workspace-loaded.png)                         |
| 依赖型协同最终房间         | [11-team-room-final.png](run-3/screenshots/11-team-room-final.png)                           |
| 两阶段任务账本             | [12-task-ledger-sequential.png](run-3/screenshots/12-task-ledger-sequential.png)             |
