# Agent Teams — Web QA evidence

Produced by `packages/app/e2e/browser/team-evidence.spec.ts` against an isolated
daemon and the mock provider. Re-run with:

```
npx playwright test --config packages/app/playwright.config.ts --project=browser team-evidence.spec.ts
```

Every shot is taken after an assertion on the same screen, so a screenshot of
the wrong state fails the run rather than landing here.

The plan called for walking this by hand with `mcp__paseo__browser_*`. That
browser host cannot reach Metro on loopback — `ERR_CONNECTION_REFUSED (-102)`
for both `localhost:8081` and `127.0.0.1:8081` while `curl` to the same URL
returned 200, and the LAN address answered `000`. The Playwright harness covers
the same surfaces, and it re-runs in CI, so the walk moved there.

| File                                    | What it shows                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `01-new-team-entry.png`                 | New Team in the workspace header menu                                                |
| `02-new-team-form.png`                  | The form: name, task, lead provider, one member                                      |
| `03-new-team-confirm.png`               | The confirmation, stating the agent count before spending it                         |
| `04-team-panel.png`                     | The panel as it opens — empty room, roster across the top                            |
| `05-team-room-conversation.png`         | Two members talking, each with an avatar, role name and time                         |
| `06-team-room-person-posted.png`        | A person joining the conversation through the composer                               |
| `07-team-room-folded-message.png`       | A 40-line post folded to twelve, with the rest offered                               |
| `08-team-room-mention-autocomplete.png` | `@re` in the composer, `@reviewer` offered above it                                  |
| `09-team-permissions-aggregated.png`    | Two members blocked at once — the lead's own actions, the reviewer's fallback pair   |
| `10-team-permissions-one-answered.png`  | One answered, the other still waiting                                                |
| `11-team-room-chips.png`                | A body naming people and work: `@reviewer` drawn as a mention, `#id` as task chips   |
| `12-team-tasks.png`                     | The task tab — Done, Failed, and a canceled row that never dispatched                |
| `13-team-tasks-highlighted.png`         | A chip answered: tapping `#id` switches tabs and rings the row it named              |
| `14-sidebar-team-entry.png`             | The team under its workspace in the sidebar                                          |
| `15-archive-confirmation.txt`           | The archive confirmation's text (`window.confirm` does not render into a screenshot) |
| `16-team-panel-compact.png`             | Compact: roster, tabs and room all stacked in one column                             |

## The seeded ledger, and the state it cannot show

Steps 11–13 need a task ledger. Those rows would come from the lead calling
`assign_task`, and the mock provider this team runs on cannot reach MCP, so the
spec writes `<paseoHome>/teams/inbox/<teamId>.inbox.json` itself. That is not a
stub: `TeamInbox` re-reads the file on every call and caches nothing, so the
file is the ledger the panel reads. It has to land before the panel mounts —
the client lists the ledger once and afterwards only follows
`team.tasks.update`, which a write from outside the daemon does not raise.

Every seeded row is settled, and that bounds what these screenshots prove.
`TeamPump.settleDispatched` looks up the turn behind every `dispatched` row and
settles it `unknown` when that turn is not running; no turn id invented by a
test belongs to a real turn, so a seeded in-flight row is settled out from under
the screenshot by the next pass. The first run of step 12 caught exactly this —
a row seeded `dispatched` rendered as "Ended", which is `outcome.unknown`, not
`state.dispatched`.

So the live `queued → dispatched → settled` transitions are not in this
directory. They are in `.codestable/audits/agent-teams-fix-verify/`, proven
against real providers with the push stream recorded per revision.

## What the earlier runs showed, and what was done about it

The screenshots caught four things no assertion did. All four are fixed; the
files here are from the run after the fixes.

1. **The room filled from the top** — messages pinned to the top of an empty
   column with the composer at the bottom, which read as a rendering fault next
   to every other chat surface in the app. `listContent` now grows and justifies
   to the end.
2. **"Waiting on you" appeared twice, adjacent** — once as the team's activity
   under its name, once as the permissions section heading. The heading is gone;
   the header already says it.
3. **The panel was sparse and loud** — a full-width red Archive slab, roster
   rows with no grouping, and `lead (lead)`. Archive moved into the header's ⋯
   menu, the roster became a strip of avatars, and a member whose role is
   already "lead" is not labelled twice.
4. **Messages had no timestamp and no author avatar**, so a long room was harder
   to scan than the agent stream beside it. Left open as a design call last
   round; it is what the conversation-first rewrite closed.

## Platform matrix

Only the Web row is covered here. The rest is a person on real devices.

| Platform        | Desktop / compact | Tested | Notes                                |
| --------------- | ----------------- | ------ | ------------------------------------ |
| iOS             | compact           |        |                                      |
| Android         | compact           |        |                                      |
| Web             | both              | ✅     | This directory; 1440×900 and 420×900 |
| Desktop macOS   | desktop           |        |                                      |
| Desktop Windows | desktop           |        |                                      |
| Desktop Linux   | desktop           |        |                                      |

The mock provider is what makes this deterministic. The real-provider path
(create → dispatch → settle → report → permission → post → archive) is covered
in `.codestable/audits/agent-teams-real-provider-smoke/`, and its two defects
are re-verified in `.codestable/audits/agent-teams-fix-verify/`.
