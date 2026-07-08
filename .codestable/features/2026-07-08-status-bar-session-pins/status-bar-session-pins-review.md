---
doc_type: feature-review
feature: 2026-07-08-status-bar-session-pins
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-08
round: 2
---

# status-bar-session-pins 代码审查报告

## 1. Scope And Inputs

- Design: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-design.md`
- Checklist: `.codestable/features/2026-07-08-status-bar-session-pins/status-bar-session-pins-checklist.yaml`
- Evidence pack: none
- Gate results: none
- DoD results: none
- Implementation evidence: 当前工作区 diff、目标测试、typecheck/lint/format/scope grep。
- Diff basis: `git status --short` / 当前 unstaged + untracked diff。
- Baseline dirty files: `.codestable/reference/*` 和 `.codestable/runtime-manifest.json` 来自 CodeStable runtime sync/format，作为托管资产变更记录，不作为业务代码 finding。

### Independent Review

- Detection: Paseo subagent 可用；原生 Task agent 可用；OCR CLI 可用。
- 环节 A 独立隔离 Task agent: native-agent completed；Paseo subagent completed。
- 环节 B OCR CLI: completed。
- OCR severity mapping: Medium findings 经本地核验后转为 important/nit 或已修复；Low 未进入报告。
- Merge policy: Task agent 和 OCR findings 均逐条本地核验后合并；review-fix 后再次启动原生独立复审。
- Gate effect: 无 pending lane；`reviewer: subagent+ocr` 放行。

## 2. Diff Summary

- 新增：
  - `.codestable/features/2026-07-08-status-bar-session-pins/*`
  - `packages/server/src/server/status-summary/session-pin-store.ts`
  - `packages/server/src/server/status-summary/session-pin-store.test.ts`
  - `packages/app/src/status-summary/status-bar-session-pins.tsx`
- 修改：
  - `packages/protocol/src/messages.ts` / `packages/protocol/src/messages.test.ts`
  - `packages/server/src/server/bootstrap.ts`
  - `packages/server/src/server/session.ts` / `packages/server/src/server/session.test.ts`
  - `packages/server/src/server/status-summary/status-summary-service.ts` / test
  - `packages/server/src/server/websocket-server.ts`
  - `packages/client/src/daemon-client.ts` / test
  - `packages/app/src/status-summary/*`
  - `packages/app/src/i18n/resources/*`
  - `docs/data-model.md`
- 删除：none
- 风险热点：host persistence、RPC/protocol additive change、多客户端广播、状态栏 UI 交互。

## 3. Adversarial Pass

- 假设的生产 bug：两个客户端同时 pin 不同 session 时，异步写盘顺序导致磁盘丢失其中一个 pin。
- 主动攻击过的反例：并发 mutation、persist 失败、旧 host capability 缺失、缺 workspaceId 的 stale pinned row、row action stop propagation、app-local storage 越界、lifecycle mutation 越界。
- 结果：并发 mutation 初审确认为 blocking，已用 `mutationQueue` 串行化并补并发持久化测试；persist 失败内存提前提交由 OCR 指出，已改为 persist 成功后再提交内存。

## 4. Findings

### blocking

none。

已解决：

- REV-001 `packages/server/src/server/status-summary/session-pin-store.ts:57` `setPinned()` 初版无写序列化，多客户端并发 mutation 可能造成磁盘丢 pin。
  - Evidence: Task agent 和 Paseo reviewer 均复现该推理；OCR 同时指出 persist 失败会导致内存/磁盘发散。
  - Fix: `SessionPinStore` 增加 `mutationQueue`，把 read-modify-persist-commit 串入同一 promise chain；`persist(next)` 成功后才更新 `this.pinnedSessions`。
  - Verification: `session-pin-store.test.ts` 新增并发 mutation 与 persist failure 测试；独立复审 verdict 无 blocking。

### important

none。

核验说明：

- Task agent 提到 provider schema 可能比协议宽。经本地核验，当前 `AgentProviderSchema` 是 `z.string()`，协议也是 open string；该 finding 前提不成立。实现同时移除了不必要的 provider cast。
- 复审指出并发测试不一定在旧实现下稳定失败。实现修复本身经复审确认充分；测试确定性作为 residual risk 记录，不阻塞本 feature。

### nit

- N1 `packages/app/src/status-summary/status-bar-running-sessions.tsx` Pin mutation reject 目前只复位 pending，不弹 toast。当前 summary 是权威状态，失败不会误显示成功；后续可接入统一轻量错误提示。
- N2 `packages/app/src/status-summary/status-bar-session-pins.tsx` 无 pin 时 trigger 隐藏，空态分支不可达。design 允许无 pin 隐藏或空态；当前选择隐藏，保留空态不影响行为。

### suggestion

- 后续可给 `SessionPinStore` 注入 persist/barrier 以构造更确定的并发回归测试。

### learning

- Host-owned preference store 也需要像 usage ledger / agent storage 一样串行化 read-modify-write；原子写只保证单次文件替换，不保证多次 mutation 顺序。

### praise

- Capability gate 集中在 `use-status-summary.ts`，下游只读 `canUseStatusBarSessionPins`。
- Store 路径、schema、原子写、损坏回退已写入 `docs/data-model.md`。
- Scope grep 证实没有 app-local AsyncStorage pin、直接 router route、agent lifecycle mutation。

## 5. Test And QA Focus

- QA 必须重点复核：并发 pin、daemon 重启持久化、旧 host capability gate、row Pin click 不触发行导航、`workspaceId: null` pinned row 导航。
- Evidence pack residual risks / gate warnings：无 evidence pack；复审 residual risk 是并发测试确定性可继续增强。
- 建议新增或加强的测试：后续可给 store persist 层注入 barrier，精确模拟旧实现丢写。
- 不能靠 review 完全确认的点：真机 native compact sheet 行为；当前组件测试覆盖 compact state flow，未跑 Maestro。

## 6. Residual Risk

- `SessionPinStore` 并发测试使用真实文件系统调度，足以覆盖当前实现结果，但不保证在旧实现下稳定红灯。实现本身已由独立复审确认无 blocking。
- Pin mutation 失败 UX 仅复位 pending，不显示 toast；功能正确性不受影响。

## 7. Verdict

- Status: passed
- Next: 进入 `cs-feat` QA 阶段。
