# Token-saving rules

1. **Start from `CLAUDE/plan.md`.** Do not re-read the whole `docs/` tree; grep for requirement IDs (`IMG-6`, `PERF-3`) and read only that section.
2. **Targeted reads.** Use Grep/Glob first, then Read with `offset`/`limit`. Never read lockfiles, `spikes/results/*.json`, fixtures or build output.
3. **Parallelise independent calls** in one message (writes, greps, installs that do not depend on each other).
4. **Do not re-read after Write/Edit**; the tool result is authoritative. Use Edit for changes to existing files, Write only for new files.
5. **Narrow checks while iterating:** `pnpm vitest run <file>`, `pnpm exec eslint <path>`, `pnpm --filter <pkg> typecheck`. Run the full `pnpm check` once before committing.
6. **Trim command output:** `... 2>&1 | tail -n 30`, `--reporter=dot`, `git log --oneline -n 5`, `git status --short`. Never print large JSON or logs.
7. **No subagents, no web search** unless the task needs them. Research once, record the result in an ADR, reuse it.
8. **Short replies:** status, decisions, blockers, next step. No recap of diffs, no pasted code, link files instead.
9. **Small, focused diffs;** avoid regenerating big files. Keep new docs concise and update only the affected section.
10. **Ask only when blocked.** Otherwise use the documented default, state it in one line, and continue.
