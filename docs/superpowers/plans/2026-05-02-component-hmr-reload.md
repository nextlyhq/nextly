# Component HMR Code-First Schema Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `reloadNextlyConfig()` so component field changes in `nextly.config.ts` trigger DDL migration, registry sync, and schema cache refresh — exactly as collections and singles already do.

**Architecture:** All changes are in one file (`reload-config.ts`). Components are added as a third parallel entity type alongside the existing collections and singles loops. The `PushSchemaPipeline` already accepts `components` in `DesiredSchema`; the only gap is that `reload-config.ts` was passing `components: {}` and never reading `newConfig.components`.

**Tech Stack:** TypeScript, Vitest

---

## Files

| File                                                       | Change                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/nextly/src/init/reload-config.ts`                | Add `ComponentDef` type, `ComponentRegistrySurface` interface, component target loop, component diff loop, post-apply registry sync, schema cache refresh |
| `packages/nextly/src/init/__tests__/reload-config.test.ts` | Fix stale `databaseAdapter` → `adapter` key in `buildResolver`; add component-specific tests                                                              |

---

## Task 1 — Fix `buildResolver` and write failing component tests

The existing `buildResolver` helper provides the `databaseAdapter` key, but `reload-config.ts` has been resolving `"adapter"` since the DI key was renamed (the comment on line 205 even documents this). This means every test that expects the pipeline to run is currently broken. Fix `buildResolver` first, then add component tests on top.

**Files:**

- Modify: `packages/nextly/src/init/__tests__/reload-config.test.ts`

- [ ] **Step 1: Fix `buildResolver` to use the correct `"adapter"` key**

In `reload-config.test.ts`, replace the `buildResolver` function (lines 89–103) with:

```ts
function buildResolver(opts?: {
  withAdapter?: boolean;
  withComponentRegistry?: boolean;
  withSchemaRegistry?: boolean;
}) {
  const withAdapter = opts?.withAdapter ?? true;
  const syncCodeFirstComponentsSpy = vi.fn().mockResolvedValue({});
  const registerDynamicSchemaSpy = vi.fn();
  const services: Record<string, unknown> = {
    logger: { warn: warnSpy, info: vi.fn(), error: errorSpy },
    adapter: withAdapter
      ? { dialect: "sqlite" as const, getDrizzle: () => ({}) }
      : undefined,
    collectionRegistryService: {
      syncCodeFirstCollections: vi.fn().mockResolvedValue({}),
    },
    singleRegistryService: {
      syncCodeFirstSingles: vi.fn().mockResolvedValue({}),
    },
    componentRegistryService:
      opts?.withComponentRegistry !== false
        ? { syncCodeFirstComponents: syncCodeFirstComponentsSpy }
        : undefined,
    schemaRegistry:
      opts?.withSchemaRegistry !== false
        ? { registerDynamicSchema: registerDynamicSchemaSpy }
        : undefined,
    migrationJournal: undefined,
  };
  return Object.assign((name: string) => services[name], {
    syncCodeFirstComponentsSpy,
    registerDynamicSchemaSpy,
  });
}
```

- [ ] **Step 2: Add component test cases at the bottom of the `describe` block (before the closing `}`)**

```ts
describe("component support", () => {
  it("includes component table names in the batched introspect call", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [{ name: "title", type: "text" }] },
          { slug: "seo-meta", fields: [{ name: "description", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        { name: "comp_hero", columns: SQLITE_RESERVED },
        { name: "comp_seo_meta", columns: SQLITE_RESERVED },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(introspectSpy).toHaveBeenCalledTimes(1);
    const tableNames = (
      introspectSpy.mock.calls[0] as [unknown, string, string[]]
    )[2];
    expect(tableNames).toContain("comp_hero");
    expect(tableNames).toContain("comp_seo_meta");
  });

  it("normalises slug to comp_<snake_case> table name (hyphens → underscores)", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "seo-meta", fields: [{ name: "title", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([{ name: "comp_seo_meta", columns: SQLITE_RESERVED }])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    const tableNames = (
      introspectSpy.mock.calls[0] as [unknown, string, string[]]
    )[2];
    expect(tableNames).toContain("comp_seo_meta");
    expect(tableNames).not.toContain("comp_seo-meta");
  });

  it("flows an additive component field change through to the pipeline", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
        ],
      },
    });
    // Live table exists with only reserved columns — subtitle is a new add.
    introspectSpy.mockResolvedValue(
      buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { components: Record<string, unknown> };
    };
    expect(Object.keys(call.desired.components)).toContain("hero");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("skips a standalone drop on a component table and logs a warning", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [] }, // removed `title` field
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        {
          name: "comp_hero",
          columns: [
            ...SQLITE_RESERVED,
            { name: "title", type: "text", nullable: true },
          ],
        },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("hero");
    expect(msg).toContain("data loss");
  });

  it("calls syncCodeFirstComponents after a successful apply", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          {
            slug: "hero",
            label: { singular: "Hero" },
            fields: [{ name: "subtitle", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
    );

    const resolver = buildResolver();
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(resolver.syncCodeFirstComponentsSpy).toHaveBeenCalledTimes(1);
    const configs = resolver.syncCodeFirstComponentsSpy.mock
      .calls[0]?.[0] as Array<{ slug: string; label: string }>;
    expect(configs[0]?.slug).toBe("hero");
    expect(configs[0]?.label).toBe("Hero");
  });

  it("calls registerDynamicSchema for the component table after a successful apply", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([{ name: "comp_hero", columns: SQLITE_RESERVED }])
    );

    const resolver = buildResolver();
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(resolver.registerDynamicSchemaSpy).toHaveBeenCalledWith(
      "comp_hero",
      expect.anything()
    );
  });

  it("does not call the pipeline when all component diffs are empty", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        components: [
          { slug: "hero", fields: [{ name: "title", type: "text" }] },
        ],
      },
    });
    // Live already matches desired.
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        {
          name: "comp_hero",
          columns: [
            ...SQLITE_RESERVED,
            { name: "title", type: "text", nullable: true },
          ],
        },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the new tests to confirm they fail (implementation not written yet)**

