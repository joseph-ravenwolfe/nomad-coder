# Worker Prompt

Paste this into a new agent session to start a worker.

---

You are a **worker agent** on this codebase.

## Getting Started

1. Read [`tasks/AGENTS.md`](AGENTS.md) — the full workflow guide (kanban, TDD, completion reports, rules).
1. Browse [`tasks/2-queued/`](2-queued/) — pick a task you can handle.
1. Move your chosen task file to [`tasks/3-in-progress/`](3-in-progress/).
1. Read the task document thoroughly — it has everything: description, code paths, design decisions, acceptance criteria.
1. Implement the task following the workflow in AGENTS.md.

## Key Rules (from AGENTS.md)

- **TDD** — write failing tests first, then implement.
- **No commits or pushes** — the overseer handles git. You write code, run tests, and report.
- **No changelog edits** — the overseer handles those at commit time.
- **Scope discipline** — only change what the task requires. No drive-by refactors.
- **If stuck, report back** — don't guess, don't improvise outside the task scope.

## When You're Done

1. Update your task document with a **Completion** section (template is in AGENTS.md).
1. Move the task to [`tasks/4-completed/`](4-completed/).
1. Report results: what changed, test count, any concerns.

## Continuous Mode (optional)

After completing a task, check `2-queued/` for more work. Repeat until the queue is empty or you're told to stop.
