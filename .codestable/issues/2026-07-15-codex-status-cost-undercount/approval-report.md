---
doc_type: approval-report
unit: 2026-07-15-codex-status-cost-undercount
status: approved
reason: review-authorization
approvals:
  fix-completion: approved
created_at: 2026-07-15
---

# Approval Report

## Decision History

- 2026-07-15：Owner 确认 issue report，批准 P1 standard path，并要求继续修复与 review。
- 2026-07-15：Owner 确认根因分析并批准方案 A，不自动回填既有错误历史。
- 2026-07-15：方案 A 实现完成；round 1 主审发现 native turn 尚未建立时的迟到 usage 污染，并以 RED/GREEN 用例修复。
- 2026-07-15：生产时序修复后完成 round 2 Claude/Opus + OCR 双环节完整复审，最终无 blocking/important，review status 为 passed。
- 2026-07-15：Owner 回复“确认修复完成并提交推送”，批准 `ConfirmFixCompletion` 并授权 scoped commit/push。

## Decision Needed

`ConfirmFixCompletion` 已批准：Owner 接受当前方案 A 实现、验证结果与已记录残余风险，并授权更新 `changes-by-me.md` 后执行 scoped commit/push。

## Why Now

`cs-issue` standard path 要求在 review passed 后取得最终 owner sign-off，才能结束 issue 并进入提交。实现与两轮 review 已完成，当前没有代码门禁阻塞。

## Context

- Codex adapter 现在以 thread `total` delta + request `last` 安全基线生成 per-turn 单调累计 usage。
- foreground turn id 使用 UUID，避免跨 session/daemon 命中旧持久化 basis。
- native turnId 在 native turn 尚未建立、当前 turn 和跨 turn 三种窗口均严格隔离；缺失 turnId 的旧 payload 兼容路径保留。
- 目标回归 10 passed，typecheck 全 workspace 通过，lint 为 0 warnings/0 errors。
- round 2 独立 Claude/Opus reviewer 与 OCR 均完成，无 blocking/important。
- ledger、AgentManager bridge、Status summary RPC 与多 Host app 聚合没有修改。
- 未重启 6767 daemon，未改写生产 ledger，未自动回填既有历史。
- Claude provider 两个既有脏文件与 `.codegraph/` 始终排除，真实 staged diff 为空。

## Options

1. **确认修复完成并提交推送（推荐）**：接受当前实现与残余风险；随后更新 `changes-by-me.md`、运行提交前 formatter、只 stage 本 issue 可归因文件、commit 并 push `main`。
2. **要求调整**：指出需要修改的代码、测试、文档或残余风险处理；checkpoint 保持 pending 并返回 fix/review 循环。
3. **拒绝完成**：不提交当前修复，记录拒绝原因并停止。

## Recommendation

已采纳：确认修复完成并授权 scoped commit/push。核心少算路径与复审发现的迟到通知窗口均已有 RED/GREEN 证据，双环节独立 review 已通过。

## Risks And Tradeoffs

- 修复部署前已经少记的 today/lifetime 数据不会自动恢复。
- Codex 内建 child-thread usage 仍未归入 root ledger，费用归属留待单独定义。
- 会话最后一个 turn 若在 completion 后才发送末次 usage，仍可能漏记该末次增量；正常通知顺序下风险低。
- 单 foreground turn 内异常出现多个 native turn 的序列未经生产验证。
- Claude/OpenCode 是否存在同类 ordinal basis 碰撞尚未诊断，超出本 Codex issue。

## Non-Automatic Actions

本次确认仍不授权重启 6767 daemon、清理/重写生产 ledger、transcript 回填、修改用户已有 Claude provider 文件、纳入 `.codegraph/` 或 merge。确认后仅执行本 issue 的 `changes-by-me.md` 更新、提交前 `npm run format`、scoped stage、commit 与 push。

## Outcome

- `fix-completion` 已记录为 approved。
- 更新 `changes-by-me.md`，执行提交前 formatter，并完成 scoped commit/push。
- 不触碰 6767 daemon、生产 ledger、历史 transcript 回填、Claude provider 既有改动或 `.codegraph/`。
