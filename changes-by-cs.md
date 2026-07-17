# Fork Change Ledger

本文件记录 `team-harness/paseo` 相对原作者仓库的产品和运行时改动，用于后续同步上游时快速判断：保留、迁移到上游实现，还是下线本 fork 的重复代码。

这不是发布说明，也不是完整 Git diff。每次增加会影响运行时行为、协议、持久化数据或桌面打包的 fork 改动时，必须在这里补一条记录。

## 比较基线

- Fork remote：`origin` -> `git@github.com:team-harness/paseo.git`
- 上游 remote：`upstream` -> `git@github.com:getpaseo/paseo.git`
- 初始记录基线：`upstream/main` = `f2ebac931c60ed423968f1aa07ba78c0a0b2776c`，记录于 2026-07-14。
- 最近同步基线：`upstream/main` = `9f5f5fce620684a5a5d2c74940c37482eb45feeb`，同步于 2026-07-17。
- 本次同步后的 fork 端点：`main` / `origin/main` = `a2c93f414f2ca5541a03bcded8d6016336e752f5`。

同步时以 `upstream/main` 为原作者来源，不要把 `origin` 误认为上游。

## 总体决策原则

1. 上游已经提供同等能力时，以**上游实现为准**。删除或迁移本 fork 的重复实现、测试和文案，不保留双路径。
2. 对 Status Bar、持久化数据和协议改动，先保证数据/协议兼容，再处理 UI 冲突。不得用旧 RPC 拼装新能力的降级路径。
3. 对现有 Agent 的 `workspaceId`、usage ledger、session pin 等持久化数据，不能直接删除记录；先检查迁移和归属关系。
4. `.codestable/` 是 fork 的工程流程和审计资产，不改变 Paseo 运行时行为。上游若也引入同名流程文件，保留双方必要约束，避免用上游版本整目录覆盖。
5. 解决冲突后，更新本文件中的“同步状态”和“上游等价实现”判断，并在对应区域跑目标测试。

## 最近同步判断

### 2026-07-17: `upstream/main` `9f5f5fce6`

- `git fetch upstream --prune` 后，上游端点仍是当前 fork 已合入的祖先，没有新增提交需要 merge，也没有需要以下游实现替代的同等功能。
- 计划任务选择已有 Agent 仍没有上游等价实现，保留 fork 的表单、CLI 与持久化语义。
- Status Bar 不再维护独立 session Pin：已改为直接复用侧边栏 workspace 的 `pinnedAt`、列表投影与 `setWorkspacePinned` API；旧 `status.session_pins` 协议、client API、server store 和 capability gate 已删除（`a2c93f414`）。

### 2026-07-16: `upstream/main` `04e893417`

- 合入上游的桌面 stale daemon lock 恢复、子 Agent 可见性、工具调用展示、desktop/sidebar 布局和项目打开流程修复。
- 上游没有实现 Status Bar 汇总与多 Host pin、既有 Agent 计划任务、GPT-5.5/GPT-5.6 usage 定价、Markdown 预览/原始内容切换或 Task Agent workspace 继承，fork 对应实现全部保留。
- 冲突处理采用上游的 `NavigateToWorkspaceInput` draft target API，删除 fork 旧的 `openDraftTab` 路径；保留 Markdown 切换、Status Bar 底部 inset、usage ledger 终态清理，并与上游 agent run settle 逻辑组合。

## 变更清单

### 1. 全局 Status Bar 与状态汇总

**状态**：fork 核心能力，持续演进中。主要提交：`0319c4a4f`、`242ba12b2`、`c6b9dca11`、`a01e9f27a`、`73ab4efa7`、`74438fc8`、`d8b5e63c8`、`611d1b093`、`51798b7ff`、`a2c93f414`。

**用户可见行为**：

- 底部全局 Status Bar 展示 token、费用、运行/需要注意/最近会话，并提供会话导航。
- 按 host 获取 `status.summary`；客户端可合并多个已连接 host 的信息，并在会话/历史项显示 host。状态栏的 Pin 直接复用侧边栏 workspace 的 `pinnedAt`、列表投影和 `setWorkspacePinned` API，因此两处展示与置顶/取消置顶行为一致。
- 会话以一级 Agent 聚合；子 Agent 的运行或等待状态汇总到根 Agent，避免大量子 Agent 淹没列表。
- 历史只显示当前已加载集合中的一级、非 `closed` Agent；支持刷新、workspace Pin 和紧凑/桌面布局。
- 空闲与运行中使用同一状态栏结构；错误目前只显示计数，不新增错误会话面板或旧 RPC fallback。

