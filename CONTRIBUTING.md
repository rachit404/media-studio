# Contributing

Thanks for helping. Please read [CLAUDE/principles.md](CLAUDE/principles.md) and [CLAUDE/workflow.md](CLAUDE/workflow.md); they apply to every contributor, human or AI.

## Workflow

1. Branch from `claude-takeover` (the integration branch): `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. Make small commits using [Conventional Commits](https://www.conventionalcommits.org/) (`feat(image): add overlay blend shader`). PR titles use the same format.
3. Add tests with the change. Run `pnpm check` (and `pnpm test:e2e` for UI changes) before opening a PR.
4. Link the requirement IDs from `docs/product/requirements.md` and update docs or ADRs when behaviour or architecture changes.

## Rules that CI enforces

- Strict TypeScript, no `any`; module boundaries from `docs/engineering/repo-structure.md`; no browser media APIs outside adapter packages.
- Colours only through the semantic tokens in `apps/web/src/styles/theme.css`; contrast checked in both themes.
- Dependencies: permissive licences only (see ADR-0011), exact versions, a stated purpose. `pnpm check:licences` must pass.
- Privacy: no network calls to third parties, no analytics, no media or secrets in commits, no personal paths.

## Sign-off

By contributing you agree your work is licensed under Apache-2.0. Add `Signed-off-by:` (`git commit -s`) to confirm the Developer Certificate of Origin.

## Maintainer note

Branch protection for `main`/`claude-takeover` (required checks, no force-push) is configured in GitHub repository settings; it cannot be set from the repository files.
