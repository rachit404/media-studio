# ADR-0013: Headless UI primitives: React Aria Components

- **Status:** Proposed, **provisional** (validated by a short component spike in M1). Resolves the open item in [ADR-0009](0009-ui-stack-and-theming.md). (2026-11-17)

## Context
The editor needs accessible, keyboard-friendly menus, dialogs, tabs, sliders, number fields, colour pickers, trees/lists with drag-and-drop, tooltips and popovers, styled only through our Tailwind tokens. Writing these from scratch is a large accessibility risk.

## Options
| Option | Licence | Strengths | Weaknesses |
|---|---|---|---|
| **A. React Aria Components** (1.22) | Apache-2.0 | Strongest accessibility and keyboard behaviour; includes NumberField, Slider, ColorPicker, Tree/GridList, built-in drag-and-drop; unstyled, styled via data attributes + Tailwind | Larger API surface and bundle than minimal primitives; learning curve |
| B. Radix UI primitives | MIT | Widely used, simple composition | No NumberField/ColorPicker/DnD; we would write or add more libraries; long-term maintenance posture should be re-checked before adopting |
| C. Base UI (1.0 RC at time of research) | MIT | Modern, unstyled | Pre-stable at research time; smaller ecosystem |
| D. Build our own | n/a | Zero dependency | High accessibility risk and effort for a solo developer |

## Decision
Use **A: React Aria Components**, wrapped by our own `packages/ui` components so applications never import it directly (swappable). Styling uses only semantic tokens ([ADR-0009](0009-ui-stack-and-theming.md)).

## Validation (M1)
A one-to-two-day spike builds Menu, Dialog, Tabs, Slider, NumberField and Tree in both themes and checks: tree-shaken bundle cost against the shell budget, styling ergonomics with Tailwind, keyboard and screen-reader behaviour, and performance of a 1,000-row layer tree. If it fails, fall back to option B plus targeted additions.

## Consequences
- Accessibility behaviour comes from a maintained library; our tests focus on integration.
- The timeline and canvas remain custom ([ADR-0014](0014-timeline-ui-rendering.md)).