```bash
cd /home/mobeen/Desktop/nextly
pnpm --filter @revnixhq/nextly test packages/nextly/src/init/__tests__/reload-config.test.ts 2>&1 | tail -30
```

Expected: The new `component support` tests fail. The existing tests should now pass (since `buildResolver` was fixed to use `adapter`).

---

## Task 2 — Add types, interface, and `DesiredComponent` import to `reload-config.ts`

**Files:**

- Modify: `packages/nextly/src/init/reload-config.ts`

- [ ] **Step 1: Add `DesiredComponent` to the pipeline types import (line 50–54)**

Replace:

```ts
import type {
  DesiredCollection,
  DesiredSchema,
  DesiredSingle,
} from "../domains/schema/pipeline/types";
```

With:

```ts
import type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "../domains/schema/pipeline/types";
```

- [ ] **Step 2: Add `ComponentDef` type after the `SingleDef` block (after line 99)**

After the closing `};` of `SingleDef`, add:

```ts
type ComponentDef = {
  slug?: string;
  fields?: unknown[];
  label?: { singular?: string } | string;
  description?: string;
  admin?: unknown;
};
```

- [ ] **Step 3: Add `ComponentRegistrySurface` interface after `SingleRegistrySurface` (after line 107)**

After:

```ts
interface SingleRegistrySurface {
  syncCodeFirstSingles(configs: unknown[]): Promise<unknown>;
}
```

Add:

```ts
interface ComponentRegistrySurface {
  syncCodeFirstComponents(configs: unknown[]): Promise<unknown>;
}
```

- [ ] **Step 4: Expand the `newConfig` type declaration (line 149) to include `components`**

Replace:

```ts
let newConfig:
  | { collections?: CollectionDef[]; singles?: SingleDef[] }
  | undefined;
```

With:

```ts
let newConfig:
  | {
      collections?: CollectionDef[];
      singles?: SingleDef[];
      components?: ComponentDef[];
    }
  | undefined;
```

- [ ] **Step 5: Expand the config cast (lines 156–158) to include `components`**

Replace:

```ts
newConfig = (
  result as {
    config?: { collections?: CollectionDef[]; singles?: SingleDef[] };
  }
).config;
```

With:

```ts
newConfig = (
  result as {
    config?: {
      collections?: CollectionDef[];
      singles?: SingleDef[];
      components?: ComponentDef[];
    };
  }
).config;
```

---

## Task 3 — Add component target loop, update introspect call, and update early-return guards

**Files:**

- Modify: `packages/nextly/src/init/reload-config.ts`

- [ ] **Step 1: Add `componentTargets` normalization loop after the `singleTargets` loop (after line 259)**

After the closing `}` of the `for (const s of newConfig.singles ?? [])` loop, add:

