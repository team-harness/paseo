---
doc_type: issue-report
issue: 2026-07-16-status-bar-session-aggregation
status: confirmed
severity: P1
summary: Status bar 会话计数与列表不一致、列表数据陈旧且历史和 Pin 聚合不完整
tags:
  - status-bar
  - multi-host
  - sessions
---

# Status Bar 会话聚合异常 Issue Report

## 1. 问题现象

Status bar 的“会话”数字与展开后的实际会话条目数量不一致，展开列表后会话状态不会及时更新；“历史”只展示少量记录；多 Host 场景下 Pin 列表没有完整展示所有 Host 的 Pin。

## 2. 复现步骤

1. 同时连接多个 Host，并让其中若干 Host 存在运行中、需关注、已完成及子 agent 会话。
2. 查看 status bar 的“会话”数字并展开会话列表。
3. 保持列表打开并改变 agent 状态，观察列表内容。
4. 展开“历史”和“Pin”列表。
5. 观察到：会话数字与可见行不一致，状态未及时校准，历史记录数量偏少，Pin 仅覆盖当前 Host。

复现频率：稳定。

## 3. 期望 vs 实际

**期望行为**：会话数字与展开列表采用同一可见会话口径；打开列表时主动刷新各 Host 状态；历史展示已加载的全部可见顶层会话；Pin 列表聚合所有支持该能力的 Host，并保留 Host 归属。

**实际行为**：会话数字按原始 agent 数统计，列表按顶层会话去重；打开会话列表不主动刷新；历史被固定上限截断；Pin 列表只读取当前 Host。

## 4. 环境信息

- 涉及模块 / 功能：桌面端 status bar 的会话、历史、Pin 列表
- 相关文件 / 函数：`packages/app/src/status-summary/status-bar-running-sessions.tsx`、`packages/app/src/status-summary/status-bar-session-pins.tsx`、`packages/app/src/status-summary/global-status-bar.tsx`
- 运行环境：macOS 桌面应用，连接多个 Host
- 其他上下文：用户截图确认现网行为；此前功能目标为多 Host 聚合

## 5. 严重程度

**P1** — 状态栏核心导航与监控信息不可信，用户会误判会话状态并遗漏历史或 Pin 会话。

## 备注

本次修复不改变 Host/daemon 作为 Pin 数据所有者的既有设计，仅修复客户端聚合和刷新行为。
