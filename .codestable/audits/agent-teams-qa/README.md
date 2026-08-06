# Agent Teams — Web QA evidence

Produced by `packages/app/e2e/browser/team-evidence.spec.ts` against an isolated
daemon and the mock provider. Re-run with:

```
npx playwright test --config packages/app/playwright.config.ts --project=browser team-evidence.spec.ts
```

Every shot is taken after an assertion on the same screen, so a screenshot of
the wrong state fails the run rather than landing here.

| File                                   | What it shows                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `01-new-team-entry.png`                | New Team in the workspace header menu                                                |
| `02-new-team-form.png`                 | The form: name, task, lead provider, one member                                      |
| `03-new-team-confirm.png`              | The confirmation, stating the agent count before spending it                         |
| `04-team-panel.png`                    | The panel as it opens — empty room, roster on the right                              |
| `05-team-room-conversation.png`        | Two members talking, named by their roster roles                                     |
| `06-team-room-person-posted.png`       | A person joining the conversation through the composer                               |
| `07-team-room-folded-message.png`      | A 40-line post folded to twelve, with the rest offered                               |
| `08-team-permissions-aggregated.png`   | Two members blocked at once — the lead's own actions, the reviewer's fallback pair   |
| `09-team-permissions-one-answered.png` | One answered, the other still waiting                                                |
| `10-sidebar-team-entry.png`            | The team under its workspace in the sidebar                                          |
| `11-archive-confirmation.txt`          | The archive confirmation's text (`window.confirm` does not render into a screenshot) |
| `12-team-panel-compact.png`            | Compact: the roster moves below the room                                             |

## What the first run showed, and what was done about it

The screenshots caught three things no assertion did. All three are fixed; the
files here are from the run after the fix.

1. **The room filled from the top** — messages pinned to the top of an empty
   column with the composer at the bottom, which read as a rendering fault next
   to every other chat surface in the app. `listContent` now grows and justifies
   to the end.
2. **"Waiting on you" appeared twice, adjacent** — once as the team's activity
   under its name, once as the permissions section heading. The heading is gone;
   the header already says it.
3. **The panel was sparse and loud** — a full-width red Archive slab, roster
   rows with no grouping, and `lead (lead)`. Archive is a small outline button,
   roster rows are separated, and a member whose role is already "lead" is not
   labelled twice.

What is still open, and is a design call rather than a defect: messages carry no
timestamp and no author avatar, so a long room is harder to scan than the agent
stream beside it.

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

The mock provider is what makes this deterministic; a real-provider smoke over
the same path (create → dispatch → settle → report → permission → post →
archive) is still owed.
