/**
 * Lazy runtime-table registration for singles.
 *
 * A single's queryable Drizzle table is registered in the adapter's table
 * resolver at boot (`loadDynamicTables`) and when the entity is created
 * (dispatcher `createSingle`). Both registrations are per-process: a UI
 * single created in one Next.js dev worker is invisible to every other
 * worker until it restarts, and a worker that booted before the
 * `dynamic_singles` row existed never sees it at all. Collections recover
 * from this via `CollectionFileManager.loadDynamicSchema`'s lazy rebuild;
 * singles had no equivalent, so any read/write from an unaware process
 * failed with `Table "single_<slug>" not found in schema registry`.
 *
 * This helper is that equivalent: given the registry row the service just
 * loaded, it registers the main table (and the `_locales` companion for a
 * localized single) into the resolver when missing. Purely in-memory and
 * idempotent — a Map hit makes the repeat call effectively free. Best
 * effort: on any failure the adapter keeps its current behavior (the raw
 * missing-table error), which is exactly the pre-existing outcome.
 *
 * @module domains/singles/services/ensure-runtime-table
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { generateRuntimeSchema } from "../../schema/services/runtime-schema-generator";

/** The registry-row slice this helper needs. */
export interface SingleRuntimeTableMeta {
  slug: string;
  tableName: string;
  fields: unknown;
  status?: boolean;
  localized?: boolean;
}

// The adapter's resolver is a protected member; the dispatcher and boot
// paths already reach it through this structural shape, and the SchemaRegistry
// behind it implements both methods.
interface ResolverLike {
  getTable?: (tableName: string) => unknown;
  registerDynamicSchema?: (tableName: string, table: unknown) => void;
}

export function ensureSingleRuntimeTable(
  adapter: DrizzleAdapter,
  singleMeta: SingleRuntimeTableMeta
): void {
  try {
    const resolver = (adapter as unknown as { tableResolver?: ResolverLike })
      .tableResolver;
    if (
      !resolver ||
      typeof resolver.getTable !== "function" ||
      typeof resolver.registerDynamicSchema !== "function"
    ) {
      return;
    }

    // Registry rows deserialize `fields` into plain field objects; the same
    // shape both generators below consume (name + type + optional localized).
    const fields = (
      Array.isArray(singleMeta.fields) ? singleMeta.fields : []
    ) as { name: string; type: string; localized?: boolean }[];
    const dialect = adapter.dialect;
    const localized = singleMeta.localized === true;
    const status = singleMeta.status === true;

    if (!resolver.getTable(singleMeta.tableName)) {
      // Same generator + flags as the boot registration, so the lazily
      // registered table matches the physical one (a localized single's
      // main table omits its translatable columns — they live in the
      // companion).
      const { table } = generateRuntimeSchema(
        singleMeta.tableName,
        fields as Parameters<typeof generateRuntimeSchema>[1],
        dialect,
        { status, localized }
      );
      resolver.registerDynamicSchema(singleMeta.tableName, table);
    }

    // The companion is checked independently of the main table: a process
    // may have registered the main table before the single was localized
    // (or before this helper existed) and still lack the companion.
    if (localized && !resolver.getTable(`${singleMeta.tableName}_locales`)) {
      const companion = buildCompanionRuntimeTable({
        slug: singleMeta.slug,
        tableName: singleMeta.tableName,
        fields,
        dialect,
        localized: true,
        status,
      });
      if (companion) {
        resolver.registerDynamicSchema(
          companion.companionTableName,
          companion.table
        );
      }
    }
  } catch {
    // Best-effort: fall through to the adapter's own missing-table error.
  }
}
