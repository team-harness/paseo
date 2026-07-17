---
doc_type: issue-report
issue: 2026-07-16-status-bar-cost-still-undercounted
status: draft
severity: P1
summary: 多 Host Status bar 今日费用仍显著低于 sub2api 今日实际费用
tags:
  - status-summary
  - usage-ledger
  - codex
  - desktop-daemon
---

# Status Bar 今日费用仍少算 Issue Report

## 1. 问题现象

多 Host Status bar 展示的今日费用约为 `$82`，而同一时段 sub2api 显示 Claude 今日 `$20.6316`、Codex 今日 `$357.5419`，合计 `$378.1735`。Status bar 展示值仅约为 sub2api 合计的 `21.7%`。

该现象发生在昨日合入并打包 Codex usage 少算修复之后，说明当前生产环境的今日费用仍未达到用户可接受的准确度。

## 2. 复现步骤

1. 在连接两台 Host 的 Paseo Desktop 中查看全局 Status bar 的 Today cost。
2. 在 sub2api 中查看同一自然日的 Claude 与 Codex 今日费用。
3. 将 Status bar 的多 Host 合计与 sub2api 的 provider 合计进行比较。
4. 观察到：Status bar 约 `$82`，sub2api 合计约 `$378.1735`，两者相差约 `$296.17`。

复现频率：当前稳定复现。

## 3. 期望 vs 实际

**期望行为**：Status bar 应准确汇总所有已连接 Host 上由 Paseo 管理的当日 Claude/Codex 用量；当 sub2api 的请求均来自这些 Paseo Host 时，两边今日费用应基本一致，仅允许定价舍入或采样时刻造成的小幅差异。

**实际行为**：Status bar 今日费用显著偏低，且差值会影响用户判断当天的真实 API 消耗。

## 4. 环境信息

- 涉及模块 / 功能：Codex provider usage、usage ledger、Status summary、多 Host Status bar 聚合、Desktop-managed daemon 生命周期
- 相关文件 / 函数：`packages/server/src/server/agent/providers/codex-app-server-agent.ts`、`packages/server/src/server/usage-ledger/index.ts`、`packages/desktop/src/daemon/daemon-manager.ts`、`packages/app/src/status-summary/view-model.ts`
- 运行环境：macOS 生产 Desktop，Paseo `0.1.107`，两台 Host
- 当前本机 Host：`WyattdeMac-mini.local`，server id `srv_Vt0CsCHrw8_I`
- 统计窗口：Asia/Shanghai，`2026-07-16` 本地自然日
- 最近相关改动：`21ac8b8fe fix(server): correct Codex usage accounting`

## 5. 严重程度

**P1 严重** — Status bar 的核心费用统计持续大幅失真，但 agent 执行本身仍可继续。

## 备注

- 本机 ledger 在 `2026-07-16 13:16 +08:00` 的今日合计为 `$12.176467`，其中 Claude `$6.411889`、Codex `$5.764578`。
- 已安装 `/Applications/Paseo.app` 的修改时间为 `2026-07-16 10:14:20 +08:00`。
- 当前 Desktop-managed supervisor/daemon 进程启动于 `2026-07-16 08:41:53 +08:00`。
- 当前 daemon 日志仍持续出现 Codex stale snapshot 丢弃，basis key 同时包含 `usage-turn-N` 与 `codex-turn-N` 形式。
- 本轮只做只读取证；未重启 `6767` daemon，未修改生产 ledger，也未处理正在运行的 agents。
