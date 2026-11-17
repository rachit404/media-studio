# Git and delivery workflow

## Branch model
- `main`: **frozen**. No new commits, ever, from Claude work.
- `claude-takeover`: integration branch and source of truth for Claude Code. Created from `main`; everything is merged here.
- Work branches (cut from `claude-takeover`, one per plan step or concern): `feat/<step>-<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.

## Per step
1. `git switch claude-takeover && git switch -c feat/<step>-<topic>`
2. Implement in small logical commits (Conventional Commits, e.g. `feat(image): add overlay blend shader`). Tests in the same commit as the code.
3. `pnpm check` (lint, format, typecheck, boundaries, theme contrast, unit/policy tests, build, size, licences) and `pnpm test:e2e` when UI changed. Fix, do not skip.
4. `git switch claude-takeover && git merge --no-ff feat/<step>-<topic> -m "merge: <step>"`
5. Update `CLAUDE/plan.md` status and `docs/STATUS.md` on the work branch before merging.

## Commit rules
- Message ends with the attribution trailer the session specifies. Imperative subject under 72 chars; body explains why.
- Never commit: secrets, `.env*`, media files, caches, build output, personal paths or usernames, spike fixtures.
- No `--no-verify`, no force-push, no history rewriting of pushed branches.

## Push rules
- Push only when the user asks. Push explicit branch names (`git push origin claude-takeover feat/...`), never `--all`, never `main`.
- After pushing, verify `origin/main` equals the original initial commit.

## Tooling rules
- Package manager: pnpm only. Pin exact versions; add a dependency only with a stated purpose and a licence check.
- Python is not used. If ever needed: `python -m venv .venv` (gitignored) and install inside it only.
- Do not start subagents or web research unless the task needs it; record research outcomes in an ADR.
