# v2 plan: steps

Goal: v2.0 = v1.0 plus a friendlier, more accessible interface and a set of engine features for publishing video.
Design, reasons, risks and the owner's decisions: [docs/v2/plan.md](../docs/v2/plan.md) (item numbers F1 to F10 and E1 to E10 are the
same as there). Same rules as v1: one step at a time, one branch per step, `pnpm check` and the full end-to-end suite green, merge
`--no-ff` into `claude-takeover`, never `main`, push only by branch name and never force. Updated 2026-11-19.

## Steps

| #   | Step                                 | Branch (from)                             | What it delivers                                                                                                                                                                       | Status                                   |
| --- | ------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | Frontend items F1 to F8 and F10      | `feat/v2-frontend`                        | Shortcut tooltips, empty states, keyboard transform, keyframe moving, command palette, walkthrough, export summary and test export, high-contrast theme, timeline zoom/height/collapse | done, pushed, not yet merged             |
| 2   | Manual test of v1 and v2, then merge | `feat/v2-frontend` into `claude-takeover` | Owner tests by hand; fixes land on `feat/v2-frontend`; merge `--no-ff` after `pnpm check`                                                                                              | waiting for the owner                    |
| 3   | E1 social export frames              | `feat/v2-e1`                              | Square, vertical and 4:5 export, fit with bars or fill and crop, position control; no format change                                                                                    | done on feat/v2-e1 (1f9efe7), not merged |
| 4   | E2 caption files                     | `feat/v2-e2`                              | Export `.srt` and `.vtt` from the subtitle clips; no format change                                                                                                                     | done on feat/v2-e2 (779a198), not merged |
| 5   | E3 limiter and loudness              | `feat/v2-e3`                              | Master limiter, loudness readout, optional normalise at export                                                                                                                         | planned                                  |
| 6   | E5 centred transitions               | `feat/v2-e5`                              | Transitions centred on the cut; format v12 (optional field), preview and export match                                                                                                  | planned                                  |
| 7   | F9 narrow layout                     | `feat/v2-f9`                              | Panels become tabs below 1024 px (stretch)                                                                                                                                             | planned                                  |
| 8   | E4 text styling and fonts            | `feat/v2-e4`                              | Outline, shadow, background box; about four open-licence bundled fonts listed in `docs/third-party.md`                                                                                 | planned                                  |
| 9   | E6 bezier curves and curve editor    | `feat/v2-e6`                              | Custom easing curves for keyframes and an editor for them                                                                                                                              | planned                                  |
| 10  | E7a speed ramps                      | `feat/v2-e7`                              | Speed that changes along a clip, eased in and out                                                                                                                                      | planned                                  |
| 11  | Spikes: reverse, proxies, soft subs  | `spikes/` on `feat/v2-spikes`             | Measure reverse playback on long-GOP sources, proxy speed and size on 4K, what the muxer can write; decide steps 12 to 14                                                              | planned                                  |
| 12  | E8 proxies                           | `feat/v2-e8`                              | Background proxies, automatic switch (setting: Automatic, Always, Never), export always uses the original                                                                              | planned (depends on step 11)             |
| 13  | E7b reverse playback                 | `feat/v2-e7b`                             | Reverse a clip, if the spike shows it is workable                                                                                                                                      | planned (depends on step 11)             |
| 14  | E9 soft subtitle tracks              | `feat/v2-e9`                              | Switchable captions inside MP4 or WebM, if the muxer allows                                                                                                                            | planned (depends on step 11)             |
| 15  | E10 audio effects                    | `feat/v2-e10`                             | Three-band equaliser; noise reduction only with a local-only method                                                                                                                    | planned                                  |
| 16  | v2.0 readiness                       | `feat/v2-release`                         | Accessibility audit pass, performance budgets re-checked, docs and user guide, changelog, release checklist                                                                            | planned                                  |

Steps 3 and 4 run in parallel; so can 5 and 6, and 8 and 9, because they touch different files. Steps 12 to 14 are decided from
the spike results in step 11, not before.

## Step completion checklist

