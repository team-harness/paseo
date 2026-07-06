---
doc_type: feature-evidence-pack
feature: 2026-07-06-usage-history-persistence
status: generated
---

# 2026-07-06-usage-history-persistence evidence pack

## 1. Scope

- Design: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md`
- Checklist: `.codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml`

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
      "command": "npx vitest run packages/server/src/server/usage-ledger/usage-ledger.test.ts --bail=1",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/work/github/paseo\n\n\n Test Files  1 passed (1)\n      Tests  8 passed (8)\n   Start at  11:14:31\n   Duration  137ms (transform 32ms, setup 0ms, import 63ms, tests 15ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-001",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 -t \"usage ledger\"",
      "exit_code": 0,
      "stdout": "\n RUN  v4.1.7 /Users/wyattfang/work/github/paseo\n\n\n Test Files  1 passed (1)\n      Tests  3 passed | 116 skipped (119)\n   Start at  11:14:31\n   Duration  441ms (transform 221ms, setup 0ms, import 312ms, tests 69ms, environment 0ms)\n\n",
      "stderr": "",
      "id": "CMD-002",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run typecheck",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 typecheck\n> npm run typecheck --workspaces --if-present\n\n\n> @getpaseo/expo-two-way-audio@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/highlight@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/protocol@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/client@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/server@0.1.104-beta.3 typecheck\n> tsgo -p tsconfig.server.typecheck.json --noEmit\n\n\n> @getpaseo/app@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/relay@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/website@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n\n> @getpaseo/desktop@0.1.104-beta.3 typecheck\n> tsgo --noEmit -p tsconfig.json\n\n\n> @getpaseo/cli@0.1.104-beta.3 typecheck\n> tsgo --noEmit\n\n",
      "stderr": "",
      "id": "CMD-003",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run lint",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 lint\n> oxlint\n\nFound 0 warnings and 0 errors.\nFinished in 558ms on 2442 files with 177 rules using 10 threads.\n",
      "stderr": "",
      "id": "CMD-004",
      "core": true,
      "failure_handling": "fix-or-block"
    },
    {
      "command": "npm run format:check",
      "exit_code": 0,
      "stdout": "\n> paseo@0.1.104-beta.3 format:check\n> oxfmt --check .\n\nChecking formatting...\n\nAll matched files use the correct format.\nFinished in 1500ms on 2681 files using 10 threads.\n",
      "stderr": "",
      "id": "CMD-005",
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

Design bytes: 25012
Checklist bytes: 3532

## 5. Residual Risks

- none

## 6. Provider Signals

```json
{
  "archguard": {
    "status": "available",
    "signal_type": "availability",
    "summary": "archguard binary found at /opt/homebrew/bin/archguard; risk summary not collected in this minimal mode",
    "warnings": ["archguard available but risk summary not collected"]
  },
  "meta_cc": {
    "status": "unavailable",
    "reason": "meta-cc summary not found; realtime session collection is out of scope",
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
        "docs/data-model.md",
        "packages/server/src/server/agent/agent-manager.test.ts",
        "packages/server/src/server/agent/agent-manager.ts",
        "packages/server/src/server/bootstrap.ts",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-checklist.yaml",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design-review.md",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-design.md",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-evidence-pack.json",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-evidence-pack.md",
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-scope-gate.json",
        ".codestable/roadmap/global-status-bar/goal-state.yaml",
        "packages/server/src/server/usage-ledger/index.ts",
        "packages/server/src/server/usage-ledger/usage-ledger.test.ts"
      ],
      "ignored_machine_artifacts": [
        ".codestable/features/2026-07-06-usage-history-persistence/usage-history-persistence-dod-results.json"
      ],
      "allowed_prefixes": [
        ".codestable/features/2026-07-06-usage-history-persistence",
        "packages/server/src/server/usage-ledger",
        "packages/server/src/server/agent/agent-manager.ts",
        "packages/server/src/server/agent/agent-manager.test.ts",
        "packages/server/src/server/bootstrap.ts",
        "docs/data-model.md",
        ".codestable/roadmap/global-status-bar/goal-state.yaml"
      ]
    }
  ],
  "providers": {}
}
```
