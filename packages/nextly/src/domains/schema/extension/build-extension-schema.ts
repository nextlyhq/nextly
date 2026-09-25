/**
 * The one compiler every consumer calls.
 *
 * "One" is the whole design. The diff engine, the runtime registry,
 * `migrate:create`, `migrate:check` and preview all need to know what tables a
 * plugin added, and each computing it from the config independently is how the
 * dev-push cache ends up keyed on something the migration generator disagrees
 * with. They read the result of this function instead.
 *
 * The fingerprint exists for the same reason: a cache keyed on the COMPILED
 * output cannot be stale in a way the compiler cannot see, which a cache keyed
 * on the config can.
 *
 * @module domains/schema/extension/build-extension-schema
 * @since 1.0.0
 */
import { createHash } from "node:crypto";

import type { Table } from "drizzle-orm";

import type {
  DynamicRelationEdge,
  SupportedDialect,
} from "../../../database/schema-registry";
import { drizzleTableToTableSpec } from "../../../schemas/_internal/drizzle-to-tablespec";
import type { TableSpec } from "../pipeline/diff/types";

import { getActiveExtensionSchema } from "./active-schema";
import { type DrizzleSchemaHook, runAfterDrizzle } from "./after-drizzle";
import {
  authoredKeyOf,
  referenceTableStub,
  toDrizzleTable,
  toTableSpec,
} from "./compile";
import { type SeedEntityTable, SchemaDraftStore } from "./draft";
import { runExtensionHooks, type SchemaContribution } from "./run-hooks";
import type {
  ExtensionColumn,
  ExtensionIndex,
  ExtensionTable,
  SchemaOwner,
} from "./types";

export interface ExtensionSchemaInput {
  dialect: SupportedDialect;
  coreTableNames: readonly string[];
  entities: readonly SeedEntityTable[];
  /** Prefix per plugin id, validated at resolve time. */
  pluginPrefixes: ReadonlyMap<string, string>;
  /**
   * Plugin id → the plugin ids it declared a dependency on (hard or
   * optional). A plugin may contribute indexes to a dependency's tables;
   * the resolver owns this fact, so the draft only reads it.
   */
  dependencies?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Enabled plugins, already topologically sorted. */
  plugins: readonly SchemaContribution[];
  app?: SchemaContribution;
  /**
   * The app's per-dialect escape hatch, run over the COMPILED tables.
   *
   * Taken here rather than applied by the caller because the check that makes
   * it safe needs two things this function owns: the ownership map, so a hook
   * cannot reshape a plugin's table, and the compiled output itself. A caller
   * applying the hooks afterwards would hold neither, and the specs would
   * already have been derived from the pre-hook tables.
   */
  afterDrizzle?: readonly DrizzleSchemaHook[];
}

export interface ExtensionSchema {
  /** Plugin and app tables. */
  tables: ExtensionTable[];
  /** Entity table name → indexes added to it. */
  entityIndexes: Map<string, ExtensionIndex[]>;
  /**
   * Entity or core table name → HIDDEN columns added to it.
   *
   * Carried separately from `tables` because these belong to a table this
   * module does not own: they must reach the entity's desired spec and its
   * runtime Drizzle table, and must NOT be emitted as a table of their own.
   */
  entityColumns: Map<string, ExtensionColumn[]>;
  /** Compiled, for the diff engine. */
  specs: TableSpec[];
  /** Compiled, sqlName → Drizzle table. */
  drizzle: Record<string, unknown>;
  /** Table name → owner. P2-B persists this. */
  owners: Map<string, SchemaOwner>;
  /** Table name → relation edges, for SchemaRegistry registration. */
  relations: Map<string, DynamicRelationEdge[]>;
  /** Table name → elements contributed to a table another owner declared. */
  elementOwners: Map<
    string,
    Array<{
      elementKind: "column" | "index" | "fk" | "check";
      elementName: string;
      owner: SchemaOwner;
    }>
  >;
  /** Adopted tables: drizzle handles for typed access, never managed. */
  adopted: Record<string, unknown>;
  /** Adopted tables' relation edges, for registry registration. */
  adoptedRelations: Map<string, DynamicRelationEdge[]>;
  /** Stable hash of the compiled output, for caches. */
  fingerprint: string;
}

/**
 * A fingerprint of what was COMPILED, not of what was configured.
 *
 * Keyed on the specs and the entity indexes because those are what any
 * consumer acts on. A hash of the config would move when a comment moved and
 * stay still when a hook's output changed, which is the wrong answer in both
 * directions.
 */
