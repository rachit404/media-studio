# ADR-0022: Config-based features (basic free, dedicated by config)

- **Status:** Proposed (2026-11-19). Nothing is built. Design: [docs/v2/feature-config.md](../v2/feature-config.md).

## Context

The owner wants the product described by a JSON config (permissions and options per feature). Basic features must stay free and
available to everyone; dedicated features (AI editing, YouTube and Instagram upkeep, see [ADR-0021](0021-connected-publishing.md))
must exist only through config. Options are today spread over constants and several `localStorage` keys.

## Decision

- A new package `packages/features` defines the config schema (`media-studio-features/1`), a validator with exact error paths,
  the layer merge (defaults, deployment, user), the permission check and a registry of feature descriptors.
- **Floor:** a fixed list of basic features that no config can disable; a config may only change their options.
- **Dedicated features are off by default** and need `enabled: true` plus every permission in their `requires` list, granted by
  `grants`. With no config the app behaves like v1 plus the v2 frontend.
- Config is data only: no code, no fetched URLs, no secrets (only `secretRef` names). Layers come from the app, an optional
  same-origin `/features.json`, and a file the person imports; nothing is fetched from a third party (SEC-1).
- The app reads features only through a provider and `useFeature(id)`; the bridge reads the same schema and enforces
  permissions server-side. Dependency-cruiser forbids other code from reading the config.
- User preferences (theme, shortcuts, export defaults, walkthrough state) become the *user layer* of the options model, exportable
  and importable as one file; old `localStorage` keys are migrated once.
- The project document format is unchanged.

## Consequences

- Every new feature registers a descriptor and a default entry; a test enforces that.
- Client-side config is not a security boundary; real enforcement of account and key use is in the bridge.
- Signed configs, remote config and licensing are explicitly **not** part of this decision and would need their own ADR.

## Alternatives considered

- **Build flags only:** cannot be changed without rebuilding; does not give per-feature options or permissions.
- **Remote feature flags service:** a third-party request at runtime; rejected (SEC-1).
- **Config inside the project document:** mixes app settings with project content and would change the document format.
