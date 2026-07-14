---
doc_type: issue-review
issue: 2026-07-14-sidebar-duplicate-project-workspaces
status: blocked
reviewer: self
reviewed: 2026-07-14
round: 1
---

# 侧边栏重复项目条目代码审查报告

## 1. Scope And Inputs

- Report: `sidebar-duplicate-project-workspaces-report.md`
- Analysis: `sidebar-duplicate-project-workspaces-analysis.md`
- Fix note: `sidebar-duplicate-project-workspaces-fix-note.md`
- Implementation evidence: 目标 Vitest 3 文件共 20 个测试通过；format、目标 lint、全仓 typecheck 通过。
- Diff basis: 当前工作区中可归因的 server provisioning、bootstrap、迁移及对应测试文件。
- Baseline dirty files: `.codestable/reference/*`、`.codestable/runtime-manifest.json` 及 `solution-depth-conventions.md` 是本次范围外的既有变更，未纳入审查结论。

### Independent Review

- Detection: 当前执行环境没有 Paseo subagent 或宿主原生 Task/Agent 工具；`ocr` CLI 已安装且连通。
- 环节 A 独立隔离 Task agent: `local-only + not-available`。
- 环节 B OCR CLI: `skipped-scope-ambiguous`。工作区包含范围外的脏文件，不能按协议用裸 workspace OCR 审查；先前探测调用的输出未纳入结论。
- OCR severity mapping: High→blocking/important，Medium→nit/suggestion，Low→discarded。
- Merge policy: 已完成本地行级审查；独立 reviewer 缺失，未将本地结论伪装为独立审查。
- Gate effect: 缺少独立 Task agent，本报告不能给出 passed；需要用户确认允许 self-review 降级，或补跑独立 reviewer 后重审。

## 2. Diff Summary

- 新增：重复 workspace 归并迁移及其测试。
- 修改：Agent 创建的 workspace 解析、registry bootstrap、相关测试。
- 删除：none。
- 未跟踪 / staged：本次的迁移源码、迁移测试与 issue 文档尚未提交。
- 风险热点：启动时数据迁移、Agent 持久化归属、归档 workspace 的重新打开。

## 3. Adversarial Pass

- 假设的生产 bug：归档重复项后，后续新建 Agent 又选择到归档副本，使重复条目复活。
- 主动攻击过的反例：同 cwd 的活跃/归档记录并存、首次创建的标题保留、重复迁移重跑、不同 cwd 不合并、Agent 先重关联后归档。
- 结果：活跃优先选择和对应回归测试覆盖了复活路径；迁移测试覆盖了重关联、归档与幂等性。

## 4. Findings

### blocking

none

### important

none

### nit

none

### suggestion

none

### learning

- 对同路径 workspace 的数据修复必须先迁移 Agent 的 `workspaceId`，不能直接删除或归档记录。

### praise

- 创建路径复用了模块既有的 find-or-create 语义，未新增旁路。
- 迁移采用软归档并可幂等重跑，符合现有 registry 持久化模型。

## 5. Test And QA Focus

- QA 必须重点复核：修复版 daemon 首次启动后，`CodeStable/main` 仅保留一个条目；随后在同一路径新建多个 Agent，不产生新条目。
- Evidence pack residual risks / gate warnings：独立审查环节不可用，未获得双环节 gate 放行。
- 建议新增或加强的测试：none，本次已覆盖创建复用、活跃优先、迁移重关联与幂等性。
- 不能靠 review 完全确认的点：生产 daemon 的首次启动迁移与侧边栏实时刷新。

## 6. Residual Risk

- 运行中的旧 daemon 不能安全地通过离线修改 JSON 清理：其内存缓存可能覆盖磁盘改动且不会广播 UI 更新。必须由修复版 daemon 启动迁移。
- 当前执行环境缺少独立 Task agent，review gate 仍待用户确认 self-review 降级或补跑独立 reviewer。

## 7. Verdict

- Status: blocked
- Next: 用户确认允许 self-review 降级，或在具备独立 Task agent 的环境补跑本审查；代码修复及验证已完成。