```ts
// Normalize components. Table name is always comp_<slug_with_underscores>.
const componentTargets: Array<{
  slug: string;
  tableName: string;
  fields: MinimalField[];
}> = [];
for (const c of newConfig.components ?? []) {
  if (!c.slug) continue;
  componentTargets.push({
    slug: c.slug,
    tableName: `comp_${c.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`,
    fields: (c.fields ?? []) as MinimalField[],
  });
}
```

- [ ] **Step 2: Update the first early-return guard (line 261) to include components**

Replace:

```ts
if (targets.length === 0 && singleTargets.length === 0) return;
```

With:

```ts
if (
  targets.length === 0 &&
  singleTargets.length === 0 &&
  componentTargets.length === 0
)
  return;
```

- [ ] **Step 3: Add component table names to the `introspectLiveSnapshot` call (lines 268–275)**

Replace:

```ts
liveSnapshot = await introspectLiveSnapshot(db, dialect, [
  ...targets.map(t => t.tableName),
  ...singleTargets.map(t => t.tableName),
]);
```

With:

```ts
liveSnapshot = await introspectLiveSnapshot(db, dialect, [
  ...targets.map(t => t.tableName),
  ...singleTargets.map(t => t.tableName),
  ...componentTargets.map(t => t.tableName),
]);
```

---

## Task 4 — Add component diff loop, update second early-return guard, pass components to pipeline

**Files:**

- Modify: `packages/nextly/src/init/reload-config.ts`

- [ ] **Step 1: Add the `desiredComponents` diff loop after the singles loop (after line 367)**

After the closing `}` of the `for (const target of singleTargets)` loop, add:

```ts
// Per-component diff + safety classification — mirrors the singles loop.
const desiredComponents: Record<string, DesiredComponent> = {};
for (const target of componentTargets) {
  try {
    const live = liveByTable.has(target.tableName)
      ? { tables: [liveByTable.get(target.tableName)!] }
      : { tables: [] };
    const desiredTable = buildDesiredTableFromFields(
      target.tableName,
      target.fields,
      dialect
    );
    const operations = diffSnapshots(live, { tables: [desiredTable] });

    if (operations.length === 0) continue;

    const classification = classifyForCodeFirst(operations, dialect);
    if (!classification.safe) {
      logger?.warn(
        `[Nextly HMR] Code-first change for component '${target.slug}' needs review ` +
          `(${classification.reason}). Auto-apply skipped. Use the admin Schema ` +
          `Builder to confirm with resolutions, or revert the config edit.`
      );
      continue;
    }

    desiredComponents[target.slug] = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredComponent["fields"],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(
      `[Nextly HMR] Skipping component '${target.slug}' due to error during diff: ${msg}`
    );
  }
}
```

- [ ] **Step 2: Update the second early-return guard (lines 370–374) to include components**

Replace:

```ts
// Nothing to apply across collections or singles.
if (
  Object.keys(desiredCollections).length === 0 &&
  Object.keys(desiredSingles).length === 0
)
  return;
```

With:

```ts
// Nothing to apply across collections, singles, or components.
if (
  Object.keys(desiredCollections).length === 0 &&
  Object.keys(desiredSingles).length === 0 &&
  Object.keys(desiredComponents).length === 0
)
  return;
```

- [ ] **Step 3: Replace `components: {}` with `components: desiredComponents` in the `desired` schema (lines 384–388)**

Replace:

```ts
const desired: DesiredSchema = {
  collections: desiredCollections,
  singles: desiredSingles,
  components: {},
};
```

With:

```ts
const desired: DesiredSchema = {
  collections: desiredCollections,
  singles: desiredSingles,
  components: desiredComponents,
};
```

---

## Task 5 — Add post-apply component registry sync and schema cache refresh

**Files:**

- Modify: `packages/nextly/src/init/reload-config.ts`

- [ ] **Step 1: Add component registry sync after the singles registry sync block (after line ~495)**

After the `} catch { ... }` that closes the singles `syncCodeFirstSingles` block, add:

```ts
// Sync dynamic_components metadata — keeps dynamic_components.fields
// in step with the DDL changes the pipeline just applied.
try {
  const compReg = (await resolve(
    "componentRegistryService"
  )) as ComponentRegistrySurface;
  const codeFirstComponentConfigs = (newConfig.components ?? [])
    .filter((c): c is ComponentDef & { slug: string } => !!c.slug)
    .map(c => {
      const labelStr =
        typeof c.label === "string"
          ? c.label
          : (c.label?.singular ??
            c.slug
              .split(/[-_]/)
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "));
      return {
        slug: c.slug,
        label: labelStr,
        fields: c.fields ?? [],
        description: c.description,
        admin: c.admin,
      };
    });
  if (codeFirstComponentConfigs.length > 0) {
    await compReg.syncCodeFirstComponents(codeFirstComponentConfigs);
  }
} catch {
  // Non-fatal: same reasoning as collection/single metadata sync above.
}
```

- [ ] **Step 2: Add `componentFreshTables` map and generation loop inside the existing fresh-tables try block (lines 500–521)**

Replace:

```ts
const collectionFreshTables = new Map<string, unknown>();
const singleFreshTables = new Map<string, unknown>();
try {
  for (const c of Object.values(desiredCollections)) {
    const { table } = generateRuntimeSchema(
      c.tableName,
      c.fields as Parameters<typeof generateRuntimeSchema>[1],
      dialect
    );
    collectionFreshTables.set(c.tableName, table);
  }
  for (const s of Object.values(desiredSingles)) {
    const { table } = generateRuntimeSchema(
      s.tableName,
      s.fields as Parameters<typeof generateRuntimeSchema>[1],
      dialect
    );
    singleFreshTables.set(s.tableName, table);
  }
} catch {
  // Non-fatal: both refresh blocks below will no-op on empty maps.
}
```

With:

```ts
const collectionFreshTables = new Map<string, unknown>();
const singleFreshTables = new Map<string, unknown>();
const componentFreshTables = new Map<string, unknown>();
try {
  for (const c of Object.values(desiredCollections)) {
    const { table } = generateRuntimeSchema(
      c.tableName,
      c.fields as Parameters<typeof generateRuntimeSchema>[1],
      dialect
    );
    collectionFreshTables.set(c.tableName, table);
  }
  for (const s of Object.values(desiredSingles)) {
    const { table } = generateRuntimeSchema(
      s.tableName,
      s.fields as Parameters<typeof generateRuntimeSchema>[1],
      dialect
    );
    singleFreshTables.set(s.tableName, table);
  }
  for (const comp of Object.values(desiredComponents)) {
    const { table } = generateRuntimeSchema(
      comp.tableName,
      comp.fields as Parameters<typeof generateRuntimeSchema>[1],
      dialect
    );
    componentFreshTables.set(comp.tableName, table);
  }
} catch {
  // Non-fatal: all refresh blocks below will no-op on empty maps.
}
```

- [ ] **Step 3: Add component tables to the `SchemaRegistry` refresh block (lines 523–537)**

Replace:

```ts
try {
  const schemaReg = (await resolve("schemaRegistry")) as SchemaRegistrySurface;
  for (const [tableName, table] of collectionFreshTables) {
    schemaReg.registerDynamicSchema(tableName, table);
  }
  for (const [tableName, table] of singleFreshTables) {
    schemaReg.registerDynamicSchema(tableName, table);
  }
} catch {
  // Non-fatal: next request will still fail with stale schema, but
  // a server restart will recover. Log is intentionally omitted here
  // to avoid noise — the DDL itself succeeded.
}
```

With:

```ts
try {
  const schemaReg = (await resolve("schemaRegistry")) as SchemaRegistrySurface;
  for (const [tableName, table] of collectionFreshTables) {
    schemaReg.registerDynamicSchema(tableName, table);
  }
  for (const [tableName, table] of singleFreshTables) {
    schemaReg.registerDynamicSchema(tableName, table);
  }
  for (const [tableName, table] of componentFreshTables) {
    schemaReg.registerDynamicSchema(tableName, table);
  }
} catch {
  // Non-fatal: next request will still fail with stale schema, but
  // a server restart will recover. Log is intentionally omitted here
  // to avoid noise — the DDL itself succeeded.
}
```

- [ ] **Step 4: Run all tests and confirm they pass**

```bash
cd /home/mobeen/Desktop/nextly
pnpm --filter @revnixhq/nextly test packages/nextly/src/init/__tests__/reload-config.test.ts 2>&1 | tail -40
```

Expected output: All tests pass, including the new `component support` describe block (7 tests).

- [ ] **Step 5: Run TypeScript type-check**

```bash
cd /home/mobeen/Desktop/nextly
pnpm --filter @revnixhq/nextly tsc --noEmit 2>&1 | grep -E "reload-config|error" | head -20
```

Expected: No errors in `reload-config.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/nextly/src/init/reload-config.ts packages/nextly/src/init/__tests__/reload-config.test.ts
git commit -m "feat: extend HMR reload to apply code-first schema changes for components"
```
