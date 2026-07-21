# Plugin API stability

`@nextlyhq/plugin-sdk` **is** the stability boundary for the Nextly plugin platform
(D40/D43). This document is the authoritative ledger of what is **stable (`@public`)**
versus **`@experimental`**, the semver guarantee that backs it, and the deprecation
policy.

> Every export is annotated with a TSDoc release tag (`@public` / `@experimental` /
> `@deprecated`) that mirrors the table below. When the JSDoc and this table disagree,
> **this table wins** — please open an issue.

> This ledger covers **admin integration**: registration, contributions, the data table
> and the field-UI kit. The presentational primitives plugins render — buttons, inputs,
> dialogs and the design tokens — ship from `@nextlyhq/ui` and have their own ledger at
> [`packages/ui/STABILITY.md`](../ui/STABILITY.md).

## How a surface becomes stable

Nextly follows a **stability ladder** (D55): nothing is declared stable on paper. A
surface graduates from `@experimental` to `@public` only once **a first-party plugin has
exercised it in production** (against a real database, not just the SQLite test harness).
`ctx.services` is the highest-scrutiny surface and was held experimental the longest
(D56) — it graduates now that `plugin-form-builder` depends on it.

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

| Surface                                                                 | Exports                                                                                                                                                                                                                                                                                   | First-party exerciser                 | Decision    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| Plugin definition                                                       | `definePlugin`, `PluginDefinition`, `PluginContributions`, `PluginContext`                                                                                                                                                                                                                | redirects / seo / form-builder        | D1/D4       |
| Lifecycle                                                               | `setup` / `init` / `destroy` (on `PluginDefinition`)                                                                                                                                                                                                                                      | all                                   | D4          |
| Schema contributions                                                    | `contributes.collections` / `contributes.extend` (typed via `PluginContributions`)                                                                                                                                                                                                        | redirects (collections), seo (extend) | D3/D12      |
| Permissions                                                             | `PluginPermission`, `PermissionSlug`, `AuthUser`                                                                                                                                                                                                                                          | all (declare permissions)             | D36         |
| Managed data access (`ctx.services`)                                    | `PluginCollectionService`, `QueryOptions`, `PaginatedResult`, `BatchOperationResult`, `ServiceOpts` (incl. `{ as: 'system' }`)                                                                                                                                                            | form-builder, seo                     | D35/D56     |
| HTTP routes (`contributes.routes`)                                      | `PluginRoute`, `PluginRouteContext`, `PluginRouteHandler`, `Middleware`, `RouteMethod`                                                                                                                                                                                                    | redirects (lookup), seo (sitemap)     | D25–D28     |
| Events (`ctx.events`)                                                   | `EventBus`, `EventEnvelope`, `EventHandler`, `EventName`, `DocumentEvents`, `AuthEvents`, `MediaEvents` (+ `*EventName` types)                                                                                                                                                            | seo (`ctx.events.on`)                 | D8/D51/D69  |
| Collection/field hook context                                           | `HookContext`                                                                                                                                                                                                                                                                             | form-builder (collection hook)        | D4          |
| Testing (`@nextlyhq/plugin-sdk/testing`)                                | `createTestNextly`, `CreateTestNextlyOptions`, `TestNextly`                                                                                                                                                                                                                               | all (plugin tests)                    | D46         |
| Admin contributions (`contributes.admin`, `@nextlyhq/plugin-sdk/admin`) | `PluginAdminContributions`, `PluginAdminPage`, `PluginCollectionView`, `PluginMenuItem`, `ComponentPath`, `registerComponent`, `registerComponents`, `registerKnownPlugin`                                                                                                                | form-builder                          | D19–D21/D23 |
| Plugin UI kit (`@nextlyhq/ui`)                                          | Shared React primitives consumed as a host **peer dep**. Which of them are stable is tracked in [`packages/ui/STABILITY.md`](../ui/STABILITY.md), not here — that ledger is authoritative for `@nextlyhq/ui`. Plugins import UI primitives from there — **never** from `@nextlyhq/admin`. | see the ui ledger                     | D68/D53     |

