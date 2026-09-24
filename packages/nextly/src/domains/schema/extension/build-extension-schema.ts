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

import type {
  DynamicRelationEdge,
  SupportedDialect,
} from "../../../database/schema-registry";
import type { TableSpec } from "../pipeline/diff/types";

import { type DrizzleSchemaHook, runAfterDrizzle } from "./after-drizzle";
import { toDrizzleTable, toTableSpec } from "./compile";
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
  entityIndexes: ReadonlyMap<string, ExtensionIndex[]>
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
    }));
  const entities = [...entityIndexes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, indexes]) => [name, indexes] as const);

  return createHash("sha256")
    .update(JSON.stringify({ tables, entities }))
    .digest("hex");
}

/** Build the extension schema: seed, run hooks in order, compile. */
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
    ...(table.foreignKeys !== undefined ? { foreignKeys: table.foreignKeys } : {}),
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
          index.name ??
          `idx_${table.name}_${index.columns.join("_")}`,
        owner: index.contributedBy,
      });
      elementOwners.set(table.name, list);
    }
  }

  // Relation edges for the registry: keys snake-cased at declaration, targets
  // kept as final table names, so a registration composes straight into the
  // schema-wide relations config that powers db.query.
  const relations = new Map<string, DynamicRelationEdge[]>();
  for (const table of tables) {
    const edges: DynamicRelationEdge[] = (table.relations ?? []).map(rel => ({
      key: rel.name,
      fromColumn: rel.fromColumn ?? "",
      targetTable: rel.targetTable,
      ...(rel.toColumn !== undefined ? { toColumn: rel.toColumn } : {}),
    }));
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

  const specs = tables.map(table => toTableSpec(table, input.dialect));
  const compiled: Record<string, unknown> = {};
  const owners = new Map<string, SchemaOwner>();
  for (const table of tables) {
    compiled[table.name] = toDrizzleTable(table, input.dialect);
    owners.set(table.name, table.owner);
  }
  // Second pass, SQLite only: tables whose foreign keys reference another
  // table in this bundle are rebuilt with a resolver over the pass-one
  // objects, so the kit-bound definition carries the constraint and a
  // change travels through the rebuild. A reference to a table OUTSIDE the
  // bundle (core, entity) is skipped on the kit table — the resolver
  // returns undefined and toDrizzleTable leaves that foreign key to the
  // statement path.
  if (input.dialect === "sqlite") {
    for (const table of tables) {
      if ((table.foreignKeys ?? []).length === 0) continue;
      compiled[table.name] = toDrizzleTable(
        table,
        input.dialect,
        name => compiled[name]
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

  // Adopted tables compile to drizzle ONLY: registered for typed access and
  // queries, absent from specs (so no diff ever proposes DDL for them), from
  // the fingerprint (a cache key over managed state), and from the kit bundle
  // (so drizzle-kit never sees — never mind alters — a table Nextly does not
  // own). Their exclusion is structural, not a filter somebody must remember.
  const adopted: Record<string, unknown> = {};
  const adoptedRelations = new Map<string, DynamicRelationEdge[]>();
  for (const table of store.adoptedTables()) {
    adopted[table.name] = toDrizzleTable(
      table as never as ExtensionTable,
      input.dialect
    );
    // App-owned, so nextly.db reaches the table and a plugin's owner check
    // does not — the access rule the plan gives adopted tables.
    owners.set(table.name, { kind: "app" });
    const edges: DynamicRelationEdge[] = (table.relations ?? []).map(rel => ({
      key: rel.name,
      fromColumn: rel.fromColumn ?? "",
      targetTable: rel.targetTable,
      ...(rel.toColumn !== undefined ? { toColumn: rel.toColumn } : {}),
    }));
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
    fingerprint: fingerprintOf(specs, entityIndexes),
  };
}

/**
 * The process-level active schema.
 *
 * Set at boot and on HMR reload, read by every consumer. A module-level value
 * rather than a DI registration because the CLI never boots a container and
 * still has to reach the same answer; two paths to one fact is what this
 * whole module exists to avoid.
 */
const active = new Map<SupportedDialect, ExtensionSchema>();

export function setActiveExtensionSchema(
  dialect: SupportedDialect,
  schema: ExtensionSchema
): void {
  active.set(dialect, schema);
}

export function getActiveExtensionSchema(
  dialect: SupportedDialect
): ExtensionSchema | null {
  return active.get(dialect) ?? null;
}

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

/** Forget the active schema. For tests and for a reload that failed. */
export function clearActiveExtensionSchema(): void {
  active.clear();
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
