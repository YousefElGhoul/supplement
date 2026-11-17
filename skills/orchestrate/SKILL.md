---
name: orchestrate
description: Coordinate worker agents through Herdr. Use when the user asks to orchestrate, coordinate, or delegate work to agents, including requests like "orchestrate <model> through <harness>". Accept natural phrasing; discussing orchestration alone is not permission to launch workers.
---

# Orchestrate

Use the appropriate official Herdr skill for execution mechanics; do not duplicate its command instructions here:

- **Herdr TUI:** [`herdr`](https://github.com/herdrdev/herdr/blob/master/skills/herdr/SKILL.md), installed with `npx skills add herdrdev/herdr --skill herdr -g`. It orchestrates through `herdr`.
- **Herdr GUI/Core:** [`herdr-core`](https://github.com/herdrdev/herdr-core/blob/master/skills/herdr-core/SKILL.md), installed with `npx skills add herdrdev/herdr-core --skill herdr-core -g`. It orchestrates through `hc`; use `herdr-app` only for visible window layout and controls.

Honor the environment the user requests. If it is unclear from the request and session context, clarify before proceeding.

## Prepare

- Remain the coordinator; named models are workers. Do not implement unless the user explicitly asks you to.
- Honor the user's orchestration instructions without requiring a fixed prompt format.
- Extract choices from the request and conversation. Clarify consequential gaps before launching; do not silently apply saved defaults.
- Propose the task split, brief/result paths, workspace arrangements, concurrency, and recovery boundaries as appropriate to the task. Trust your judgment rather than turning preparation into an exhaustive questionnaire.
- When worker models are unspecified, discover currently available frontier GPT and Claude options and offer choices. Recommend OpenCode for GPT and Claude Code for Claude unless the user specifies otherwise. Do not hardcode model names or silently substitute unavailable choices.

## Approve

Present the orchestration plan and wait for approval before launching workers, even when all necessary information was supplied.

Respect the host's actual planning and permission workflow:

- In Claude Code Plan mode, use its native plan-file and approval/exit-plan flow. Proceed only after approval and an execution-capable transition.
- In OpenCode Plan mode, present the plan in conversation unless instructed otherwise. Wait for the user to switch to Build and authorize execution.
- Already being in Build, Auto, or another execution-capable mode does not replace plan approval.

Do not bypass planning restrictions by delegating implementation to workers.

## Coordinate

Once approved and permitted, write the briefs and orchestrate through the selected Herdr environment. Delegate implementation, including integration fixes, unless authorized to implement yourself.

Choose direct inspection and verification, reviewer workers, or both according to task complexity. Propose reviewer models separately where useful, including different models for independent review. Verify actual results rather than accepting a worker's completion claim alone.

Handle routine steering within the approved plan. Bring material changes to scope, worker roster/models, or workspace strategy back to the user for approval.
