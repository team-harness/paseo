---
doc_type: issue-report
issue: 2026-07-15-codex-status-cost-undercount
status: confirmed
issue_path: standard
severity: P1
summary: 两台 Host 的 Status bar 严重少记 Paseo 管理的 Codex Token 与费用
tags:
  - status-summary
  - codex
  - usage-ledger
---

# Codex Status Cost Undercount Issue Report

## 1. 问题现象

在两台已接入 Paseo 的 Host 上运行 Codex 后，Status bar 展示的今日费用明显低于同一日窗口内的实际 Codex 用量。诊断时，网关两台 Host 合计为 `$978.2046`，其中 Codex 为 `$719.8930`；两台 Host 的 usage ledger 合计仅为 `$282.3463`，其中 Codex 仅为 `$34.8211`。

即使只比较能够映射回 Paseo agent 的本地 Codex transcript，两台 Host 合计约为 `$465.0612`，仍远高于 ledger 中的 Codex 费用。问题在两台 Host 上均能观察到，并会直接影响 Status bar 的今日与累计统计。

## 2. 复现步骤

1. 在两个已注册、daemon 均声明 `features.statusSummary: true` 的 Paseo Host 上运行一个或多个 Codex agent，并让单个 foreground turn 产生多次模型调用。
2. 在客户端打开全局 Status bar，记录 Today cost。
3. 通过两个 Host 的只读 `status.summary.get` RPC 和 `$PASEO_HOME/usage-ledger/*.json` 记录同一日窗口内的 Codex Token 与费用。
4. 使用 Codex transcript 的累计 Token 数据复算能够映射到 Paseo agent 的同一窗口用量。
5. 观察到：RPC summary 与 ledger 一致，但两者显著低于可映射 transcript 的 Token 与费用。

复现频率：稳定。两台生产 Host 均复现，且差异随多次 Codex 模型调用持续扩大。

## 3. 期望 vs 实际

**期望行为**：每个支持 Status summary 且处于已连接状态的 Host 都贡献其完整的 Paseo-managed usage；同一 foreground turn 内的多次 Codex 模型调用不会丢失，两个 ready Host 的费用由 Status bar 正确求和，daemon 重启后统计仍保持一致。

**实际行为**：两个 Host 的 Status summary 都忠实返回各自 ledger，但 ledger 中的 Codex 用量严重少于能够映射到 Paseo agent 的 transcript 用量。诊断快照中，两台 Host 的 Codex ledger 仅覆盖网关 Codex 费用的约 `4.84%`，并少于可映射 transcript 约 `$430.24`。

## 4. 环境信息

- 涉及模块 / 功能：Codex provider usage、usage ledger、全局 Status bar 多 Host 汇总
- 相关文件 / 函数：`packages/server/src/server/agent/providers/codex-app-server-agent.ts`、`packages/server/src/server/usage-ledger/index.ts`、`packages/app/src/status-summary/use-status-summary.ts`、`packages/app/src/status-summary/view-model.ts`
- 运行环境：macOS 生产桌面端与两台生产 daemon，Paseo `0.1.107`
- Host 1：`Wyatts-MacBook-Pro-13.local`，`features.statusSummary: true`
- Host 2：`WyattdeMac-mini.local`，`features.statusSummary: true`
- 统计窗口：Asia/Shanghai 本地日，起点 `2026-07-15 00:00:00 +08:00`
- 其他上下文：网关统计包含所有经过网关的请求，不保证全部属于 Paseo；因此验收以可映射到 Paseo agent 的 usage 为主，并单独验证多 Host 求和。

## 5. 严重程度

**P1 严重** — Status bar 的核心费用统计在主要 provider 上稳定且大幅失真，用户无法据此判断当天与累计消耗；agent 执行本身仍可继续，因此不定为 P0。

## 备注

- Host 1 诊断时记录到超过 `2600` 条 Codex stale usage 日志。
- Host 2 诊断时记录到 `2138` 条 Codex stale usage 日志。
- Host 2 自身 Status summary 今日费用仅为 `$0.135`；即使该 Host 一度未被客户端纳入，也不足以解释主要金额差异。
- 既有持久化统计已经受影响；修复方案需要明确未来事件修正与历史数据处理的边界。
