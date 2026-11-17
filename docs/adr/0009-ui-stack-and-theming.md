# ADR-0009: UI stack and global theming

- **Status:** Proposed. UI primitive library intentionally left open (2026-11-17)

## Decision
- **React 19 + TypeScript (strict) + Tailwind CSS v4**, as requested by the owner.
- **One theme source of truth.** All design tokens (colour, spacing, radius, type scale, shadows, z-index, motion) are defined once in a single
  CSS file using Tailwind v4's `@theme`, which generates native CSS variables and matching utilities.
- **Semantic tokens only.** Components use names such as `surface`, `surface-raised`, `text-muted`, `accent`, `border`, `danger`, never raw palette
  colours or arbitrary hex values. A lint rule fails the build on raw colour classes, so "change one place, change the whole app" stays true.
- **Themes** (dark default, light) are switched by a `data-theme` attribute that re-points the CSS variables. Do not use `@theme inline` for themed
  colours: it bakes values into utilities and breaks variable overrides in dark mode ([community guidance](https://sharedcontext.ai/skills/external/lohnim/tailwind-v4-dark-mode); verify against the official Tailwind docs at M0).
- Colours defined in OKLCH for perceptual consistency.
- **Performance rule:** per-frame UI (timeline playhead, canvas overlays, scrubbing) must not re-render through React state. It uses canvas or
  imperative DOM/CSS-variable updates; React owns panels and forms.

## Open decision: headless UI primitives
Needed for accessible menus, dialogs, tabs, sliders and popovers. Candidates:
| Candidate | Licence | Note |
|---|---|---|
| Radix UI primitives | MIT | Widely used, mature |
| React Aria Components (1.22) | Apache-2.0 | Strongest accessibility and keyboard handling, built-in drag-and-drop; larger |
| Base UI (1.0 RC) | MIT | Newer, still pre-1.0 stable |

Decision deferred to the UI/UX specification (step 4), evaluated on a11y, keyboard behaviour, bundle size and maintenance.

## Consequences
- The timeline and canvas are custom components, not off-the-shelf widgets.
- Theme and token docs live in `docs/ui/` (to be written in step 4).

## Update (2026-11-17)
The open decision on UI primitives is proposed in [ADR-0013](0013-ui-primitives-react-aria.md) (React Aria Components, provisional).