function fingerprintOf(
  specs: readonly TableSpec[],
  entityIndexes: ReadonlyMap<string, ExtensionIndex[]>,
  entityColumns: ReadonlyMap<string, ExtensionColumn[]>
): string {
  // Sorted so the hash describes the CONTENT rather than the order the tables
  // happened to be visited in; two runs that produce the same schema must
  // agree even if a hook ran in a different position.
  const tables = [...specs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(spec => ({
      name: spec.name,
      columns: spec.columns,
      indexes: spec.indexes ?? [],
      // Constraints belong here by the same argument the contributed columns
      // below are included for: they are part of what the schema now
      // describes, and a hash that ignores them reports "nothing changed" for
      // a change dev push has to act on. A check-only or foreign-key-only
      // edit — and every `col.enum()` change, which compiles to a check —
      // therefore left this hash identical, the push was skipped, and the new
      // constraint waited for an unrelated edit to force another run.
      checks: spec.checks ?? [],
      foreignKeys: spec.foreignKeys ?? [],
    }));
  const entities = [...entityIndexes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, indexes]) => [name, indexes] as const);
  // Contributed COLUMNS belong here for the same reason contributed indexes
  // do: they are part of what the schema now describes, and a fingerprint
  // that ignores them reports "nothing changed" for a change dev push has to
  // act on — so the column would wait for an unrelated edit to be created.
  const entityCols = [...entityColumns.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, columns]) => [name, columns] as const);

  return createHash("sha256")
    .update(JSON.stringify({ tables, entities, entityCols }))
    .digest("hex");
}

/** Build the extension schema: seed, run hooks in order, compile. */
/**
 * A table's relation edges, in the form the schema registry composes.
 *
 * The registry looks each column up on the COMPILED Drizzle table, whose
 * properties are the authored keys (`ownerId`) while a declaration names SQL
 * columns (`owner_id`). Passing the SQL name through made every edge on a
 * column whose two names differ fail at `getRelations` as an unknown column,
 * which took `ctx.db.query` down for the whole schema. A target outside this
 * compile keeps the name as declared: a core table's properties are the ones
 * its bundle defines, and nothing here can translate for it.
 */
function relationEdgesOf(
  table: ExtensionTable,
  byName: ReadonlyMap<string, ExtensionTable>
): DynamicRelationEdge[] {
  return (table.relations ?? []).map(rel => {
    const target = byName.get(rel.targetTable);
    return {
      key: rel.name,
      fromColumn: authoredKeyOf(table, rel.fromColumn ?? ""),
      targetTable: rel.targetTable,
      ...(rel.toColumn !== undefined
        ? {
            toColumn:
              target === undefined
                ? rel.toColumn
                : authoredKeyOf(target, rel.toColumn),
          }
        : {}),
    };
  });
}

