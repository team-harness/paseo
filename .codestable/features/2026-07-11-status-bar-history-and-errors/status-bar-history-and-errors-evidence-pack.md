---
doc_type: feature-evidence-pack
feature: 2026-07-11-status-bar-history-and-errors
status: generated
---

# 2026-07-11-status-bar-history-and-errors evidence pack

## 1. Scope

- Design: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md`
- Checklist: `.codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml`

## 2. DoD Results

```json
{
  "gate_id": "dod-runner",
  "stage": "implementation.before_review",
  "status": "passed",
  "blocking": [],
  "warnings": [],
  "evidence": [
    {
      "command": "mise exec nodejs@22.20.0 -- npx vitest run packages/app/src/status-summary/status-bar-running-sessions.test.tsx packages/app/src/status-summary/global-status-bar.test.tsx --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/work/github/paseo\n\n\n Test Files  2 passed (2)\n      Tests  30 passed (30)\n   Start at  10:38:47\n   Duration  566ms (transform 185ms, setup 0ms, import 292ms, tests 155ms, environment 482ms)\n\n",
      "stderr": "mise WARN  failed to write cache file: /Users/wyattfang/Library/Caches/mise/android-sdk/remote_versions-fe53a.msgpack.z Operation not permitted (os error 1)\n",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "mise exec nodejs@22.20.0 -- npm run format:files -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104 format:files\n> oxfmt packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx\n\nFinished in 37ms on 4 files using 10 threads.\n",
      "stderr": "mise WARN  failed to write cache file: /Users/wyattfang/Library/Caches/mise/android-sdk/remote_versions-fe53a.msgpack.z Operation not permitted (os error 1)\n",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "mise exec nodejs@22.20.0 -- npm run lint -- packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104 lint\n> oxlint packages/app/src/status-summary/global-status-bar.tsx packages/app/src/status-summary/status-bar-running-sessions.tsx packages/app/src/status-summary/global-status-bar.test.tsx packages/app/src/status-summary/status-bar-running-sessions.test.tsx\n\nFound 0 warnings and 0 errors.\nFinished in 62ms on 4 files with 177 rules using 10 threads.\n",
      "stderr": "mise WARN  failed to write cache file: /Users/wyattfang/Library/Caches/mise/android-sdk/remote_versions-fe53a.msgpack.z Operation not permitted (os error 1)\n",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "mise exec nodejs@22.20.0 -- npm run typecheck",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104 typecheck\n> npm run typecheck --workspaces --if-present\n\n\n> @getpaseo/expo-two-way-audio@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/highlight@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/protocol@0.1.104 pretypecheck\n> npm run generate:validators\n\n\n> @getpaseo/protocol@0.1.104 generate:validators\n> node scripts/generate-validation-aot.mjs\n\ngenerated src/generated/validation/ws-outbound.aot.ts from codegen/ws-outbound.compile.ts (WSOutboundMessageSchema)\n\n> @getpaseo/protocol@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/client@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/server@0.1.104 typecheck\n> tsgo -p tsconfig.server.typecheck.json --noEmit\n\n\n> @getpaseo/app@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/relay@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/website@0.1.104 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/desktop@0.1.104 typecheck\n> tsgo --noEmit -p tsconfig.json\n\n\n> @getpaseo/cli@0.1.104 typecheck\n> tsgo --noEmit\n\n",
      "stderr": "mise WARN  failed to write cache file: /Users/wyattfang/Library/Caches/mise/android-sdk/remote_versions-fe53a.msgpack.z Operation not permitted (os error 1)\n",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {}
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 9743
Checklist bytes: 2744

## 5. Residual Risks

- none

## 6. Provider Signals

```json
{
  "archguard": {
    "status": "skipped",
    "reason": "archguard collection disabled",
    "warnings": []
  },
  "meta_cc": {
    "status": "skipped",
    "reason": "meta-cc collection disabled",
    "warnings": []
  }
}
```

## 7. Gate Results

```json
{
  "gate_id": "scope-gate",
  "stage": "implementation.before_review",
  "status": "passed",
  "blocking": [],
  "warnings": [],
  "evidence": [
    {
      "changed_files": [
        "packages/app/src/status-summary/global-status-bar.test.tsx",
        "packages/app/src/status-summary/global-status-bar.tsx",
        "packages/app/src/status-summary/status-bar-running-sessions.test.tsx",
        "packages/app/src/status-summary/status-bar-running-sessions.tsx",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/goal-plan.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/goal-protocol.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/goal-state.yaml",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-checklist.yaml",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design-review.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-design.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.json",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-evidence-pack.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-implementation.md",
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-scope-gate.json"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-11-status-bar-history-and-errors/status-bar-history-and-errors-dod-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-11-status-bar-history-and-errors",
        ".codestable/features/2026-07-11-status-bar-history-and-errors",
        "packages/app/src/status-summary/global-status-bar.tsx",
        "packages/app/src/status-summary/status-bar-running-sessions.tsx",
        "packages/app/src/status-summary/global-status-bar.test.tsx",
        "packages/app/src/status-summary/status-bar-running-sessions.test.tsx"
      ]
    }
  ],
  "providers": {}
}
```
