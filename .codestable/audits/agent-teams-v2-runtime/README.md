# Agent Teams v2 Runtime 审计

- 验证日期：2026-08-10
- 候选基线 HEAD：`3e9daa79ec0142a536c718f757784d3ffa8aa564`
- 审计对象：该基线之上的当前 Agent Teams v2 candidate diff

## Deterministic real-daemon E2E

- Spec：`packages/server/src/server/daemon-e2e/team-missions.e2e.test.ts`
- 命令：

  ```bash
  npx vitest run packages/server/src/server/daemon-e2e/team-missions.e2e.test.ts --bail=1
  ```

- 最新结果：`1/1 passed`
- Test body：`1.59s`
- 总时长：`7.52s`
- 测试侧没有 generic retry；失败不会通过重跑 RPC 掩盖。
- 原始 Vitest 输出见 [daemon-e2e-output.txt](daemon-e2e-output.txt)。

该用例使用真实 daemon、WebSocket、文件持久化、agent-scoped MCP 和确定性 provider，覆盖：

1. 创建 Team 不自动打开成员 Tab；Lead 与成员按 Mission/Assignment lazy provision。
2. `mission_status`、`mission_plan`、`assign_task`、`assignment_report` 通过 agent-scoped 工具执行；非 Lead 发布 Plan 被拒绝。
3. 两个 delivery 真并行并写入真实 workspace artifact；独立 review 后，dependency-gated integration 才开始。
4. final verification 完成 Mission，Participant 随后归档；provider side effect 与 `messageId` 保持 exactly-once。
5. 本地重启后快照一致；重启后第二个 Mission 可通过 WebSocket list、inspect 和 cancel。

`assignment_report` 的 Mission CAS 回归也由该链路验证：读取 authoritative Mission 后，后台
scheduler 推进无关 Mission revision，服务端仅在 Assignment revision、Participant binding 与
report/finish guards 保持不变时有界 rebase。报告只写一次，残余冲突不会降级为 generic
`team_tool_failed`。

CAS 的两份精确单测文件随后再次运行，`47/47 passed`。原始 Vitest 输出见
[cas-regression-output.txt](cas-regression-output.txt)。

Protocol、Client 与 CLI 的 8 个精确单测文件为 `146/146 passed`，原始输出见
[protocol-client-cli-output.txt](protocol-client-cli-output.txt)。真实 CLI binary 集成依次覆盖 profile
create/list/inspect/update/archive 和无需启动 Provider 的 Mission list；原始脚本输出见
[cli-integration-output.txt](cli-integration-output.txt)。其中 daemon `143` 是测试 teardown 发送的
`SIGTERM`，脚本最终输出 `Team Missions Command Tests Passed`。

## 启动顺序边界

- Spec：`packages/server/src/server/team/team-runtime.boundary.test.ts`
- 结果：`3/3 passed`
- 命令：

  ```bash
  npx vitest run packages/server/src/server/team/team-runtime.boundary.test.ts --bail=1
  ```

边界测试固定以下顺序：安装 Team runtime 与 agent tool catalog，绑定 HTTP listener，注入已绑定的
Agent MCP URL，启动 Team recovery/reconciliation，最后向 WebSocket 暴露 `teamMissions` capability。
因此恢复中的 Participant 不会在 agent-scoped Team tools 可用前被唤醒。

本目录不收录 `/tmp/team-missions-real-recovery-final.log`。该日志属于真实 provider 协同证据，
不属于 deterministic runtime 审计。

## Daemon 平台矩阵

| 环境    | 状态 | 证据或残余风险                                                       |
| ------- | ---- | -------------------------------------------------------------------- |
| macOS   | 已跑 | deterministic daemon E2E、真实 Codex 六轮与文件持久化均在 macOS 完成 |
| Linux   | 未跑 | 领域与 Store 单测已覆盖，但本候选没有 Linux daemon 进程证据          |
| Windows | 未跑 | 尚未验证 Windows 文件锁与原子 rename 行为                            |
| Docker  | 未跑 | 尚未验证容器卷挂载、退出与重启路径                                   |

Team Missions v2 是首个公开格式，不读取或迁移实验 Team 数据，因此没有 legacy migration rename
的平台验收项。普通原子文件写入仍保留上述 Windows/Docker 残余风险。
