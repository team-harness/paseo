---
doc_type: feature-ff-note
feature: status-bar-history-refresh
date: 2026-07-06
requirement:
tags: [status-bar, history, refresh]
---

## 做了什么

给 status bar 的“历史”弹层增加手动刷新入口。打开历史仍优先显示缓存，用户点击刷新图标时重新加载当前 host 最近会话。

## 改了哪些

- `packages/app/src/status-summary/status-bar-running-sessions.tsx` — 接入 `useAgentHistory().refreshAll/isRevalidating`，在历史列表头部增加刷新图标按钮。
- `packages/app/src/status-summary/status-bar-running-sessions.test.tsx` — 覆盖点击刷新按钮会调用历史刷新。
- `packages/app/src/i18n/resources/*` — 补齐刷新/刷新中文案。

## 怎么验证的

运行 status bar 与 i18n 相关测试、targeted lint 和全量 typecheck，均通过。
