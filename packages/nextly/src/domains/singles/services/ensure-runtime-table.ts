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
 * localized single) into the resolver when the registration is missing OR
 * its shape no longer matches the row. The shape check matters for the same
 * multi-worker reason as the miss: another worker can toggle localization or
 * Draft/Published, or change the field set — the row then says one shape
 * while this process's registration still has the old one, and reads would
 * select columns the physical table no longer carries. Registrations are
 * re-derived whenever the row-derived signature changes; a signature hit
 * makes the repeat call effectively free. Best effort: on any failure the
 * adapter keeps its current behavior (the raw missing-table error), which is
 * exactly the pre-existing outcome.
 *
 * @module domains/singles/services/ensure-runtime-table
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { generateRuntimeSchema } from "../../schema/services/runtime-schema-generator";

/**
 * Shape signatures of the tables this helper registered, per resolver. Keyed
 * WEAKLY on the resolver object so a torn-down adapter's registry does not
 * pin entries (tests boot many), and per table name inside.
 */
const registeredShapes = new WeakMap<object, Map<string, string>>();

/**
 * Everything about the row that can change the generated table's columns.
 * The FULL field objects are serialized rather than a name/type projection:
 * the column descriptor also branches on options a projection would miss
 * (`hasMany`/array `relationTo` turn a relationship into a JSON column,
 * `dbType`/`options.format` change number storage, ...), and listing them
 * here would drift as field types evolve. Over-sensitivity is safe — a
 * changed-but-equivalent row just re-derives an identical registration.
 */
function shapeSignature(
  meta: SingleRuntimeTableMeta,
  fields: { name: string; type: string; localized?: boolean }[]
): string {
  return JSON.stringify([
    meta.localized === true,
    meta.status === true,
    fields,
  ]);
}

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

    // Re-register when the table is missing OR the row's shape moved past
    // what this process registered. A registration made elsewhere (boot,
    // create-time) has no recorded signature, so the first pass through here
    // re-derives it once from the same row + generators — an identical
    // replacement — and records the signature that makes later calls free.
    const signature = shapeSignature(singleMeta, fields);
    let shapes = registeredShapes.get(resolver);
    if (!shapes) {
      shapes = new Map();
      registeredShapes.set(resolver, shapes);
    }
    const upToDate =
      shapes.get(singleMeta.tableName) === signature &&
      Boolean(resolver.getTable(singleMeta.tableName));
    if (upToDate) return;

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

    // The companion rides the same signature: a localization or status
    // toggle changes which columns live there (or whether it is used at
    // all), so it is re-derived together with the main table.
    if (localized) {
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
    shapes.set(singleMeta.tableName, signature);
  } catch {
    // Best-effort: fall through to the adapter's own missing-table error.
  }
}