## Experimental surface (`@experimental`)

These ship today but are **not yet stable** — no first-party plugin has exercised them in
production, or they are intentionally held back. Use them, but expect change.

| Surface                                     | Exports                                                                                                                                                                                                                                                                                        | Why still experimental                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw DB escape hatch                         | `ctx.db`                                                                                                                                                                                                                                                                                       | D56 — kept experimental on purpose; prefer `ctx.services`. Aggregations beyond `count` are the only intended use.                                                                                                                                                                                                                                                                         |
| Plugin-registered hooks                     | `ctx.hooks`, `PluginHookRegistry`, `HookType`, `HookHandler`                                                                                                                                                                                                                                   | No first-party plugin registers a hook via `ctx.hooks` yet (seo/form-builder use collection-level hooks + events instead).                                                                                                                                                                                                                                                                |
| Filters & actions (D63)                     | `ctx.filters`, `ctx.actions`, `FilterSeams`, `Filter`, `Action`, `CoreFilterSeam`, `PluginFilterRegistry`, `PluginActionRegistry`, `EmailPayloadFilterValue`, `EmailFilterContext`, `EmailAfterSendValue`, `NavCollectionItem`, `NavFilterContext`, `ListQueryWhere`, `ListQueryFilterContext` | No first-party plugin contributes a filter/action through this surface yet.                                                                                                                                                                                                                                                                                                               |
| Secrets (D37)                               | `secret`, `Secret`, `isSecret`                                                                                                                                                                                                                                                                 | No first-party plugin wraps a secret yet. The redaction contract is solid but unexercised.                                                                                                                                                                                                                                                                                                |
| Client UX (`@nextlyhq/plugin-sdk/client`)   | `useCan`, `Can`, `CanProps`                                                                                                                                                                                                                                                                    | No first-party plugin's admin UI calls `useCan`/`<Can>` yet. Graduates when one does.                                                                                                                                                                                                                                                                                                     |
| Admin dashboard widgets                     | `PluginAdminWidget`, `contributes.admin.widgets`                                                                                                                                                                                                                                               | D22/C9 — now **rendered** by `PluginWidgetGrid` on the dashboard, permission-gated. No first-party plugin contributes one yet; graduates per D55.                                                                                                                                                                                                                                         |
| Admin header slot (C9)                      | `contributes.admin.headerSlot`                                                                                                                                                                                                                                                                 | New in Phase 3. A component rendered in the admin top bar (self-gated). No first-party plugin contributes one yet.                                                                                                                                                                                                                                                                        |
| Per-field admin override (D24)              | `FieldAdminOptions.component` (`field.admin.component`)                                                                                                                                                                                                                                        | New in Phase 3. Overrides a field's admin editor by component path. No first-party plugin uses it yet.                                                                                                                                                                                                                                                                                    |
| Auth extensibility (D71/D57)                | `AuthStrategy`, `AuthInput`, `AuthOutcome`, `Challenge`, `ChallengeDefinition`, `AuthHooks`, `AuthHookName`, `contributes.auth`, `auth.strategies`                                                                                                                                             | New in M7. The whole surface is unexercised by a first-party plugin; graduates per D55 once one does.                                                                                                                                                                                                                                                                                     |
| Role bundles (D67)                          | `PluginRole`, `contributes.roles`                                                                                                                                                                                                                                                              | New in Phase 2. Seeded role bundles; unexercised by a first-party plugin in production — graduates per D55 once one is.                                                                                                                                                                                                                                                                   |
| Custom services (D64/D66)                   | `contributes.services`, `ctx.services.plugins.<name>.<svc>`, `nextly.plugins.<name>.<svc>`                                                                                                                                                                                                     | New in Phase 2. Runtime-`any` surface (cast or export your own types); no first-party plugin contributes a service yet.                                                                                                                                                                                                                                                                   |
| Scheduled tasks (D61)                       | `ScheduledTask`, `contributes.schedules`                                                                                                                                                                                                                                                       | **RESERVED, not executed.** Shape published so the gap isn't silent; a real scheduler needs durable jobs (D51). Use external cron + route handlers, or event-driven work, meanwhile.                                                                                                                                                                                                      |
| Email providers + templates (D65)           | `contributes.emailProviders`, `contributes.emailTemplates`, `PluginEmailProvider`, `PluginEmailTemplate`                                                                                                                                                                                       | New in Phase 2. Provider registry replaces the hardcoded switch; templates seed into the DB on boot. No first-party plugin contributes one yet.                                                                                                                                                                                                                                           |
| Custom field types (D16/M9a)                | `contributes.fieldTypes`, `PluginFieldType` (incl. `surfaces`, `label`, `description`, `icon`, `category`), `FieldSurface`, `isPluginFieldTypeOnSurface`                                                                                                                                       | Storage primitive + config-validation acceptance + admin rendering now all land: a plugin type appears in the field pickers (surface-filtered), is accepted by the entry/user/form validators, and renders via its admin component. `plugin-form-builder` exercises the forms surface. Graduates per D55 once a third-party plugin ships one.                                             |
| Field-UI kit (`@nextlyhq/plugin-sdk/admin`) | `FieldTypePicker`, `FieldOptionsEditor`, `withOptionIds`, `FieldOption`, `FieldDefaultValueInput`, `FieldDefaultOption`, `usePluginFieldTypeEntries`, `FieldTypePickerProps`, `FieldOptionsEditorProps`, `FieldDefaultValueInputProps`                                                         | Controlled, form-library-agnostic field-building components rendered from `nextly/field-catalog`. Each has a narrow, storage-agnostic contract that never exposes admin internals. `plugin-form-builder` composes `FieldTypePicker`, `usePluginFieldTypeEntries`, `FieldOptionsEditor`, and `withOptionIds` (its `FieldEditor`); `FieldDefaultValueInput` awaits a first-party exerciser. |

