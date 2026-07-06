---
doc_type: feature-ff-note
feature: status-bar-history-status
date: 2026-07-06
requirement:
tags: [status-bar, history, desktop]
---

## 做了什么

在 status bar 的“历史”列表行上展示 Agent 运行状态，方便从最近会话里切换前先判断会话当前是否运行、报错或需要处理。

## 改了哪些

- `packages/app/src/status-summary/status-bar-running-sessions.tsx` — 历史行标题侧新增状态点和短状态文案，复用现有 Agent 状态语义。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx` — 覆盖历史行状态展示。
- `packages/app/src/status-summary/global-status-bar.test.tsx` — 补齐复用状态点组件所需的测试 mock。

## 怎么验证的

已跑 status-summary 定向测试、全局 lint 和全量 typecheck，均通过。