**关键边界与冲突热点**：

- 协议/SDK：`packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts`、`packages/client/src/index.ts`。
- 服务端：`packages/server/src/server/usage-ledger/`、`packages/server/src/server/status-summary/`、`packages/server/src/server/session.ts`、`packages/server/src/server/websocket-server.ts`、`packages/server/src/server/agent/agent-manager.ts`。
- 客户端：`packages/app/src/status-summary/`、`packages/app/src/app/h/[serverId]/_layout.tsx`、`packages/app/src/contexts/session-context.tsx`。

**同步规则**：

- 若上游实现 `status.summary` 或 Status Bar，先比较协议名称、feature gate、payload 和持久化边界。上游协议结构优先；将本 fork 的 usage ledger、root-agent 聚合、多 host 展示、pin 和导航逐项迁移过去。
- 保留 `server_info.features.statusSummary` 的单一 capability gate；不要回退为 client 对旧接口的 fan-out。
- 不新增 Status Bar 专用的 Pin 数据、RPC 或 capability gate。所有 Pin 都以侧边栏 workspace 为权威，状态栏仅消费共享列表投影，并通过同一 workspace Pin controller 写入。
- 上游若只实现 UI 而无相同的 daemon summary/usage ledger，不能直接替换服务端链路。
- 必跑：status-summary 相关 Vitest、`packages/app/e2e/status-bar-running-sessions.spec.ts`、`npm run typecheck`。

**设计与审计依据**：`.codestable/roadmap/global-status-bar/` 和 `.codestable/features/` 下的 status-bar / status-summary 产物。

### 2. 计划任务选择已有 Agent

**状态**：fork 功能。主要提交：`231d25f9c`、`c7132c197`。

**用户可见行为**：计划任务表单可以选择已有 Agent 作为执行目标；CLI schedule 创建参数与表单行为保持一致。

**关键文件**：

- `packages/app/src/components/schedules/schedule-form-sheet.tsx`
- `packages/cli/src/commands/schedule/create.ts`
- `packages/cli/src/commands/schedule/shared.ts`

**同步规则**：

- 如果上游已支持在计划中选择/复用已有 Agent，直接采用上游的数据模型、表单和 CLI 参数，删除本 fork 的同等分支，不维护两套选择语义。
- 若上游仅增加 UI、但没有等价 CLI 或持久化语义，先保持本 fork 实现并对齐字段命名，再补齐测试。
- 必跑：schedule form 目标测试、`packages/cli/src/commands/schedule/shared.test.ts`、`npm run typecheck`。

### 3. Codex 模型价格表

**状态**：fork 维护项。主要提交：`40cc55580`（GPT-5.5）、`7bdd79b17`（GPT-5.6）、`21ac8b8fe`（Codex usage accounting）。

**行为**：为 Codex usage 计费增加 GPT-5.5 和 GPT-5.6 定价；将 Codex app-server 的 thread 累计 token usage 归一化为 foreground turn 内的单调累计值，避免多模型调用、重复通知、resume 或 native counter reset 导致 Status Bar 费用少记。

**关键文件**：

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts`

**同步规则**：

- 上游更新同一价格表时，以其模型标识和金额为准，逐项核对 GPT-5.5 / GPT-5.6 是否已覆盖，避免重复 case 或错误覆盖顺序。
- 上游调整 Codex token usage payload 或 ledger 记账时，保留 turn 内累计、native turn id 校验和旧 payload 的单次快照兼容路径；修复不回填既有 ledger 数据。
- 必跑：`codex-app-server-agent.test.ts`、usage ledger 与 Status Bar usage 目标测试。

### 4. 桌面端本地打包兼容

**状态**：fork 打包修复，主要来自 `036d6108b`、`cafe5188a`。

**行为**：保留 macOS desktop 打包所需的 entitlements 与 daemon packaging 测试，并允许 desktop 开发环境在 React DevTools 下载失败时继续运行。

**关键文件**：

- `packages/desktop/build/entitlements.mac.plist`
- `packages/desktop/build/entitlements.mac.inherit.plist`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/daemon/desktop-packaging.test.ts`

**同步规则**：

