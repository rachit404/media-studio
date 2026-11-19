# v2 config-based features: one JSON file decides what is on, who may use it and with which options

Status: planned 2026-11-19, nothing built (no code changed). Requested by the owner: every product feature is described by a
JSON config (permissions and options per feature); the **basic features stay globally available and free**; the **dedicated
features** (AI editing, YouTube channel upkeep, Instagram page upkeep, see [connected-publishing.md](connected-publishing.md))
exist **only through config**. Steps are K0 to K7 in [CLAUDE/plan-v2.md](../../CLAUDE/plan-v2.md); the decision record is the
draft [ADR-0022](../adr/0022-config-based-features.md).

## 1. The idea in one picture

```
 features.default.json  (shipped in the app: every basic feature on, every dedicated feature off)
        +  deployment config   (optional file next to the app, same origin: an owner or host sets it)
        +  user config         (optional file the person imports in Settings, stored on their device)
        v   merged in that order, validated, then
 feature registry  ->  every screen, command, menu, shortcut, export option and bridge route asks it:
                        "is feature X on, may I use it, which options?"
```

Rules of the merge:

1. **Basic features cannot be turned off by any config** (a fixed list, the "floor", in code). A config may change their
   *options* (default export preset, part length, theme, shortcuts, limits) but not remove them. This is what "globally available
   and free" means in practice. A config that tries to disable one is reported and that line is ignored.
2. **Dedicated features are off unless a config enables them** and grants the permissions they need. With no config at all the
   app behaves exactly like v1 plus the v2 frontend: nothing connected, nothing sent anywhere.
3. Later layers override earlier ones, per feature and per option. Unknown features or options are reported, not guessed.
4. The config is **data, never code**: no scripts, no URLs that are fetched, no secrets. Secrets (API keys, client secrets,
   tokens) stay in the bridge; the config only names them (`"secretRef": "openai-main"`).

## 2. Which features are basic and which are dedicated (the first classification, to be confirmed in step K2)

| Tier | Features | Config can... |
| --- | --- | --- |
| **Basic (free, always on)** | Image editor (layers, masks, text, adjustments, selections, painting), video editor (timeline, transitions, text and captions, speed, keyframes, audio), export (MP4/WebM, presets, social frames, test export, in parts, verify), caption files, storage and recovery, project archives, themes, shortcuts, command palette, walkthrough, accessibility, offline use | change options and defaults, set limits |
| **Dedicated (config only)** | `ai.llm` (connect an LLM), `ai.metadata` (titles, tags, captions), future AI editing modules (background removal, automatic subtitles, smart crop, noise reduction per [ADR-0018](../adr/0018-ai-module-boundary.md)), `publish.youtube`, `publish.instagram`, `publish.queue`, `automation.recipes`, `analytics.read` | switch on or off, grant permissions, set options and limits |

Proxies (E8) and the audio effects (E3, E10) are basic: they improve editing and cost nothing to run. Anything that needs an
account, a key, a model download or a network call is dedicated.

## 3. The config file (version 1, sketch)

```json
{
  "schema": "media-studio-features/1",
  "grants": ["llm.use", "publish.youtube", "publish.instagram"],
  "features": {
    "export": {
      "options": { "defaultPreset": "balanced", "partSeconds": 120, "maxHeight": 2160 }
    },
    "ai.llm": {
      "enabled": true,
      "requires": ["llm.use"],
      "options": {
        "provider": "openai-compatible",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "model": "llama3.1",
        "secretRef": null,
        "dailyTokenBudget": 200000,
        "sendMedia": false
      }
    },
    "publish.youtube": {
      "enabled": true,
      "requires": ["publish.youtube"],
      "options": { "approval": "always", "defaultPrivacy": "private", "accounts": ["main"] }
    },
    "publish.instagram": { "enabled": false }
  }
}
```

- **`grants`**: the permissions this config gives (plain strings such as `llm.use`, `publish.youtube`). A feature that lists
  `requires` is usable only when all of them are granted. Basic features need none.
- **`features.<id>.enabled`**: only dedicated features read it. **`options`**: each feature publishes a schema for its options
  (types, ranges, defaults); values outside the schema are rejected with the exact path of the problem.
- **Safety options live in the schema, not in prose**: for example `approval` can only be `"always"` in v2 (as decided in
  [connected-publishing.md](connected-publishing.md)); a config cannot set `"never"`.