## Field-UI kit and field-type surfaces

The **field-UI kit** (`@nextlyhq/plugin-sdk/admin`) is the set of controlled,
form-library-agnostic components every field-building surface composes — the
admin's own Schema Builder and User-Fields page, and, via the SDK, plugin field
editors. Each component has a narrow, storage-agnostic contract and renders from
the serializable `nextly/field-catalog`, so a plugin builds a field editor that
looks and behaves like the rest of the admin without importing `@nextlyhq/admin`:

- `FieldTypePicker` — a catalog-driven type grid. Pass your surface's allowed
  `types` (narrowed against the catalog) or pre-narrowed `entries`.
- `FieldOptionsEditor` + `withOptionIds` — an option list with drag reorder,
  auto-generated values, CSV/JSON import, and whole-batch duplicate reporting.
  It owns only the option list; a surface layers its own field-admin knobs
  (multi-select, clearable, …) around it. `withOptionIds` seeds stable drag ids
  onto plain `{label, value}` data.
- `FieldDefaultValueInput` — a type-aware default-value input.
- `usePluginFieldTypeEntries(surface)` — catalog rows for the plugin field types
  offered on a picker `surface`, to merge after your surface's built-in `entries`
  (built-ins win on an id collision).

A **field-type surface** (`FieldSurface`) is an admin place a field type can be
offered: `"entries"` (collection/single editing), `"users"` (user profile
fields), or `"forms"` (the form builder). A plugin field type opts into surfaces
via `PluginFieldType.surfaces`; an **omitted list means the entries surface
only** — a type never auto-appears where its author did not opt in. What a picker
shows resolves as _the surface's own capability set ∩ the type's declared
surfaces ∩ the host's excludes_ — every level can only remove types, never force
one in. Server-side, `isPluginFieldTypeOnSurface(type, surface)` is the single
gate each surface's validator consults (built-ins keep their own fast allowlist);
a type persists as its declared `storage` primitive on every surface. Instances
of a type that later stops being offered still render (read-only degradation);
they are never dropped.

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