- 上游调整 Electron 版本、签名、entitlements 或 daemon 打包时，先保留本 fork 的 macOS 打包约束，再按上游机制重写；不要只解决 TypeScript 冲突后跳过实际 arm64 DMG 验证。
- 必跑：desktop packaging 目标测试和 macOS arm64 打包/启动冒烟。
- 本地构建前删除同版本的 `Paseo-*.dmg`、`*.blockmap`、`*.zip` 和 `release/mac-arm64/`，防止误将旧产物当成新包上传。
- 上传前检查 DMG 修改时间、SHA-256 和打包后的 `app-dist` 是否包含本次功能；OSS 使用 `版本/commit SHA` 的不可变路径，不能只覆盖同名 URL。

### 5. Task Agent CLI workspace 继承

**状态**：fork 修复；替代 `80bd2adfe` 的宽泛同路径归并方案。

**行为**：Paseo-managed Agent 内的裸 `paseo run` 通过 `PASEO_AGENT_ID` 继承调用者 workspace，不再为每个 Task Agent 创建侧边栏条目。外部裸 run 与显式新 workspace/worktree 仍保持独立 workspace 语义。legacy create-agent fallback 继续复用已有目录记录，但 daemon 不再按 cwd 合并所有 workspace。

**关键文件**：

- `packages/cli/src/commands/agent/run.ts`
- `packages/protocol/src/messages.ts`
- `packages/server/src/server/websocket-server.ts`
- `skills/paseo/SKILL.md`
- `packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts`
- `packages/server/src/server/workspace-registry-bootstrap.ts`

**同步规则**：

- 同 cwd workspace 可以合法并存，不能只凭路径自动合并或在 UI 层去重。
- Agent 内 CLI 回退必须复用 `PASEO_AGENT_ID` 对应的 workspace；无法恢复时显式失败，不能静默创建。
- 保留 `server_info.features.agentWorkspaceInheritance` 的单一 capability gate；旧 daemon 提示更新 host，不用旧 RPC 组合降级实现。
- 必跑：CLI run、workspace provisioning、workspace bootstrap 目标测试。

### 6. Markdown 预览切换原始内容

**状态**：待提交的本地功能。

**行为**：Markdown 文件仍默认渲染预览；文件页顶部提供图标按钮，可切换到带行号和语法高亮的原始内容视图。切换状态仅作用于当前文件，切换到其他文件时恢复预览。带行号定位的 Markdown 链接保持原始内容视图，以保留定位高亮。

**关键文件**：

- `packages/app/src/components/file-pane.tsx`
- `packages/app/src/components/file-pane-render-mode.ts`
- `packages/app/src/i18n/resources/*.ts`

**同步规则**：

- 上游若加入 Markdown source/preview 模式，优先采用其状态模型和控件位置；保留“行定位时强制原始内容”的行为，除非上游提供等价定位能力。
- 不新增文件读取 RPC 或缓存层，继续复用 `FilePane` 的既有文件读取与代码高亮路径。
- 必跑：`file-pane-render-mode.test.ts`、`resources.test.ts`、`npm run typecheck`。

## 同步上游操作清单

1. 先确认工作区干净或把本地未提交改动隔离；当前待提交的变更必须单独处理，不能混入上游 merge。
2. `git fetch upstream`。GitHub 网络不通时，先检查本机代理后再配置当前命令/会话使用代理。
3. 阅读 `git log --oneline HEAD..upstream/main`，并对照本文件的“关键文件”和“同步规则”。
4. 合并 `upstream/main`。冲突优先级：协议/持久化 -> 服务端 -> client SDK -> Status Bar UI -> schedule UI/CLI -> desktop 打包 -> 测试与文档。
5. 对每个上游同等能力做明确决定：`采用上游并删除 fork 重复代码`、`上游为基础迁移 fork 扩展`、或 `保留 fork 实现`。把决定写回本文件。
6. 执行受影响区域的目标测试、`npm run format`、`npm run lint -- <changed-files>`、`npm run typecheck`；涉及桌面端时额外构建 macOS arm64 安装包。
7. 更新“比较基线”、新增/修改提交号和同步日期，再提交 merge 结果。

## 新条目模板

```markdown
### {能力名称}

**状态**：fork 功能 | fork 修复 | 待提交 | 已由上游替代。
**提交**：`{sha}`。
**行为**：{用户可见或运行时变化}。
**关键文件**：`{path}`。
**同步规则**：{上游等价时的取舍、不可破坏的兼容/数据约束}。
**验证**：`{目标测试或构建命令}`。
**最近同步判断**：{日期、上游版本、最终决定}。
```
