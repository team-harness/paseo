---
doc_type: feature-evidence-pack
feature: 2026-07-06-app-status-summary-store
status: generated
---

# 2026-07-06-app-status-summary-store evidence pack

## 1. Scope

- Design: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-design.md`
- Checklist: `.codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml`

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
      "command": "npx vitest run packages/app/src/status-summary/view-model.test.ts --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Start at  12:14:19\n   Duration  128ms (transform 18ms, setup 0ms, import 23ms, tests 12ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/app/src/status-summary/push.test.ts --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  2 passed (2)\n   Start at  12:14:19\n   Duration  129ms (transform 22ms, setup 0ms, import 40ms, tests 2ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/app/src/status-summary/use-status-summary.test.ts --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  8 passed (8)\n   Start at  12:14:20\n   Duration  122ms (transform 18ms, setup 0ms, import 31ms, tests 4ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/app/src/contexts/session-context.service-status.test.ts --bail=1 -t status-summary",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  1 passed | 3 skipped (4)\n   Start at  12:14:20\n   Duration  128ms (transform 22ms, setup 0ms, import 36ms, tests 3ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-004",
      "core": false,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run typecheck",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 typecheck\n> npm run typecheck --workspaces --if-present\n\n\n> @getpaseo/expo-two-way-audio@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/highlight@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/protocol@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/client@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/server@0.1.104-beta.3 typecheck\n> tsgo -p tsconfig.server.typecheck.json --noEmit\n\n\n> @getpaseo/app@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/relay@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/website@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/desktop@0.1.104-beta.3 typecheck\n> tsgo --noEmit -p tsconfig.json\n\n\n> @getpaseo/cli@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n",
      "stderr": "",
      "id": "CMD-005",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run lint",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 lint\n> oxlint\n\nFound 0 warnings and 0 errors.\nFinished in 484ms on 2452 files with 177 rules using 10 threads.\n",
      "stderr": "",
      "id": "CMD-006",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run format:check",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 format:check\n> oxfmt --check .\n\nChecking formatting...\n\nAll matched files use the correct format.\nFinished in 1182ms on 2705 files using 10 threads.\n",
      "stderr": "",
      "id": "CMD-007",
      "core": false,
      "failure_handling": "fix-or-block"
    }
  ],
  "providers": {}
}
```

## 3. Validation Commands

Extracted from checklist `dod.commands`; see DoD Results for command status.

## 4. Scope And Cleanliness

Design bytes: 18994
Checklist bytes: 4181

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
        ".codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-checklist.yaml",
        "packages/app/src/contexts/session-context.service-status.test.ts",
        "packages/app/src/contexts/session-context.tsx",
        ".codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-evidence-pack.json",
        ".codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-evidence-pack.md",
        ".codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-scope-gate.json",
        "packages/app/src/status-summary/push.test.ts",
        "packages/app/src/status-summary/push.ts",
        "packages/app/src/status-summary/query-core.ts",
        "packages/app/src/status-summary/query.ts",
        "packages/app/src/status-summary/use-status-summary.test.ts",
        "packages/app/src/status-summary/use-status-summary.ts",
        "packages/app/src/status-summary/view-model.test.ts",
        "packages/app/src/status-summary/view-model.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-06-app-status-summary-store/app-status-summary-store-dod-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-06-app-status-summary-store",
        "packages/app/src/status-summary",
        "packages/app/src/contexts/session-context.tsx",
        "packages/app/src/contexts/session-context.service-status.test.ts"
      ]
    }
  ],
  "providers": {}
}
```
