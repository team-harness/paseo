---
doc_type: issue-report
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: confirmed
severity: P2
summary: 新建 Agent 后同路径同分支的工作区在侧边栏重复展示
tags: [sidebar, workspace, project-grouping]
---

# 侧边栏重复项目条目 Issue Report

## 1. 问题现象

在侧边栏中，`~/work/freetalk/CodeStable` 项目的 `main` 工作区被展示为多个重复条目，而没有聚合为一个项目条目。重复条目在重启 Paseo 后仍保留。

## 2. 复现步骤

1. 在 macOS 桌面测试版中连接 `Macbook-MINI` Host。
2. 在 `~/work/freetalk/CodeStable` 项目中新建 Agent。
3. 观察侧边栏项目列表。
4. 观察到：同一路径、同分支的 `main` 工作区出现多个重复条目。

复现频率：当前项目稳定出现；目前仅观察到该项目受影响。

## 3. 期望 vs 实际

**期望行为**：同一路径、同分支的工作区应聚合为一个项目条目。

**实际行为**：新建 Agent 后，同路径、同分支的工作区被重复列为多个侧边栏条目，重启后仍存在。

## 4. 环境信息

- 涉及模块 / 功能：桌面端侧边栏项目与工作区分组
- 相关文件 / 函数：待根因分析确定
- 运行环境：macOS 桌面测试版
- 其他上下文：Host 为 `Macbook-MINI`；项目路径为 `~/work/freetalk/CodeStable`；截图显示各重复条目均为 `main` 分支。

## 5. 严重程度

**P2** — 项目与工作区仍可使用，但重复条目破坏侧边栏组织并妨碍定位正确工作区。

## 备注

用户要求直接定位并修复；最低验收要求是清理当前重复记录，只保留一个条目。
