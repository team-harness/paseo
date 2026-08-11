# Agent Teams v2 UI 审计

- 验证日期：2026-08-10
- 候选基线 HEAD：`3e9daa79ec0142a536c718f757784d3ffa8aa564`
- 审计对象：该基线之上的当前 Agent Teams v2 candidate diff

## 测试入口

- Playwright spec：`packages/app/e2e/browser/team-v2-evidence.spec.ts`
- 浏览器：Chromium，通过隔离 host daemon 与真实 WebSocket/RPC 路径运行
- Desktop viewport：`1440x960`
- Compact viewport：`420x900`
- 本次结果：`1 passed`；测试体 `15.2s`，总计 `23.7s`
- 原始输出：[playwright-output.txt](playwright-output.txt)

前 8 张截图覆盖真实 Team 创建、Mission 创建、聊天和设置交互。后 5 张截图通过
schema-valid 的持久 Mission 快照驱动 authoritative daemon read path，用于证明 UI 对规划、
并行、阻塞、Attention 和完成状态的呈现。这些 seeded 状态不证明真实 provider 已完成协同；
真实调度与 provider 协同证据由 runtime 和 real-provider 审计分别承担。

当前 diff 中 12 个 App v2 单测文件为 `128/128 passed`。HostRuntime 通过 App 自身 Vitest 配置
运行，结果为 `69/69 passed`，原始输出见 [host-runtime-output.txt](host-runtime-output.txt)。

## 截图清单

| #   | 文件                                                                                         | 状态                                                           |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | [01-desktop-create-team.png](screenshots/01-desktop-create-team.png)                         | 从 Tab 右侧 `+` 打开 Team 创建表单，配置技能与两个同 Role 成员 |
| 2   | [02-desktop-empty-team.png](screenshots/02-desktop-empty-team.png)                           | Team 创建完成后为空闲态，成员未自动 provision 或打开 Tab       |
| 3   | [03-desktop-members-settings.png](screenshots/03-desktop-members-settings.png)               | 设置中的成员列表与唯一 mention handle                          |
| 4   | [04-desktop-start-mission.png](screenshots/04-desktop-start-mission.png)                     | 为可复用 Team 创建 Mission，填写目标和验收标准                 |
| 5   | [05-desktop-mission-chat.png](screenshots/05-desktop-mission-chat.png)                       | Mission room 聊天、可读 mention 和人类作者显示                 |
| 6   | [06-desktop-mission-planning.png](screenshots/06-desktop-mission-planning.png)               | Mission planning 状态与尚未发布的 Plan                         |
| 7   | [07-compact-settings-navigation.png](screenshots/07-compact-settings-navigation.png)         | Compact 上拉设置导航                                           |
| 8   | [08-compact-members.png](screenshots/08-compact-members.png)                                 | Compact 成员页                                                 |
| 9   | [09-desktop-parallel-running.png](screenshots/09-desktop-parallel-running.png)               | 两个独立 Workstream 同时 Running                               |
| 10  | [10-desktop-needs-attention-mission.png](screenshots/10-desktop-needs-attention-mission.png) | Mission 进入 Needs attention                                   |
| 11  | [11-desktop-blocked-plan.png](screenshots/11-desktop-blocked-plan.png)                       | Plan 中一个 Workstream Blocked，另一个 Completed               |
| 12  | [12-desktop-open-attention.png](screenshots/12-desktop-open-attention.png)                   | Attention 详情与真实 Open Lead / Cancel Mission 动作           |
| 13  | [13-desktop-completed-mission.png](screenshots/13-desktop-completed-mission.png)             | 当前 Mission 显示 Completed，参与者已归档                      |

## 平台矩阵

| 平台            | 状态 | 证据或残余风险                                            |
| --------------- | ---- | --------------------------------------------------------- |
| iOS             | 未跑 | 未取得原生渲染、键盘与 bottom sheet 交互证据              |
| Android         | 未跑 | 未取得原生渲染、返回键与 bottom sheet 交互证据            |
| Web browser     | 已跑 | Chromium desktop 与 compact viewport，13 张截图           |
| Desktop macOS   | 未跑 | 当前 desktop viewport 是浏览器 Web，不等同于真实 Electron |
| Desktop Windows | 未跑 | 未取得 Electron、字体与窗口缩放证据                       |
| Desktop Linux   | 未跑 | 未取得 Electron、字体与窗口缩放证据                       |
