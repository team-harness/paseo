---
doc_type: feature-evidence-pack
feature: 2026-07-06-status-summary-protocol
status: generated
---

# 2026-07-06-status-summary-protocol evidence pack

## 1. Scope

- Design: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-design.md`
- Checklist: `.codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml`

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
      "command": "npx vitest run packages/protocol/src/messages.test.ts --bail=1 -t status-summary",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  4 passed | 17 skipped (21)\n   Start at  11:51:09\n   Duration  252ms (transform 92ms, setup 0ms, import 157ms, tests 5ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/server/src/server/status-summary/status-summary-service.test.ts --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Start at  11:51:10\n   Duration  128ms (transform 23ms, setup 0ms, import 34ms, tests 5ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/server/src/server/session.test.ts --bail=1 -t status-summary",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  2 passed | 129 skipped (131)\n   Start at  11:51:10\n   Duration  1.18s (transform 731ms, setup 0ms, import 1.09s, tests 5ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/client/src/daemon-client.test.ts --bail=1 -t status-summary",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  1 passed | 96 skipped (97)\n   Start at  11:51:12\n   Duration  355ms (transform 173ms, setup 0ms, import 258ms, tests 6ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-004",
      "core": false,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/client/src/index.test.ts --bail=1 -t status-actions",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/.paseo/worktrees/3rvhzvvc/global-status-bar-usage-history\n\n\n Test Files  1 passed (1)\n      Tests  1 passed | 6 skipped (7)\n   Start at  11:51:13\n   Duration  333ms (transform 136ms, setup 0ms, import 221ms, tests 23ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-005",
      "core": false,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run typecheck",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 typecheck\n> npm run typecheck --workspaces --if-present\n\n\n> @getpaseo/expo-two-way-audio@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/highlight@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/protocol@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/client@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/server@0.1.104-beta.3 typecheck\n> tsgo -p tsconfig.server.typecheck.json --noEmit\n\n\n> @getpaseo/app@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/relay@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/website@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/desktop@0.1.104-beta.3 typecheck\n> tsgo --noEmit -p tsconfig.json\n\n\n> @getpaseo/cli@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n",
      "stderr": "",
      "id": "CMD-006",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run lint",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 lint\n> oxlint\n\nFound 0 warnings and 0 errors.\nFinished in 461ms on 2444 files with 177 rules using 10 threads.\n",
      "stderr": "",
      "id": "CMD-007",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run format:check",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 format:check\n> oxfmt --check .\n\nChecking formatting...\n\nAll matched files use the correct format.\nFinished in 1183ms on 2690 files using 10 threads.\n",
      "stderr": "",
      "id": "CMD-008",
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

Design bytes: 22347
Checklist bytes: 4558

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
        ".codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-checklist.yaml",
        "packages/client/src/daemon-client.test.ts",
        "packages/client/src/daemon-client.ts",
        "packages/client/src/index.test.ts",
        "packages/client/src/index.ts",
        "packages/protocol/src/messages.test.ts",
        "packages/protocol/src/messages.ts",
        "packages/server/src/server/bootstrap.ts",
        "packages/server/src/server/session.test.ts",
        "packages/server/src/server/session.ts",
        "packages/server/src/server/websocket-server.ts",
        ".codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-evidence-pack.json",
        ".codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-evidence-pack.md",
        ".codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-scope-gate.json",
        "packages/server/src/server/status-summary/status-summary-service.test.ts",
        "packages/server/src/server/status-summary/status-summary-service.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-06-status-summary-protocol/status-summary-protocol-dod-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-06-status-summary-protocol",
        "packages/protocol/src/messages.ts",
        "packages/protocol/src/messages.test.ts",
        "packages/server/src/server/status-summary",
        "packages/server/src/server/session.ts",
        "packages/server/src/server/session.test.ts",
        "packages/server/src/server/websocket-server.ts",
        "packages/server/src/server/bootstrap.ts",
        "packages/client/src/daemon-client.ts",
        "packages/client/src/daemon-client.test.ts",
        "packages/client/src/index.ts",
        "packages/client/src/index.test.ts"
      ]
    }
  ],
  "providers": {}
}
```
