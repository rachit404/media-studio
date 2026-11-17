# Media Studio: instructions for Claude Code

Privacy-first, local-first browser image + video editor. React 19, TypeScript 6.0 (strict), Tailwind v4, pnpm workspaces.
Index of project guidelines: `CLAUDE/README.md`. Full design: `docs/`.

## Always

- **Branches:** `main` never receives new commits. `claude-takeover` is the integration branch (the "main" for Claude Code). Work on `feat/...` branches cut from it; merge back with `--no-ff` only after `pnpm check` passes.
- **Plan:** follow `CLAUDE/plan.md` (10 steps), one step at a time; update its status when a step is merged.
- **Quality:** no placeholder features that look real; no `any`; no raw colours (tokens in `apps/web/src/styles/theme.css`); browser media APIs only in adapter packages. Lint and boundary checks enforce this.
- **Tests ship with the feature.** Run `pnpm check` before every commit.
- **Tokens:** follow `CLAUDE/token-rules.md` (targeted reads, parallel calls, short answers, narrow test runs).
- **Python:** not used here. If a task truly needs it, create a venv (`python -m venv .venv`, gitignored) first.
- **Git:** Conventional Commits with the attribution trailer the session requires. Never commit secrets, media or personal paths. Push only when the user asks, never `main`, never force-push.
- **Questions:** ask only when genuinely blocked; otherwise pick the documented default and note it.
