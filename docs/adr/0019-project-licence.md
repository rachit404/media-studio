# ADR-0019: Licence for Media Studio's own code

- **Status:** Proposed (2026-11-17), awaiting owner confirmation. Not legal advice.

## Context
The project is a public portfolio piece that must remain shippable commercially later. Dependencies are permissive (MIT, Apache-2.0, BSD, ISC) with MPL-2.0 for Mediabunny ([ADR-0011](0011-dependency-licence-policy.md)).

## Options
| Option | Pros | Cons |
|---|---|---|
| **A. Apache-2.0** | Explicit patent grant, permissive, compatible with all our dependencies, familiar to companies | Longer text, requires NOTICE handling |
| B. MIT | Shortest, most familiar | No explicit patent grant |
| C. AGPL/GPL | Forces openness of derivatives | Blocks the option to ship closed or dual-licensed products later; conflicts with "shippable later" flexibility |
| D. Source-available / proprietary | Full control | Reduces portfolio value and contribution; license-checker friction |

## Decision
**A: Apache-2.0** for all first-party code and docs (docs may be CC BY 4.0 if the owner prefers; default is the same licence). Third-party notices are kept in `docs/third-party.md` and shipped in the app's About page. Copyright holder and year are set by the owner at M0.

## Consequences
- As sole copyright holder the owner can still relicense future versions.
- Contributions require agreement to the licence (CONTRIBUTING; a DCO sign-off is the lightest option).
- Trademarks and the "Media Studio" name are not granted by the licence.