- [ ] Acceptance criteria written in `docs/v2/plan.md` met, with unit tests and an end-to-end test (and an axe check for visible changes)
- [ ] `pnpm check` green and the full `pnpm test:e2e` green
- [ ] Document format changes (v12) only add optional fields, with a migration test that old files open unchanged
- [ ] Docs, `CHANGELOG.md`, `docs/v2/plan.md` item state and this table updated
- [ ] Known limitations written down
- [ ] Merged `--no-ff` into `claude-takeover`

## Connected publishing (LLM, YouTube channel automation, Instagram Reels)

Added 2026-11-19 at the owner's request. Design, platform facts, risks and the decisions still needed:
[docs/v2/connected-publishing.md](../docs/v2/connected-publishing.md) and [ADR-0021](../docs/adr/0021-connected-publishing.md) (proposed).
The editor stays private and offline; everything here is optional and goes through a small bridge service the owner runs.
Steps C1 to C9 start only after C0 (the owner's answers) and are best done after the editor items they depend on (E1 vertical
frames, E2 captions). No real account is used in automated tests.

| #   | Step                                   | Branch                        | What it delivers                                                                                                                                                                                                                                                       | Depends on | Status  |
| --- | -------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| C0  | Decisions and ADR                      | `docs/` on `feat/v2-frontend` | Owner answers the six questions; ADR-0021 accepted; `SEC-1` amended for the connected build only                                                                                                                                                                       | owner      | planned |
| C1  | LLM wrappers (`packages/llm`)          | `feat/v2-c1-llm`              | `LlmProvider` interface; adapters `openai-compatible` (OpenAI, Ollama, LM Studio, vLLM, OpenRouter...), `anthropic`, `gemini`, `mock`; timeouts, retries, cancel, JSON-schema output with one repair retry, usage log, budget limit; tests against a mock HTTP server  | C0         | planned |
| C2  | Bridge skeleton (`apps/bridge`)        | `feat/v2-c2-bridge`           | Node service on 127.0.0.1, bridge token, CORS for the app origin only, encrypted secret store, health route, LLM proxy route, audit log; tests                                                                                                                         | C1         | planned |
| C3  | Connections UI and the SEC-1 amendment | `feat/v2-c3-connections`      | Settings "Connections": bridge address and token, connect an LLM and test it, status of each account; connected-build CSP with the one bridge origin; e2e that the default build makes no outside request and the connected build only talks to the bridge             | C2         | planned |
| C4  | Metadata assistant                     | `feat/v2-c4-metadata`         | Suggest titles, descriptions, tags, hashtags and chapters from text (captions from E2, clip names, the person's brief); editable, versioned prompts, text only                                                                                                         | C3, E2     | planned |
| C5  | YouTube connector (spike, then code)   | `feat/v2-c5-youtube`          | Spike: current quota, private-upload rule, refresh-token lifetime. Then OAuth (code flow, PKCE, offline) in the bridge, channel info, resumable upload, scheduled publish, thumbnail, "YouTube video / Short" export presets; mock YouTube server for tests            | C3         | planned |
| C6  | Instagram connector (spike, then code) | `feat/v2-c6-instagram`        | Spike: account type, login route, review needs, limits and video specs. Then OAuth and long-lived token refresh in the bridge, Reel container, resumable upload, status polling, publish, limit check; "Instagram Reel" export preset; mock Instagram server for tests | C3, E1     | planned |
| C7  | Publishing queue and scheduler         | `feat/v2-c7-queue`            | Queue UI and bridge job runner: items (file, text, platform, time), Approve step, retries, rate-limit display, audit log, safe restart                                                                                                                                 | C5 or C6   | planned |
| C8  | Automation recipes                     | `feat/v2-c8-recipes`          | "Weekly upload" style recipes: pick a project, export with a preset, LLM metadata, queue for approval; analytics read-only later                                                                                                                                       | C4, C7     | planned |
| C9  | Hardening and docs                     | `feat/v2-c9-release`          | Security review of the bridge and token handling, revoke on disconnect, ToS checklist, manual smoke checklist for real test accounts, user guide section, changelog                                                                                                    | C8         | planned |

Rules for all C steps: no `any`; secrets never reach the browser or logs; every post needs Approve by default; publishing only
(no automated likes, follows, comments, messages); `pnpm check` and the full end-to-end suite stay green; manual smoke tests with
real test accounts are done by the owner and never run in CI.