- The **bridge reads the same file** (same schema package) and enforces permissions on the server side. The browser's check is for
  the interface; the bridge's check is the real one.

### Where the layers come from

| Layer | Source | Who sets it |
| --- | --- | --- |
| Defaults | `features.default.json`, built into the app | the project |
| Deployment | `/features.json` on the same origin (optional) | whoever hosts the app (the owner) |
| User | a file imported in Settings > Features, kept in browser storage on that device; exportable | the person |
| Bridge | `bridge.config.json` next to the bridge (secrets by name only) | the owner |

No layer is fetched from a third-party address (SEC-1). A **signed config** (a signature checked with the browser's built-in
crypto against a public key in the app) is a later option if feature access ever has to be controlled by someone other than the
person running the app; it is not planned unless the owner asks, see the questions in section 7.

## 4. What changes in the code base (plan only)

- **New package `packages/features`** (no browser APIs, no dependencies on the engines): the schema types, the parser and
  validator (hand-written, with exact error paths), the merge, the permission check, the floor list, and the registry of feature
  descriptors (`id`, `tier`, `requires`, `options` schema, `dependsOn`). A unit test makes sure every feature in the registry has
  an entry in `features.default.json` and the other way round, and that no basic feature can be switched off.
- **App integration**: a `FeaturesProvider` and `useFeature(id)` hook in `apps/web`; menus, toolbar buttons, commands (the
  shortcut registry and the command palette skip commands whose feature is off), settings panels, export options and routes all ask
  the hook. Disabled dedicated features do not render and their code is not loaded (lazy chunks, like the editors).
- **Options replace scattered constants**: today options sit in code or in separate `localStorage` keys (`ms-export-part-seconds`,
  `ms-walkthrough`, `ms-shortcuts`, theme). They move behind the same options model: the schema gives the defaults and limits,
  the person's choices are the *user layer*, and Settings > Features can export and import them as one file. Old keys are read once
  and migrated, so nobody loses settings.
- **Settings > Features** (new, basic): shows every feature, its tier, whether it is on and why not ("needs permission
  `llm.use`"), the layer each option came from, validation errors with their paths, and Import / Export / Reset.
- **Boundary rule**: only `packages/features` and the provider read the config; features never read the JSON themselves (checked
  by dependency-cruiser).
- **The project document does not change.** Config is app configuration, not project content.

## 5. Tests and checks

- Unit: schema validation (good, wrong type, out of range, unknown key, too large, wrong version), merge order, the floor
  (a config disabling a basic feature is ignored and reported), permission checks, defaults completeness, migration of the old
  `localStorage` keys.
- End-to-end: no config (v1 behaviour, no dedicated UI), a config enabling a dedicated feature (its UI appears, nothing is
  called until an action), a broken config (clear error, app still starts with the defaults), import and export in Settings.
- `pnpm check` adds the registry-versus-default-config test and a check that `features.default.json` matches its schema.
- Axe on Settings > Features.

## 6. Risks

| Risk | Handling |
| --- | --- |
| A config file is not a security boundary in a browser (anyone can edit their own local copy) | Say so plainly. Config gates the *interface*; anything that touches an account, a key or a network goes through the bridge, which enforces permissions server-side. Basic features need no protection because they are free. |
| "Completely config based" can become a rewrite of everything | The registry starts with a flat list of existing features and wraps them; behaviour is unchanged until a config changes it. Done in steps K1 to K5. |
| A bad config breaks the app | Validation with exact paths, fall back to the defaults, never crash on a config error. |
| Options spread again over many places | One options model and a boundary rule; the user layer is the only writer of preferences. |
| Config grows into a place for secrets | Schema forbids secret-looking fields; only `secretRef` names are allowed. |

## 7. Decisions needed from the owner (defaults used if there is no answer)

1. **Who edits the config?** The person using the app (user layer, default) plus the host (deployment layer); or only the host?
2. **Floor:** may a config ever disable a basic feature (for example for a managed or classroom setup)? Default: no.
3. **Signed configs / paid or licensed features:** needed now? Default: no; free basics and personally configured dedicated
   features only. (If yes, it needs its own ADR and a decision on how keys are issued.)
4. **Remote config** (fetching a config from a URL): default no, because of SEC-1. Same-origin file only.
5. **Profiles** (for example "personal" and "channel" with different grants in one file)? Default: one set of grants per file.
6. **Order:** do K1 to K3 before the connected-publishing steps (recommended, so the dedicated features are born config-gated)?
