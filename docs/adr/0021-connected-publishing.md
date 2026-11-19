# ADR-0021: Connected publishing (optional, bridge-based)

- **Status:** Proposed (2026-11-19). Nothing is built. Design and platform facts: [docs/v2/connected-publishing.md](../v2/connected-publishing.md).

## Context

The owner wants v2 sections that post to YouTube and Instagram Reels, with an LLM they connect (API key or self-hosted) writing
titles, captions and tags. This needs network access, secrets and, for scheduled posting, a process that runs when no browser
is open. v1 promises no third-party requests at runtime (SEC-1) and a CSP with `connect-src 'self'`.

## Decision

- Connected features are **optional and separate** from the editor. With nothing connected, behaviour and the SEC-1 test are unchanged.
- A small **bridge** service (`apps/bridge`, Node) holds secrets and tokens (encrypted at rest), runs OAuth callbacks, calls
  the LLM and the platform APIs, uploads files and runs the schedule. The browser talks only to the bridge.
- In the connected build the CSP `connect-src` is `'self'` plus the one configured bridge origin. The default build is unchanged.
- LLM access goes through `packages/llm`: one `LlmProvider` interface with adapters (`openai-compatible`, `anthropic`, `gemini`,
  `mock`). Media is never sent to an LLM by default; text only.
- Every post needs human approval by default. No automated engagement (likes, follows, comments, messages).
- Each person uses their own Google Cloud project and Meta app (own-account use first), so Media Studio does not need platform
  verification or review.
- `core` and the engines import none of this (same boundary rule as [ADR-0018](0018-ai-module-boundary.md)); dependency-cruiser
  rules are added for `packages/llm` and `apps/bridge`.

## Consequences

- SEC-1 gets a second clause: in the connected build the only outside origin is the bridge.
- New dependencies (a small HTTP server library, maybe a JSON-schema validator) go through [ADR-0011](0011-dependency-licence-policy.md).
- The bridge is something to run; the editor still works without it.
- Platform rules change; numbers are read from one config file and checked by spikes before use.

## Alternatives considered

- **Browser-only calls:** no refresh tokens for YouTube, the Instagram app secret would be exposed, API keys in browser storage,
  no scheduling, wider CSP. Kept only for a `localhost` LLM and a manual YouTube upload.
- **A hosted service run by the project:** would make the project a data processor of people's tokens and media; rejected for
  privacy and cost.
- **Third-party posting aggregators:** would send the person's media and tokens to a company; rejected.
