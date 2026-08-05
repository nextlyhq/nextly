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
 * This helper is that equivalent, and it is deliberately narrow about when
 * it writes:
 *
 * - **Nothing registered** — register from the row. This is the multi-worker
 *   gap above; there is no other candidate.
 * - **Registered by someone else** (boot / create-time / the HMR reconcile,
 *   none of which record a signature here) — leave it alone and record the
 *   row's signature as a baseline. Those paths build from the CONFIG while
 *   this one builds from the `dynamic_singles` ROW, and the two agree only
 *   while the registry sync is current; overriding on first touch would let
 *   a lagging row replace a fresher config-derived table with no signal.
 * - **Registered by this helper, and the row has moved since** — re-register
 *   main and companion together. This is what keeps a localization,
 *   Draft/Published, or field-set change made by ANOTHER worker from being
 *   served through a table whose columns no longer match the physical one.
 * The baseline recorded in the second case is what makes the third work for
 * foreign registrations too: the first touch adopts them, and any LATER row
 * change is still caught.
 *
 * Best effort: on any failure the adapter keeps its current behavior (the
 * raw missing-table error), which is exactly the pre-existing outcome.
 *
 * @module domains/singles/services/ensure-runtime-table
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { generateRuntimeSchema } from "../../schema/services/runtime-schema-generator";

/**
 * Shape signatures of the tables this helper has accounted for, per
 * resolver. Keyed WEAKLY on the resolver object so a torn-down adapter's
 * registry does not pin entries (tests boot many), and per table name
 * inside.
 */
const registeredShapes = new WeakMap<object, Map<string, string>>();

/** The registry-row slice this helper needs. */
export interface SingleRuntimeTableMeta {
  slug: string;
  tableName: string;
  fields: unknown;
  status?: boolean;
  localized?: boolean;
  /**
   * The row's `schema_version`. Bumped by every save that changes the field
   * set, so it stands in for the field payload in the signature below.
   */
  schemaVersion?: number;
}

// The adapter's resolver is a protected member; the dispatcher and boot
// paths already reach it through this structural shape, and the SchemaRegistry
// behind it implements both methods.
interface ResolverLike {
  getTable?: (tableName: string) => unknown;
  registerDynamicSchema?: (tableName: string, table: unknown) => void;
}

/**
 * Everything about the row that can change the generated table's columns.
 *
 * `schemaVersion` is the cheap form: the same saves that change the field
 * set bump it, so it covers the whole field payload at constant cost — this
 * runs on every single read and write, and stringifying a large field array
 * on each one is per-request work the comparison then throws away.
 *
 * Without it (a row predating the column, or a caller that does not carry
 * it) the full field objects are serialized instead. Serialized whole rather
 * than projected to name/type: the column descriptor also branches on field
 * OPTIONS (`hasMany` or an array `relationTo` make a relationship a JSON
 * column, `dbType`/`options.format` change number storage), and a projection
 * listing today's storage-affecting keys would drift as field types evolve.
 */
function shapeSignature(
  meta: SingleRuntimeTableMeta,
  fields: { name: string; type: string; localized?: boolean }[]
): string {
  const shape = `${meta.localized === true}:${meta.status === true}`;
  return meta.schemaVersion !== undefined
    ? `v${meta.schemaVersion}:${shape}`
    : `f${JSON.stringify(fields)}:${shape}`;
}

export function ensureSingleRuntimeTable(
  adapter: DrizzleAdapter,
  singleMeta: SingleRuntimeTableMeta,
  logger?: Logger
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
    const companionName = `${singleMeta.tableName}_locales`;

    let shapes = registeredShapes.get(resolver);
    if (!shapes) {
      shapes = new Map();
      registeredShapes.set(resolver, shapes);
    }
    const recorded = shapes.get(singleMeta.tableName);
    const signature = shapeSignature(singleMeta, fields);

    const mainMissing = !resolver.getTable(singleMeta.tableName);
    const companionMissing = localized && !resolver.getTable(companionName);
    // A recorded signature means THIS helper registered what is there, so a
    // change since then is ours to act on. No record means the registration
    // came from boot / create-time / the reconcile, which own it.
    const rowMovedSinceOurs = recorded !== undefined && recorded !== signature;
    // An unregistered companion is NOT evidence that a foreign registration
    // predates the localization enable, however much it looks like it: the
    // supported pre-migration window presents identically — the row says
    // localized, no companion exists, and the translatable columns are still
    // on the main table, where reads and writes are meant to keep finding
    // them until `nextly migrate` moves them. Re-deriving the main table as
    // localized there drops those columns from the runtime shape and the
    // write silently loses them. Telling the two apart needs to know whether
    // the companion physically exists, which this synchronous helper cannot
    // ask; the adopt rule is correct for both until it can.

    if (!mainMissing && !companionMissing && !rowMovedSinceOurs) {
      // Either up to date, or a foreign registration on first touch: adopt
      // it as the baseline so a later row change is still detected.
      shapes.set(singleMeta.tableName, signature);
      return;
    }

    if (mainMissing || rowMovedSinceOurs) {
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

    if (localized && (companionMissing || rowMovedSinceOurs)) {
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
  } catch (err) {
    // Degrading to the adapter's own missing-table error is the intended
    // behavior, but a silent degrade is what let the original registration
    // gap go unnoticed — leave a trace so the next occurrence is greppable.
    logger?.debug("Lazy single runtime-table registration skipped", {
      slug: singleMeta.slug,
      tableName: singleMeta.tableName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
