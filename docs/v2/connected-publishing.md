# v2 connected publishing: LLM wrappers, YouTube channel automation, Instagram Reels posting

Status: planned 2026-11-19, nothing built. The owner asked for two new v2 sections ("YouTube channel automation" and "Instagram
Reels posting") driven by an LLM they connect themselves (API key or self-hosted). Steps and branches are in
[CLAUDE/plan-v2.md](../../CLAUDE/plan-v2.md) (steps C0 to C9). Facts about the platforms come from a first web search on
2026-11-19 and are marked **verify**: the vendor documentation and some secondary sources disagree on several numbers, so each
one is re-checked in a spike (C5, C6) before code depends on it.

## 1. What this changes about the product

Media Studio is private and offline by design: no network requests to third parties at runtime (requirement SEC-1, enforced by
an end-to-end test), and a Content Security Policy with `connect-src 'self'`. Publishing to YouTube and Instagram and calling an
LLM are network features. So the plan keeps them **separate and optional**:

- The editor itself does not change: with nothing connected it makes zero third-party requests, and the SEC-1 test stays as is.
- A new **Connections** area (settings and a Publish panel) is the only place that talks to anything outside. It is off until the
  owner turns it on.
- Nothing is sent anywhere without a visible action. Video files, frames and project data are **never** sent to an LLM by
  default; the LLM sees text only (titles, captions and transcript text, clip names, the person's instructions). Sending
  frames for "what is in this video" is a separate, per-use opt-in.
- A new ADR-0021 (draft: [adr/0021-connected-publishing.md](../adr/0021-connected-publishing.md)) amends SEC-1 for the connected
  build only.

## 2. Architecture (recommended)

```
 Media Studio (browser, strict CSP)  --->  Bridge (small Node service the owner runs)  --->  YouTube, Instagram, LLM APIs
   Connections UI, Publish panel,             holds secrets and tokens, OAuth callbacks,         (or a self-hosted LLM such as
   metadata editor, queue view                scheduler, uploads, LLM calls, audit log           Ollama or vLLM on the owner's PC)
```

Why a bridge, and not calls straight from the browser:

| Need | Browser only | With a bridge |
| --- | --- | --- |
| Instagram long-lived tokens | The exchange needs the app secret, which must not ship to a browser | Done server-side |
| YouTube refresh tokens (post while the browser is closed) | Google's browser model gives an access token and no refresh token (about an hour) | Code flow with the secret and a stored refresh token |
| Scheduled and "automated" posting | Only while a tab is open | A job runner keeps working |
| API keys for LLM providers | Would sit in browser storage | Stay in the bridge's encrypted store |
| CORS and CSP | Each provider must allow the browser origin, and `connect-src` widens | The app talks to one origin: the bridge |
| Instagram video source | Meta must fetch a public URL, or use its resumable upload | The bridge streams the file to Meta's upload host |

The bridge runs on the owner's computer (default, `127.0.0.1`) or on a small always-on server for scheduled posting. It lives in
this repository as `apps/bridge` (Node, no database: encrypted JSON files), and is **not** needed to use the editor.
Browser-only mode stays available for two cases: a self-hosted LLM on `localhost` and a one-off manual YouTube upload using the
short-lived token model.

### Bridge security rules

- Binds to `127.0.0.1` by default; a random bridge token (shown once, pasted into the app) is required on every request; CORS
  allows only the app's origin; no wildcard.
- Secrets (client secrets, refresh and long-lived tokens, API keys) are encrypted at rest with a key from the OS keychain or a
  passphrase; never written to logs; never returned to the browser (the app sees "connected as ..." only).
- "Disconnect" revokes the token at the provider and deletes it locally.
- Every outgoing publish is written to an audit log (what, where, when, which approval).

## 3. LLM wrappers (`packages/llm`)

One small interface, several adapters, all tested against a mock server.

```ts
interface LlmProvider {
  readonly id: string;                       // 'openai-compatible' | 'anthropic' | 'gemini' | 'mock'
  complete(request: LlmRequest, options?: { signal?: AbortSignal }): Promise<LlmResponse>;
  stream?(request: LlmRequest, options?: { signal?: AbortSignal }): AsyncIterable<LlmChunk>;
}
// LlmRequest: system, messages, maxTokens, temperature, and an optional JSON schema for structured output.
// LlmResponse: text, parsed (when a schema was given and it validated), usage {inputTokens, outputTokens}, model, finishReason.
```

| Adapter | Covers | Notes |
| --- | --- | --- |
| `openai-compatible` | OpenAI, OpenRouter, Groq, Together, **Ollama (`/v1`), LM Studio, vLLM, llama.cpp server** | Base URL, key (optional), model name, extra headers. The self-hosted route for most people. |
| `anthropic` | Claude models via the Messages API | Key, model, version header. |
| `gemini` | Google Gemini | Key, model. |
| `mock` | Tests and demo mode | Deterministic, scriptable replies, records requests. |

Shared behaviour (written once, in the wrapper, not per adapter): timeouts, bounded retries with back-off on 429 and 5xx,
cancellation, JSON-schema validation of structured answers with one automatic repair retry, usage and cost log (tokens only
unless the owner enters prices), per-day budget limit, redaction of keys from errors, and typed errors using the existing
`AppError` style. No telemetry. Prompt templates are versioned files with unit tests of their output shape.

Where keys live: in the bridge (recommended). For a `localhost` model with no key, the browser may call it directly.

### What the LLM is used for

Titles, descriptions and tags (YouTube); caption text and hashtags (Instagram); chapter lists from caption/transcript text
(from E2); hook and cover-text ideas; a content calendar; draft replies to comments (later, always human-sent). It does not
generate or alter the video (ADR-0018 stays: no generative media).

## 4. YouTube: how the account connects

**What is needed:** a Google Cloud project owned by the person, the *YouTube Data API v3* enabled, and an OAuth consent screen
with an OAuth client ID. Scopes: `https://www.googleapis.com/auth/youtube.upload` first; later `youtube` (playlists,
metadata updates, thumbnails) and read-only analytics. Each person brings their own project and credentials ("bring your own
Google project"), so there is nothing for Media Studio to get verified.

**Connection flow (bridge):** authorization-code flow with PKCE and `access_type=offline`; redirect to the bridge's callback
(`http://127.0.0.1:<port>/oauth/youtube/callback`); the bridge stores the refresh token encrypted and fetches fresh access tokens
as needed. The app shows the channel title and a Disconnect button.

**Things to know (verify each in spike C5):**

- While the OAuth consent screen is in *Testing*, refresh tokens expire after about 7 days, so a personal tool should move the
  consent screen to *In production*; for the owner's own account this works without Google's app verification, with an
  "unverified app" warning on first sign-in (**verify**).
- Upload uses `videos.insert` with the resumable protocol. Reports disagree on the quota cost (older: 1,600 units of a default
  10,000 per day, about six uploads; newer secondary sources: a much lower cost or a separate uploads bucket). Read the current
  quota table in Google's documentation and use the quota calculator before promising a number of posts per day (**verify**).
- Videos uploaded through an API project that has not passed Google's *API compliance audit* may be forced to **private**
  (reported for projects created after 28 July 2020; one source says the reference page now says otherwise). Plan for it: the
  queue marks such uploads "uploaded as private, publish by hand or apply for the audit" (**verify**; the audit is for public
  products, a personal one-channel tool may stay private-then-publish).
- Scheduled publishing: upload as private with `status.publishAt`. Shorts are normal vertical uploads (up to the current
  maximum length, **verify**), identified by YouTube from shape and length; `#Shorts` in the title or description is optional.
- Thumbnails (`thumbnails.set`) need a verified channel. AI-made or altered content should be flagged with the API's
  synthetic-media field in `status` when it applies (**verify** field name and rules).

## 5. Instagram: how the account connects

**What is needed:** an Instagram **professional** account (Business; whether Creator also works through the Instagram Login
route is to be **verified**), a Meta developer app, and either (a) *Instagram API with Instagram Login*, where the person
signs in with Instagram only, or (b) *Facebook Login for Business*, where the Instagram account is linked to a Facebook Page.
Recommended: (a) when it supports Reels publishing for the account type in use; otherwise (b). Permission names differ
(`instagram_business_content_publish` for (a), `instagram_content_publish` for (b), **verify**).

**Review and modes:** while the Meta app is in *Development* mode, people with a role on the app (the owner, added as admin or
tester) can use it with their own account without App Review. Public use by other people needs App Review and business
verification. This plan targets personal and own-account use first.

**Connection flow (bridge):** Meta login in a browser tab, redirect to the bridge callback, exchange the code for a short-lived
token, then (server-side, because it needs the app secret) for a **long-lived token** (about 60 days) and refresh it before it
expires (**verify** the refresh call and timing). The app shows the Instagram username and days left on the token.

**Posting a Reel (what the bridge does):**

1. Create a media container: `POST /{ig-user-id}/media` with `media_type=REELS`, a caption, and either a public HTTPS
   `video_url` that Meta can fetch, **or** `upload_type=resumable`.
2. For resumable upload, send the file bytes to Meta's upload host (`rupload.facebook.com/ig-api-upload/{container-id}`) with the
   access token and offset headers. This avoids hosting the file publicly (preferred).
3. Poll the container's `status_code` until it is `FINISHED` (or report `ERROR` with the reason).
4. `POST /{ig-user-id}/media_publish` with the container id.
5. Before step 1, read `GET /{ig-user-id}/content_publishing_limit` and stop when the limit is reached. The limit is reported as
   50 or 100 API-published posts per rolling 24 hours depending on the source (**verify**).

Video limits (duration range, maximum size, aspect ratio, H.264 and AAC in MP4 or MOV, frame rate) differ between sources
(**verify** against Meta's current page); the export preset **"Instagram Reel"** is built from the verified numbers and fails
early, in the export dialog, when the project cannot meet them. It depends on E1 (vertical 9:16 frame).

## 6. Rules the automation follows (product and platform policy)

- **Human approval by default.** Nothing posts without a person pressing Approve on the exact title, caption, file and time. A
  later setting may allow auto-approve for a named recipe, never the default.
- **Publishing only.** No automated likes, follows, comments or direct messages, which both platforms treat as abuse. Replies to
  comments are drafts for a person to send.
- Respect rate limits and quotas shown in the queue; no workarounds, no multiple accounts to dodge limits.
- Label AI-assisted content where the platform asks for it. Text suggested by an LLM is shown to the person for editing.
- No scraping; analytics only through the official APIs.
- The owner is responsible for the content and for compliance with each platform's terms. The bridge keeps an audit log.

## 7. Steps

C0 to C9 are in [CLAUDE/plan-v2.md](../../CLAUDE/plan-v2.md). Short version: decide (C0), LLM wrappers (C1), bridge (C2),
Connections UI and the SEC-1 amendment (C3), metadata assistant (C4), YouTube spike and connector (C5), Instagram spike and
connector (C6), queue and scheduler (C7), automation recipes (C8), hardening and release docs (C9).

## 8. Testing without real accounts

- Fake servers in `packages/testing`: a mock LLM, a mock YouTube (OAuth, resumable upload, quota errors, forced private), a mock
  Instagram (OAuth, container states, rate limit, expiring token). All unit, integration and end-to-end tests use them; CI never
  touches a real account.
- A **manual smoke checklist** with the owner's real test accounts (unlisted video, a Reel on a private test account), run before
  each release and never automated.
- SEC-1 stays enforced: an end-to-end test proves the editor makes no third-party request, and a second test proves that in the
  connected build the only outside origin the browser talks to is the configured bridge.

## 9. Risks

| Risk | Effect | Handling |
| --- | --- | --- |
| Platform rules or numbers change (quota, audit, review) | Features stop or limits differ | Spikes first, numbers live in one config file, the queue shows the real limits from the API |
| Instagram App Review and business verification for public use | Cannot offer to other people | Scope is own-account use; say so in the docs |
| YouTube forces uploads to private for unaudited projects | "Post" ends as private | Detect and show a clear status; apply for audit only if the owner wants to publish for others |
| Long-lived tokens leak | Account takeover | Bridge-only storage, encryption at rest, localhost binding, revoke on disconnect |
| LLM writes wrong or risky text | Bad posts | Approval step, editable fields, no auto-post by default |
| A bridge means a server to run | More to set up | Single command start, clear docs, the editor works without it |
| Cost of LLM calls | Surprise bills | Daily token budget, usage log, mock mode |

## 10. Decisions needed from the owner (defaults used if there is no answer)

1. **Bridge:** is a small Node service in this repository acceptable? (Default: yes; the editor does not need it.)
2. **Where it runs:** the owner's own PC (default) or an always-on server for scheduled posting?
3. **Who uses it:** own accounts only (default; no platform reviews) or other people later (needs Google audit and Meta review)?
4. **Instagram account:** is it Business or Creator, and is it linked to a Facebook Page?
5. **First LLM:** which provider or self-hosted model do you want to test with first? (Default: the `openai-compatible` adapter.)
6. **Approval:** keep "approve every post" as the only mode for v2? (Default: yes.)

## Sources (first look, 2026-11-19; re-check before building)

- [YouTube Data API, videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Google Identity Services: choose an authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Google Identity Services: token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Meta: Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [RFC 10017: OAuth 2.0 for browser-based applications](https://www.rfc-editor.org/rfc/rfc10017)
- Secondary summaries (conflicting numbers, not authoritative): [YouTube quota and audit notes](https://www.ayrshare.com/solutions/google-api-error-403-unverified-app-how-to-fix-the-audit-pipeline/), [Instagram Reels publishing guide](https://postproxy.dev/blog/instagram-reels-api-publishing-guide/)
