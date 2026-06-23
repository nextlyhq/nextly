# Plugin API stability

`@nextlyhq/plugin-sdk` **is** the stability boundary for the Nextly plugin platform
(D40/D43). This document is the authoritative ledger of what is **stable (`@public`)**
versus **`@experimental`**, the semver guarantee that backs it, and the deprecation
policy.

> Every export is annotated with a TSDoc release tag (`@public` / `@experimental` /
> `@deprecated`) that mirrors the table below. When the JSDoc and this table disagree,
> **this table wins** — please open an issue.

## How a surface becomes stable

Nextly follows a **stability ladder** (D55): nothing is declared stable on paper. A
surface graduates from `@experimental` to `@public` only once **a first-party plugin has
exercised it in production** (against a real database, not just the SQLite test harness).
`ctx.services` is the highest-scrutiny surface and was held experimental the longest
(D56) — it graduates now that `plugin-form-builder` and `plugin-seo` depend on it.

The public surface is kept **deliberately small** (D40). Everything not listed as
`@public` is internal/unstable and may change in any release.

## The semver guarantee

The `@public` surface is the **semver-protected contract**. Once Nextly reaches `1.0`,
**breaking a `@public` export requires a major version bump** (D40). During the current
`0.x` alpha, the `@public` surface is _stable-in-intent_: changes follow the deprecation
policy below rather than landing as silent breaks — but you should still **pin your
`nextly` / `@nextlyhq/plugin-sdk` versions** while we are pre-`1.0`.

`@experimental` exports carry **no compatibility guarantee** and may change or be removed
in any release.

## Stable surface (`@public`)

| Surface                                                                 | Exports                                                                                                                                                                    | First-party exerciser                 | Decision    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| Plugin definition                                                       | `definePlugin`, `PluginDefinition`, `PluginContributions`, `PluginContext`                                                                                                 | redirects / seo / form-builder        | D1/D4       |
| Lifecycle                                                               | `setup` / `init` / `destroy` (on `PluginDefinition`)                                                                                                                       | all                                   | D4          |
| Schema contributions                                                    | `contributes.collections` / `contributes.extend` (typed via `PluginContributions`)                                                                                         | redirects (collections), seo (extend) | D3/D12      |
| Permissions                                                             | `PluginPermission`, `PermissionSlug`, `AuthUser`                                                                                                                           | all (declare permissions)             | D36         |
| Managed data access (`ctx.services`)                                    | `PluginCollectionService`, `QueryOptions`, `PaginatedResult`, `BatchOperationResult`, `ServiceOpts` (incl. `{ as: 'system' }`)                                             | form-builder, seo                     | D35/D56     |
| HTTP routes (`contributes.routes`)                                      | `PluginRoute`, `PluginRouteContext`, `PluginRouteHandler`, `Middleware`, `RouteMethod`                                                                                     | redirects (lookup), seo (sitemap)     | D25–D28     |
| Events (`ctx.events`)                                                   | `EventBus`, `EventEnvelope`, `EventHandler`, `EventName`, `DocumentEvents`, `AuthEvents`, `MediaEvents` (+ `*EventName` types)                                             | seo (`ctx.events.on`)                 | D8/D51/D69  |
| Collection/field hook context                                           | `HookContext`                                                                                                                                                              | form-builder (collection hook)        | D4          |
| Testing (`@nextlyhq/plugin-sdk/testing`)                                | `createTestNextly`, `CreateTestNextlyOptions`, `TestNextly`                                                                                                                | all (plugin tests)                    | D46         |
| Admin contributions (`contributes.admin`, `@nextlyhq/plugin-sdk/admin`) | `PluginAdminContributions`, `PluginAdminPage`, `PluginCollectionView`, `PluginMenuItem`, `ComponentPath`, `registerComponent`, `registerComponents`, `registerKnownPlugin` | form-builder                          | D19–D21/D23 |

## Experimental surface (`@experimental`)

These ship today but are **not yet stable** — no first-party plugin has exercised them in
production, or they are intentionally held back. Use them, but expect change.

| Surface                                   | Exports                                                                                                                                                                                                                                                                                        | Why still experimental                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Raw DB escape hatch                       | `ctx.db`                                                                                                                                                                                                                                                                                       | D56 — kept experimental on purpose; prefer `ctx.services`. Aggregations beyond `count` are the only intended use.          |
| Plugin-registered hooks                   | `ctx.hooks`, `PluginHookRegistry`, `HookType`, `HookHandler`                                                                                                                                                                                                                                   | No first-party plugin registers a hook via `ctx.hooks` yet (seo/form-builder use collection-level hooks + events instead). |
| Filters & actions (D63)                   | `ctx.filters`, `ctx.actions`, `FilterSeams`, `Filter`, `Action`, `CoreFilterSeam`, `PluginFilterRegistry`, `PluginActionRegistry`, `EmailPayloadFilterValue`, `EmailFilterContext`, `EmailAfterSendValue`, `NavCollectionItem`, `NavFilterContext`, `ListQueryWhere`, `ListQueryFilterContext` | No first-party plugin contributes a filter/action through this surface yet.                                                |
| Secrets (D37)                             | `secret`, `Secret`, `isSecret`                                                                                                                                                                                                                                                                 | No first-party plugin wraps a secret yet. The redaction contract is solid but unexercised.                                 |
| Client UX (`@nextlyhq/plugin-sdk/client`) | `useCan`, `Can`, `CanProps`                                                                                                                                                                                                                                                                    | No first-party plugin's admin UI calls `useCan`/`<Can>` yet. Graduates when one does.                                      |
| Admin dashboard widgets                   | `PluginAdminWidget`                                                                                                                                                                                                                                                                            | D22 — widget rendering is deferred to M8; the contract is reserved, not rendered.                                          |
| Auth extensibility (D71/D57)              | `AuthStrategy`, `AuthInput`, `AuthOutcome`, `Challenge`, `ChallengeDefinition`, `AuthHooks`, `AuthHookName`, `contributes.auth`, `auth.strategies`                                                                                                                                             | New in M7. The whole surface is unexercised by a first-party plugin; graduates per D55 once one does.                      |

## Deprecation policy (D41)

When a `@public` export must change incompatibly:

1. **Mark it `@deprecated`** in JSDoc with the replacement and the version it will be
   removed in.
2. **Emit a one-time runtime warning** at first use where practical — log via
   `ctx.logger.warn` (or the host logger), guarded so it fires once per process so it
   doesn't spam.
3. **Keep it for ≥ 1 major version** after deprecation (the support window).
4. **Ship a migration guide** in the docs before removal.

`@experimental` exports may be changed or removed **without** this process — that is the
point of the marker. Promotion (`@experimental` → `@public`) is **not** a breaking change.

## Out of scope for v1 (forward-design only)

Per D0/D42/D34, v1 is **npm-trust**: no marketplace, no UI-install, no runtime sandbox or
verification gate. Discovery is npm + these docs + the `nextly-plugin` keyword. These are
deferred, not cancelled — see the RFC's "later milestones".