export async function buildExtensionSchema(
  input: ExtensionSchemaInput
): Promise<ExtensionSchema> {
  const store = new SchemaDraftStore({
    dialect: input.dialect,
    coreTableNames: input.coreTableNames,
    entities: input.entities,
    pluginPrefixes: input.pluginPrefixes,
    dependencies: input.dependencies,
  });

  await runExtensionHooks(store, input.plugins, input.app);

  const tables: ExtensionTable[] = store.extensionTables().map(table => ({
    name: table.name,
    authored: table.authored,
    owner: table.owner as SchemaOwner,
    columns: table.columns,
    indexes: table.indexes,
    ...(table.foreignKeys !== undefined
      ? { foreignKeys: table.foreignKeys }
      : {}),
    ...(table.checks !== undefined ? { checks: table.checks } : {}),
    ...(table.relations !== undefined ? { relations: table.relations } : {}),
  }));

  // Elements contributed to a table another owner declared: keyed for the
  // per-element owner rows. An app-contributed index on a plugin table rides
  // the APP migration stream while the table itself rides the plugin's —
  // recording the element is what lets the plugin's reconcile ignore it.
  const elementOwners = new Map<
    string,
    Array<{
      elementKind: "column" | "index" | "fk" | "check";
      elementName: string;
      owner: SchemaOwner;
    }>
  >();
  for (const table of tables) {
    for (const index of table.indexes) {
      if (index.contributedBy === undefined) continue;
      const list = elementOwners.get(table.name) ?? [];
      list.push({
        elementKind: "index",
        elementName:
          index.name ?? `idx_${table.name}_${index.columns.join("_")}`,
        owner: index.contributedBy,
      });
      elementOwners.set(table.name, list);
    }
    // Hidden columns a foreign contributor added, element-recorded the same
    // way: the column rides the contributor's stream, and the table owner's
    // reconcile excludes it.
    for (const column of table.columns) {
      if (column.contributedBy === undefined) continue;
      const list = elementOwners.get(table.name) ?? [];
      list.push({
        elementKind: "column",
        elementName: column.name,
        owner: column.contributedBy,
      });
      elementOwners.set(table.name, list);
    }
  }

  // Relation edges for the registry: keys snake-cased at declaration, targets
  // kept as final table names, so a registration composes straight into the
  // schema-wide relations config that powers db.query.
  const relations = new Map<string, DynamicRelationEdge[]>();
  const byName = new Map<string, ExtensionTable>(
    [...tables, ...store.adoptedTables()].map(table => [
      table.name,
      table as ExtensionTable,
    ])
  );
  for (const table of tables) {
    const edges = relationEdgesOf(table, byName);
    if (edges.length > 0) relations.set(table.name, edges);
  }

  // Indexes contributed to entity tables are carried separately: they belong
  // to a table this module does not own and must not be emitted as one.
  const entityIndexes = new Map<string, ExtensionIndex[]>();
  const entityColumns = new Map<string, ExtensionColumn[]>();
  for (const table of store.all()) {
    const isForeign =
      table.owner.kind === "entity" || table.owner.kind === "core";
    if (!isForeign) continue;

    if (table.indexes.length > 0) {
      entityIndexes.set(table.name, table.indexes);
    }
    // Only the columns somebody ADDED. A seeded entity table already carries
    // its own, and emitting those would make the pipeline propose creating
    // columns that exist.
    const added = table.columns.filter(column => column.hidden === true);
    if (added.length > 0) {
      entityColumns.set(table.name, added);
    }
  }

  const compiledSpecs = tables.map(table => toTableSpec(table, input.dialect));
  const compiled: Record<string, unknown> = {};
  const owners = new Map<string, SchemaOwner>();
  for (const table of tables) {
    compiled[table.name] = toDrizzleTable(table, input.dialect);
    owners.set(table.name, table.owner);
  }
  // Second pass, SQLite only: tables with foreign keys are rebuilt with a
  // resolver, so the kit-bound definition carries every constraint and a
  // change travels through the rebuild — SQLite has no other way to get one.
  //
  // A table in this bundle resolves to its pass-one object. Anything else —
  // core, entity, adopted — resolves to a stand-in built from the declaration
  // itself, because the foreign key clause needs only the table's name and
  // the referenced columns'. Resolving the REAL object instead made the
  // constraint depend on boot order (this runs before the schema registry
  // exists) and could never reach an entity table at all, so the constraint
  // was compiled away and SQLite silently never enforced it.
  if (input.dialect === "sqlite") {
    for (const table of tables) {
      if ((table.foreignKeys ?? []).length === 0) continue;
      compiled[table.name] = toDrizzleTable(
        table,
        input.dialect,
        (name, columns) => compiled[name] ?? referenceTableStub(name, columns)
      );
    }
  }

  // Core and entity tables are Nextly's to maintain, so a hook may not return
  // one. Built from the same two inputs the draft store seeds itself from,
  // rather than from the compiled tables: `compiled` holds only extension
  // tables, so deriving the protected set from it would be empty and the
  // refusal would never fire.
  const protectedTables = new Set<string>([
    ...input.coreTableNames,
    ...input.entities.map(entity => entity.name),
  ]);

  const drizzle = await runAfterDrizzle({
    dialect: input.dialect,
    tables: compiled,
    hooks: input.afterDrizzle ?? [],
    owners,
    protectedTables,
  });

  // The migration model follows the hook, rather than describing the shape the
  // hook was handed.
  //
  // `compiledSpecs` was built BEFORE the hooks ran, so a hook widening a column
  // to `bigint` — the reason this escape hatch exists — changed the table dev
  // push creates and nothing else: `migrate:create` still read the pre-hook
  // spec, so the column reached the developer's database and no migration. The
  // fingerprint was computed from the same stale specs, so nothing downstream
  // could notice either.
  //
  // Re-derived from the VALIDATED output: `runAfterDrizzle` has already refused
  // anything the model cannot carry, so every shape here is one
  // `drizzleTableToTableSpec` can express. Every key in the returned map gets a
  // spec, including one the hook introduced — a table present at runtime and
  // absent from the migration model is the divergence this exists to close, and
  // it does not matter whether the hook changed the table or created it.
  // Tables the hooks left untouched re-derive to the spec they started with.
  // A table the hook INTRODUCED is owned by the app, like every other thing
  // an `afterDrizzle` hook may do.
  //
  // `owners` was filled from the pre-hook DSL tables only, so a hook-created
  // table had no owner row. `reload-config` reads a missing owner as "removed"
  // and retracts the dynamic schema on the next HMR reload, which made the
  // table unavailable until a restart — and it was invisible to every
  // ownership-based access path in between.
  for (const name of Object.keys(drizzle)) {
    if (!owners.has(name)) owners.set(name, { kind: "app" });
  }

  const specs =
    (input.afterDrizzle ?? []).length === 0
      ? compiledSpecs
      : Object.entries(drizzle).map(([name, table]) => {
          const compiledSpec = compiledSpecs.find(spec => spec.name === name);
          // Untouched tables keep the spec COMPILED from the declaration.
          //
          // The Drizzle object is a lossy view of it: the neutral model
          // carries declared checks and foreign keys that `toDrizzleTable`
          // deliberately leaves off on PostgreSQL and MySQL, where they are
          // applied as separate statements. Re-deriving every table from
          // Drizzle therefore erased them, and constraints vanished from
          // migration generation and drift.
          //
          // Identity again, matching what `runAfterDrizzle` validates: the
          // same object means the hook did not touch it, so the declaration
          // remains the better description of it.
          if (compiledSpec !== undefined && table === compiled[name]) {
            return compiledSpec;
          }
          return drizzleTableToTableSpec(table as Table, input.dialect);
        });

  // Adopted tables compile to drizzle ONLY: registered for typed access and
  // queries, absent from specs (so no diff ever proposes DDL for them), from
  // the fingerprint (a cache key over managed state), and from the kit bundle
  // (so drizzle-kit never sees — never mind alters — a table Nextly does not
  // own). Their exclusion is structural, not a filter somebody must remember.
  const adopted: Record<string, unknown> = {};
  const adoptedRelations = new Map<string, DynamicRelationEdge[]>();
  for (const table of store.adoptedTables()) {
    adopted[table.name] = toDrizzleTable(table as never, input.dialect);
    // App-owned, so nextly.db reaches the table and a plugin's owner check
    // does not — the access rule the plan gives adopted tables.
    owners.set(table.name, { kind: "app" });
    const edges = relationEdgesOf(table as ExtensionTable, byName);
    if (edges.length > 0) adoptedRelations.set(table.name, edges);
  }

  return {
    tables,
    entityIndexes,
    entityColumns,
    specs,
    drizzle,
    owners,
    relations,
    elementOwners,
    /** Adopted tables: drizzle handles for typed access, never managed. */
    adopted,
    /** Adopted tables' relation edges, for registry registration. */
    adoptedRelations,
    fingerprint: fingerprintOf(specs, entityIndexes, entityColumns),
  };
}

