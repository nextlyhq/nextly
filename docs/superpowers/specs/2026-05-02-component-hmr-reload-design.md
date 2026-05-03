# Component HMR Code-First Schema Sync

**Date:** 2026-05-02
**Status:** Approved

## Summary

Extend `reload-config.ts` to handle components alongside existing collections and singles support. When a user changes a component's fields in `nextly.config.ts`, the HMR listener fires `reloadNextlyConfig()`, which currently ignores components entirely. This change makes components a full peer of collections and singles in the HMR reload path.

## Scope

Single file change: `packages/nextly/src/init/reload-config.ts`

No changes to:

- `hmr-listener.ts` — already fires on any server file change
- `dev-reload-broadcaster.ts` — already broadcasts to browser tabs
- `PushSchemaPipeline` — already has `components` slot in `DesiredSchema`
- Any other file

## Table Name Convention

Component table names are always derived from slug — no `dbName` override:

```ts
`comp_${slug
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "")}`;
```

This matches the existing convention in `dev-server.ts` and `di/register.ts`.

## Changes

### 1. Type additions

```ts
type ComponentDef = {
  slug?: string;
  fields?: unknown[];
  label?: { singular?: string } | string;
  description?: string;
  admin?: unknown;
};
```

`newConfig` type expanded to include `components?: ComponentDef[]`.

```ts
interface ComponentRegistrySurface {
  syncCodeFirstComponents(configs: unknown[]): Promise<unknown>;
}
```

### 2. Target normalization + introspection

Build `componentTargets` array from `newConfig.components` (same shape as `targets` and `singleTargets`). Add component table names to the existing `introspectLiveSnapshot` batch call — no extra DB round-trip.

Early-return guard extended: skip if all three of `desiredCollections`, `desiredSingles`, `desiredComponents` are empty.

### 3. Diff + safety classification + pipeline

Third loop mirrors the singles loop:

- `buildDesiredTableFromFields` + `diffSnapshots` per component
- `classifyForCodeFirst` (reuses existing function, no changes)
- Builds `desiredComponents: Record<string, DesiredComponent>`

`DesiredSchema` passed to `apply`:

```ts
{ collections: desiredCollections, singles: desiredSingles, components: desiredComponents }
```

(was previously hardcoded to `components: {}`)

### 4. Post-apply cache refresh

Runs only on `applyResult.success`. Three steps in order:

1. **Registry sync** — resolve `"componentRegistryService"` from DI, call `syncCodeFirstComponents()`. Label is normalized as: `typeof label === "string" ? label : label?.singular ?? slug`. Non-fatal if DI resolution fails.

2. **Fresh Drizzle table generation** — `generateRuntimeSchema` for each affected component table. Stored in `componentFreshTables` map.

3. **SchemaRegistry refresh** — `registerDynamicSchema` for each component table. Non-fatal if DI resolution fails.

No `refreshCollectionSchema` equivalent — components have no CollectionsHandler path.

`broadcastDevReload()` already runs after all three steps and covers components with no change needed.

## Error Handling

All post-apply steps are wrapped in individual `try/catch` blocks, matching the existing non-fatal pattern for collections and singles. DDL success is never rolled back due to metadata sync failures.

## What Is Not Changing

- The rename/drop confirmation flow (clack terminal prompts) — components go through exactly the same `classifyForCodeFirst` + `PushSchemaPipeline` path as collections/singles
- The `broadcastDevReload()` call — already fires for all entity types
- Boot-time apply (`boot-apply.ts`) — calls `reloadNextlyConfig()` directly, so components will be picked up automatically once `reload-config.ts` is updated
