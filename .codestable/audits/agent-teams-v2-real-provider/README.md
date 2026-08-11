# Agent Teams v2 真实 Provider 证据

- 候选基线：`3e9daa79ec0142a536c718f757784d3ffa8aa564`
- 日期：2026-08-11
- Provider：`codex`
- Model：`null` 表示使用 Provider 默认模型
- 执行配置：`thinkingOptionId=medium`、`modeId=full-access`
- 重试策略：测试侧不重试；每种任务形态连续运行三次；`needs_attention` 作为可恢复中间态继续等待 Lead replan，只以 Mission 终态结束 case

## 命令

```bash
PASEO_TEAM_MISSIONS_REAL_E2E=1 \
  PASEO_TEAM_MISSIONS_REAL_E2E_LOG_LEVEL=warn \
  PASEO_TEAM_MISSIONS_EVIDENCE_DIR=dogfood-output/agent-teams-v2-real-final21 \
  npx vitest run packages/server/src/server/daemon-e2e/team-missions-coordination.real.e2e.test.ts \
  --bail=1 -t parallel_delivery

PASEO_TEAM_MISSIONS_REAL_E2E=1 \
  PASEO_TEAM_MISSIONS_REAL_E2E_LOG_LEVEL=warn \
  PASEO_TEAM_MISSIONS_EVIDENCE_DIR=dogfood-output/agent-teams-v2-real-final20 \
  npx vitest run packages/server/src/server/daemon-e2e/team-missions-coordination.real.e2e.test.ts \
  --bail=1 -t recovery_dependency
```

## 结果

五维评分依次为 `Workstream fit / Coordination / Tool discipline / Delivery / Runtime reliability`。
Team tool 计数依次为 `mission_status / mission_plan / assign_task / assignment_report / team_status / team_message / chat_read / team_member_history`。

| 形态                  | 次数 | 耗时 ms | 规划 ms | 最大并行 | 五维评分  | 总分 | 达标 | Team tool 计数  | 恢复                                         |
| --------------------- | ---: | ------: | ------: | -------: | --------- | ---: | ---- | --------------- | -------------------------------------------- |
| `parallel_delivery`   |    1 |  337296 |  119911 |        3 | 2/2/1/2/1 |    8 | 是   | 8/1/0/6/0/0/0/0 | 无                                           |
| `parallel_delivery`   |    2 |  377670 |  164401 |        3 | 2/2/1/2/1 |    8 | 是   | 8/1/0/6/0/0/0/0 | 无                                           |
| `parallel_delivery`   |    3 |  312350 |  119824 |        3 | 2/2/1/2/1 |    8 | 是   | 8/1/0/6/0/0/0/0 | 无                                           |
| `recovery_dependency` |    1 |  365137 |  146833 |        1 | 2/2/1/2/1 |    8 | 是   | 5/1/0/3/0/0/0/0 | `after_lead_participant_write`；首次启动失败 |
| `recovery_dependency` |    2 |  396536 |  146856 |        1 | 2/2/1/2/1 |    8 | 是   | 4/1/0/3/0/0/0/0 | `after_lead_participant_write`；首次启动失败 |
| `recovery_dependency` |    3 |  400313 |  143460 |        1 | 2/2/1/2/1 |    8 | 是   | 4/1/0/3/1/0/0/1 | `after_lead_participant_write`；首次启动失败 |

6 次运行全部达标，总分均为 8。所有运行的 validation violation、scope conflict、返工、accepted-turn replay、未结算 report 和未关闭 Attention 均为 0，verification 全部通过。并行任务三次均达到 3 个 Assignment 同时执行。依赖恢复任务的最大并行为 1，三次 `after_lead_participant_write` 故障注入均生效，启动幂等重放后收敛。这六次没有触发 report recovery turn，因此 Tool discipline 与 Runtime reliability 按冻结评分规则各为 1，不是失败后的测试侧重试。

六个根目录 JSON 是 `allowlisted_v1` 主证据。它们保留可复核的 DAG、ID、时间戳、评分、token 用量、runtime 指标和 provider boundary；自由文本、workspace 内容、tool detail/metadata、chat/timeline 文本以及 verification command/output 只保留 digest、bytes 或 count。`parallel_delivery/` 与 `recovery_dependency/` 保留 manifest 逐条引用的 sanitized provider JSONL，`parallel-run.log` 与 `recovery-run.log` 保留两条 Vitest 命令的完整进程结果。