/**
 * The active schema lives in its own module, and is re-exported here so every
 * existing consumer keeps its import. See `active-schema.ts` for why the
 * split exists.
 */
export {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "./active-schema";
export { getActiveExtensionSchema };

/**
 * Whether a table is one an enabled plugin or the app currently DECLARES.
 *
 * Asked of the compiled schema rather than of a prefix, deliberately. A prefix
 * test answers "does this look like a plugin table", which stays true after
 * the plugin is removed from config — and a table nothing declares any more
 * must fall OUTSIDE the desired set, where `filterUnsafeStatements` already
 * protects it from being dropped. Matching by name would mean a plugin
 * uninstall silently taking its data with it.
 *
 * Lives here rather than in `managed-tables` because the answer comes from the
 * active schema: putting it there made that module import this one, and this
 * one already reaches it through the draft's naming rules — a cycle.
 * `MANAGED_TABLE_PREFIXES` stays unchanged either way; extension tables are
 * not part of the collection or component namespaces.
 */
export function isRegisteredExtensionTable(
  name: string,
  dialect: SupportedDialect
): boolean {
  return getActiveExtensionSchema(dialect)?.owners.has(name) === true;
}

/**
 * Warn once when a hook is not deterministic.
 *
 * A hook reading `Date.now()` into a column default produces a different
 * schema on every build, so dev push proposes the same change forever and
 * never converges. Detected by building twice and comparing fingerprints —
 * which is why the fingerprint is of the compiled output.
 */
export async function assertDeterministic(
  input: ExtensionSchemaInput,
  first: ExtensionSchema,
  warn: (message: string) => void
): Promise<void> {
  const second = await buildExtensionSchema(input);
  if (second.fingerprint === first.fingerprint) return;

  const changed = [...first.owners.entries()]
    .filter(([name]) => !second.owners.has(name))
    .map(([name]) => name);
  warn(
    `A schema hook is not deterministic: two builds of the same config produced different schemas${
      changed.length > 0 ? ` (${changed.join(", ")})` : ""
    }. Dev push will churn.`
  );
}
