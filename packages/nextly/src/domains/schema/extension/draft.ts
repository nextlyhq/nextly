/**
 * The shared, owned draft every schema hook writes into.
 *
 * One store holds every table — core, entity and extension alike — and each
 * caller gets a VIEW of it scoped to what that caller owns. The separation is
 * the point: a hook can SEE the whole schema, which is what makes it possible
 * to index a collection or reference a user, but what it may CHANGE is decided
 * by the owner recorded on each table rather than by the hook's own claim.
 *
 * Core and entity tables are seeded read-only. They are not extension tables
 * and nothing here may alter them; they are present so a hook can look a table
 * up, and so a name collision is caught against the real schema rather than
 * against a list of names that drifts from it.
 *
 * @module domains/schema/extension/draft
 * @since 1.0.0
 */
import { getColumns, getTableName, isTable } from "drizzle-orm";

import {
  staticRelationTables,
  type SupportedDialect,
} from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { toSnakeCase } from "../services/field-column-descriptor";

import type { TableRelationInput, ColumnBuilder, TableDefinition } from "./dsl";
import { defineTable } from "./dsl";
import {
  assertAddableToExistingRows,
  assertMayAddColumns,
  EXTENDABLE_CORE_TABLES,
  type ExtensionTarget,
} from "./extension-columns";
import {
  assertIndexBuildable,
  assertUsableAppTableName,
  pluginTableName,
  PREFIX_SEPARATOR,
} from "./naming";
import type {
  DeclaredCheck,
  DeclaredForeignKey,
  ExtensionColumn,
  ExtensionIndex,
  SchemaOwner,
} from "./types";

/** Who owns a table in the draft, including the two kinds nothing may change. */
export type DraftOwner =
  | SchemaOwner
  | { kind: "core" }
  | {
      kind: "entity";
      slug: string;
      entityKind: "collection" | "single" | "component";
    };

export interface DraftTableView {
  readonly name: string;
  readonly owner: DraftOwner;
  readonly columns: readonly {
    name: string;
    kind: string;
    nullable: boolean;
  }[];
  readonly indexes: readonly ExtensionIndex[];
}

interface DraftTable {
  name: string;
  /** The name before any prefix; equal to `name` for core and entity tables. */
  authored: string;
  owner: DraftOwner;
  columns: ExtensionColumn[];
  indexes: ExtensionIndex[];
  foreignKeys?: DeclaredForeignKey[];
  checks?: DeclaredCheck[];
  relations?: TableRelationInput[];
  /**
   * Seeded columns known by NAME only — a core table's, or an entity system
   * column the seed could not type. They take part in the duplicate-name rule
   * and in "does the index name a real column", but no index rule is judged
   * over the kind they were given, because that kind is a stand-in.
   */
  opaqueColumns?: ReadonlySet<string>;
}

export interface SchemaDraft {
  readonly dialect: SupportedDialect;
  /** Adds a table owned by the caller. For a plugin the prefix is applied. */
  addTable(def: TableDefinition): void;
  /**
   * Claims an EXISTING table for typed access: no DDL, no diff, no
   * migration, never dropped. App only — a plugin's tables are created and
   * owned by the plugin, so there is nothing for it to adopt.
   */
  adoptTable(def: TableDefinition): void;
  /** Adds columns (own tables only) and indexes (own and entity tables). */
  extendTable(
    name: string,
    ext: {
      columns?: Record<string, ColumnBuilder>;
      indexes?: { columns: string[]; unique?: boolean; name?: string }[];
    }
  ): void;
  getTable(name: string): DraftTableView | undefined;
  tables(): readonly DraftTableView[];
}

export type SchemaHook = (args: {
  schema: SchemaDraft;
  dialect: SupportedDialect;
}) => void | Promise<void>;

/** One seeded entity table, as the resolved entity list describes it. */
export interface SeedEntityTable {
  name: string;
  slug: string;
  entityKind: "collection" | "single" | "component";
  /**
   * The table's real columns — its fields' and its system columns — so a
   * contribution is checked against them. `kind` is omitted where the seed
   * cannot type a column; such a column is known by name only. An entity
   * seeded with NO columns is one whose column set was not supplied at all.
   */
  columns: {
    name: string;
    kind?: string;
    length?: number;
    nullable: boolean;
  }[];
}

/**
 * The columns of each core table, by SQL name, from the dialect bundle the
 * registry serves — the tables themselves, rather than a second list of their
 * columns kept here. Known by name only: the bundle's column types are
 * Drizzle's, not the kinds the index rules judge.
 */
function coreTableColumnNames(
  dialect: SupportedDialect
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const table of Object.values(staticRelationTables(dialect))) {
    if (!isTable(table)) continue;
    out.set(
      getTableName(table),
      Object.values(getColumns(table)).map(column => column.name)
    );
  }
  return out;
}

/** A column known by name only, typed with a stand-in kind nothing judges. */
function opaqueColumn(name: string, nullable: boolean): ExtensionColumn {
  return { key: name, name, kind: "text", nullable };
}

export interface SchemaDraftStoreInput {
  dialect: SupportedDialect;
  coreTableNames: readonly string[];
  entities: readonly SeedEntityTable[];
  /** Prefix per plugin id, so a plugin's own tables can be named and found. */
  pluginPrefixes: ReadonlyMap<string, string>;
  /**
   * Plugin id → the ids it declared a dependency on. The resolver owns the
   * fact; the draft only reads it to decide who may index whose tables.
   */
  dependencies?: ReadonlyMap<string, ReadonlySet<string>>;
}

function refuse(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

function describeOwner(owner: DraftOwner): string {
  switch (owner.kind) {
    case "plugin":
      return `plugin "${owner.id}"`;
    case "app":
      return "the app";
    case "core":
      return "core";
    case "entity":
      return `the ${owner.entityKind} "${owner.slug}"`;
  }
}

function sameOwner(a: DraftOwner, b: DraftOwner): boolean {
  if (a.kind === "plugin" && b.kind === "plugin") return a.id === b.id;
  return a.kind === "app" && b.kind === "app";
}

/**
 * The store behind every per-owner draft.
 *
 * Held separately from the views so that ordering is observable: a hook running
 * later sees what an earlier one added, which is what makes dependency order
 * meaningful rather than decorative.
 */
export class SchemaDraftStore {
  private readonly tables = new Map<string, DraftTable>();

  constructor(private readonly input: SchemaDraftStoreInput) {
    // Seeded with their real columns so a contribution reusing one of their
    // names is refused by the same rule an owner's own table applies. Seeded
    // empty, a contributed `created_at` on `users` passed, and two columns of
    // one name reached the runtime table.
    const coreColumns = coreTableColumnNames(input.dialect);
    for (const name of input.coreTableNames) {
      const columns = coreColumns.get(name) ?? [];
      this.tables.set(name, {
        name,
        authored: name,
        owner: { kind: "core" },
        columns: columns.map(column => opaqueColumn(column, true)),
        indexes: [],
        opaqueColumns: new Set(columns),
      });
    }
    for (const entity of input.entities) {
      this.tables.set(entity.name, {
        name: entity.name,
        authored: entity.name,
        owner: {
          kind: "entity",
          slug: entity.slug,
          entityKind: entity.entityKind,
        },
        // Built from the same descriptor path the diff uses, so the draft and
        // the diff agree on column names rather than each deriving their own.
        columns: entity.columns.map(column =>
          column.kind === undefined
            ? opaqueColumn(column.name, column.nullable)
            : {
                key: column.name,
                name: column.name,
                kind: column.kind as ExtensionColumn["kind"],
                nullable: column.nullable,
                ...(column.length !== undefined
                  ? { length: column.length }
                  : {}),
              }
        ),
        indexes: [],
        opaqueColumns: new Set(
          entity.columns
            .filter(column => column.kind === undefined)
            .map(column => column.name)
        ),
      });
    }
  }

  /** The extension tables only — what the compiler downstream consumes. */
  extensionTables(): DraftTable[] {
    return [...this.tables.values()].filter(
      table => table.owner.kind === "plugin" || table.owner.kind === "app"
    );
  }

  /**
   * Adopted tables: existing tables the app claims for TYPED ACCESS only —
   * never in the desired set, never diffed, never migrated, never dropped.
   * Kept in their own map precisely so no managed-table rule can reach them
   * by accident: `extensionTables` and `all` do not include them.
   */
  private readonly adopted = new Map<string, DraftTable>();

  adopt(def: TableDefinition, owner: SchemaOwner): void {
    if (owner.kind !== "app") {
      refuse(
        `plugin.${owner.id}.schema.adoptTable`,
        "Only the app may adopt an existing table; a plugin's tables are created and owned by the plugin."
      );
    }
    if (this.tables.has(def.name)) {
      refuse(
        `app.db.schema.adoptTable.${def.name}`,
        `"${def.name}" is a managed table and cannot be adopted; adoptTable is for tables Nextly does not own.`
      );
    }
    if (this.adopted.has(def.name)) {
      refuse(
        `app.db.schema.adoptTable.${def.name}`,
        `"${def.name}" is already adopted.`
      );
    }
    this.adopted.set(def.name, {
      name: def.name,
      authored: def.name,
      owner,
      columns: def.columns.map(column => ({ ...column })),
      indexes: [],
      ...(def.relations.length > 0 ? { relations: [...def.relations] } : {}),
    });
  }

  adoptedTables(): DraftTable[] {
    return [...this.adopted.values()];
  }

  all(): DraftTable[] {
    return [...this.tables.values()];
  }

  get(name: string): DraftTable | undefined {
    return this.tables.get(name);
  }

  set(table: DraftTable): void {
    this.tables.set(table.name, table);
  }

  get dialect(): SupportedDialect {
    return this.input.dialect;
  }

  get dependencies(): ReadonlyMap<string, ReadonlySet<string>> | undefined {
    return this.input.dependencies;
  }

  get coreTableNames(): readonly string[] {
    return this.input.coreTableNames;
  }

  get pluginPrefixes(): ReadonlyMap<string, string> {
    return this.input.pluginPrefixes;
  }
}

function toView(table: DraftTable): DraftTableView {
  return Object.freeze({
    name: table.name,
    owner: table.owner,
    columns: Object.freeze(
      table.columns.map(column => ({
        name: column.name,
        kind: column.kind,
        nullable: column.nullable,
      }))
    ),
    indexes: Object.freeze([...table.indexes]),
  });
}

/**
 * Which rule set applies to this table, for this caller.
 *
 * Derived from the table's recorded owner rather than from its name: a prefix
 * test answers "does this look like a core table", which is a different
 * question and one that a renamed table answers wrongly.
 */
function targetOf(table: DraftTable, scope: ExtendScope): ExtensionTarget {
  if (scope.isOwn) return { kind: "own" };
  if (table.owner.kind === "entity") {
    return { kind: "entity", slug: table.owner.slug };
  }
  if (table.owner.kind === "core") return { kind: "core", table: table.name };
  return { kind: "foreign", owner: table.owner };
}

/** What the ownership rules need to know about one `extendTable` call. */
interface ExtendScope {
  owner: SchemaOwner;
  ownerPath: string;
  isOwn: boolean;
  isEntity: boolean;
  /** The plugin ids this owner declared a dependency on, when it is one. */
  mayIndexForeignTablesOf?: ReadonlySet<string>;
}

/**
 * The extra rules a column added to someone ELSE's table must satisfy.
 *
 * Split out of `addColumns` because they answer a different question from the
 * ones there: that loop decides what a column IS, and these decide whether a
 * table this caller does not own can receive it.
 */
function assertForeignColumnAllowed(
  column: ExtensionColumn,
  tableName: string,
  scope: ExtendScope
): void {
  assertAddableToExistingRows(column, tableName);
  // A generated key belongs to the table that declares it. Added to a table
  // someone else owns, it is a second auto-assigning column on a row whose
  // identity is already decided — and on MySQL a second AUTO_INCREMENT column
  // is not even legal.
  if (column.kind === "serial") {
    refuse(
      `${scope.ownerPath}.extendTable.${tableName}`,
      `Column "${column.name}" is serial, which may only be declared on a table its own owner creates.`
    );
  }
  // A key, or a value the database cannot supply, likewise belongs to the
  // table's owner. A contributed primary key would make the table's key
  // composite on a fresh database and be refused on an existing one. A
  // generated value (`col.id()`'s UUIDv7) has no database default: it exists
  // only when the code writing the row generates it, and a table somebody
  // else owns is written by code that does not know the column is there — so
  // the row arrives without it, into a NOT NULL column.
  if (column.primaryKey === true || column.generated !== undefined) {
    refuse(
      `${scope.ownerPath}.extendTable.${tableName}`,
      `Column "${column.name}" is ${column.primaryKey === true ? "a primary key" : "generated"}, which only the table's owner may declare. Contribute a plain column instead — nullable, or with a default.`
    );
  }
}

/**
 * Add columns to a table: freely to the caller's own; as a HIDDEN column to
 * an entity table (collection, Single or field group) or an extendable core
 * table, by the app or any plugin; and to another owner's table by the app, or
 * by a plugin that names that owner in `dependsOn` (`assertMayAddColumns`).
 *
 * A column on a table the caller does not own is hidden: it is on the table
 * and in its runtime definition, and stripped wherever rows become entries,
 * so the entry API never returns it. It must also be addable to a table that
 * already has rows (`assertForeignColumnAllowed`). A field that should appear
 * in REST, the admin, validation and access control is declared through
 * `contributes.extend` instead.
 */
function addColumns(
  table: DraftTable,
  columns: Record<string, ColumnBuilder> | undefined,
  scope: ExtendScope
): void {
  if (!columns || Object.keys(columns).length === 0) return;

  // Same foreign-contribution rule as indexes: the app anywhere, a plugin on
  // a declared dependency's tables. The column is hidden either way, so the
  // entry API never sees it, and per-element rows name the contributor.
  const pluginOnDependencyTable =
    scope.owner.kind === "plugin" &&
    table.owner.kind === "plugin" &&
    (scope.mayIndexForeignTablesOf?.has(table.owner.id) ?? false);
  assertMayAddColumns(
    targetOf(table, scope),
    table.name,
    scope.owner,
    pluginOnDependencyTable
  );

  // Reuse the DSL so an extension column is validated exactly as a declared
  // one: the snake-casing and the per-column rules are the same question, and
  // asking it twice is how the two answers drift.
  const resolved = defineTable(table.name, columns);
  const onSomeoneElsesTable = !scope.isOwn;

  for (const column of resolved.columns) {
    if (table.columns.some(existing => existing.name === column.name)) {
      refuse(
        `${scope.ownerPath}.extendTable.${table.name}`,
        `Column "${column.name}" is already declared on "${table.name}".`
      );
    }
    // The one-key rule `defineTable` applies, applied to the table as it
    // stands: `defineTable` above only sees the columns being added, so a
    // `col.serial()` (itself the key) added beside an existing `col.id()`
    // passed it and reached the renderers as two primary keys.
    const existingKey = table.columns.find(
      existing => existing.primaryKey === true
    );
    if (column.primaryKey === true && existingKey !== undefined) {
      refuse(
        `${scope.ownerPath}.extendTable.${table.name}`,
        `Column "${column.name}" is a primary key, and "${table.name}" already has one ("${existingKey.name}"). A table has one primary key; col.serial() is itself the key, so it cannot be added beside another.`
      );
    }
    // Only on a table that already exists with rows in it. A table this
    // caller is declaring right now is empty by construction, so requiring a
    // default there would be a rule with no failure to prevent.
    if (onSomeoneElsesTable) {
      assertForeignColumnAllowed(column, table.name, scope);
    }
    // Who contributed it, on EVERY table the caller does not own — an entity
    // or an extendable core table as much as another owner's. Which stream
    // carries the element is decided from the TABLE (an extension table's
    // elements are recorded per element; an entity's or core table's ride
    // the app stream through `withEntityContributions`), never from this
    // field, which says only whose the column is.
    table.columns.push({
      ...column,
      hidden: onSomeoneElsesTable,
      ...(onSomeoneElsesTable ? { contributedBy: scope.owner } : {}),
    });
  }
}

/**
 * Add indexes, which an owner may do to its own tables, and anyone to entity
 * tables and the extendable core tables.
 *
 * Entity and extendable core tables are included because an index on one is
 * carried by APP migrations whoever contributed it, exactly as a
 * plugin-contributed collection already is — so there is no owner whose
 * migration stream would be missing it.
 *
 * The APP may additionally index a PLUGIN's table: the app's migration stream
 * carries the element, recorded per element in the owner registry, so a
 * plugin's own reconcile never sees it as drift. A plugin indexing another
 * plugin's table stays refused here — that needs `dependsOn`, which the
 * resolver (not the draft) knows about.
 */
function addIndexes(
  table: DraftTable,
  indexes: readonly { columns: string[]; unique?: boolean; name?: string }[],
  scope: ExtendScope
): void {
  const appOnPluginTable =
    scope.owner.kind === "app" && table.owner.kind === "plugin";
  // A plugin may index a DEPENDENCY's table: dependsOn (or
  // optionalDependsOn) is what makes the extension deliberate — the resolver
  // orders the two plugins and refuses an incompatible version — and the
  // element travels in the contributor's own migration stream.
  const pluginOnDependencyTable =
    scope.owner.kind === "plugin" &&
    table.owner.kind === "plugin" &&
    (scope.mayIndexForeignTablesOf?.has(table.owner.id) ?? false);
  const contributedForeign = appOnPluginTable || pluginOnDependencyTable;
  // An EXTENDABLE core table takes indexes as it takes columns: the app's
  // migration stream carries both as elements of the core table, whoever
  // contributed them (`compileAppStreamTables`). Any other core table stays
  // refused, for the reason its columns are.
  const extendableCore =
    table.owner.kind === "core" && EXTENDABLE_CORE_TABLES.has(table.name);
  for (const index of indexes) {
    if (
      !scope.isOwn &&
      !scope.isEntity &&
      !extendableCore &&
      !contributedForeign
    ) {
      refuse(
        `${scope.ownerPath}.extendTable.${table.name}`,
        `${describeOwner(scope.owner)} may not index "${table.name}", which belongs to ${describeOwner(table.owner)}. Name the owner in dependsOn (or optionalDependsOn) to extend its tables.`
      );
    }
    const resolved: ExtensionIndex = {
      // Snake-cased as `defineTable` resolves an index's columns, so a hook
      // may name a column by its key or its SQL name alike. Passed through
      // raw, `publishedAt` named no column of the table and the index was
      // dropped from the desired spec without a word.
      columns: index.columns.map(toSnakeCase),
      unique: index.unique === true,
      ...(index.name !== undefined ? { name: index.name } : {}),
      // Who CONTRIBUTED the element — distinct from who owns the table, and
      // what the per-element owner rows are written from. Recorded wherever
      // the caller is not the owner, as a column's is.
      ...(!scope.isOwn ? { contributedBy: scope.owner } : {}),
    };
    assertSeededIndexBuildable(resolved, table);
    table.indexes.push(resolved);
  }
}

/**
 * Refuse an index a table cannot carry, by the rules an owner's own table is
 * judged by.
 *
 * A table this layer DECLARES is judged whole. One it SEEDS — an entity or a
 * core table — is judged over the columns whose kinds the seed knows: an
 * index naming a column the table does not have is refused, and so is one
 * over a column no dialect can index (a JSON field on MySQL), which the
 * desired spec would otherwise propose on every push and the server refuse.
 * A column known by name only is not judged on a stand-in kind, and the key
 * width is not summed over a partial set. A seed carrying no columns at all
 * supplied none, and only the kind rules apply to what it does know.
 */
function assertSeededIndexBuildable(
  index: ExtensionIndex,
  table: DraftTable
): void {
  const seeded = table.owner.kind === "entity" || table.owner.kind === "core";
  if (!seeded) {
    assertIndexBuildable(index, table.columns, table.name);
    return;
  }
  if (table.columns.length > 0) {
    const missing = index.columns.find(
      column => !table.columns.some(existing => existing.name === column)
    );
    if (missing !== undefined) {
      refuse(
        `${table.name}.indexes[${index.columns.join(",")}]`,
        `Index names the column "${missing}", which "${table.name}" does not have.`
      );
    }
  }
  const opaque = table.opaqueColumns ?? new Set<string>();
  assertIndexBuildable(
    index,
    table.columns.filter(column => !opaque.has(column.name)),
    table.name,
    false
  );
}

/**
 * A view of the store scoped to one owner.
 *
 * Every refusal names both the caller and the real owner, because the useful
 * question when this fires is not "what went wrong" but "whose table is this".
 */
export function createOwnerDraft(
  store: SchemaDraftStore,
  owner: SchemaOwner
): SchemaDraft {
  const ownerPath =
    owner.kind === "plugin" ? `plugin.${owner.id}.schema` : "app.db.schema";

  function resolveOwnName(declared: string): string {
    if (owner.kind === "app") {
      assertUsableAppTableName(declared, store.coreTableNames, [
        ...store.pluginPrefixes.values(),
      ]);
      return declared;
    }
    const prefix = store.pluginPrefixes.get(owner.id);
    if (prefix === undefined) {
      refuse(ownerPath, `No schema prefix is registered for "${owner.id}".`);
    }
    // A name that already carries the prefix is a mistake rather than something
    // to prefix twice: `auth__auth__identities` is nobody's intent.
    if (declared.startsWith(`${prefix}${PREFIX_SEPARATOR}`)) {
      refuse(
        `${ownerPath}.${declared}`,
        `Table "${declared}" already carries the prefix "${prefix}"; declare it as "${declared.slice(prefix.length + PREFIX_SEPARATOR.length)}".`
      );
    }
    return pluginTableName(prefix, declared);
  }

  return {
    dialect: store.dialect,

    adoptTable(def: TableDefinition): void {
      // The name is used AS WRITTEN: an adopted table exists already, so
      // there is nothing to prefix or validate beyond the collision checks
      // the store itself makes.
      store.adopt(def, owner);
    },

    addTable(def: TableDefinition): void {
      const name = resolveOwnName(def.name);
      const existing = store.get(name);
      if (existing) {
        refuse(
          `${ownerPath}.${def.name}`,
          `Table "${name}" is already declared by ${describeOwner(existing.owner)}; ${describeOwner(owner)} cannot declare it again.`
        );
      }

      const columns: ExtensionColumn[] = def.columns.map(column => ({
        ...column,
        key: column.key,
        name: column.name,
      }));
      const indexes = [...def.indexes];
      for (const index of indexes) {
        assertIndexBuildable(index, columns, name);
      }

      store.set({
        name,
        authored: def.name,
        owner,
        columns,
        indexes,
        ...(def.foreignKeys.length > 0
          ? { foreignKeys: [...def.foreignKeys] }
          : {}),
        ...(def.checks.length > 0 ? { checks: [...def.checks] } : {}),
        ...(def.relations.length > 0 ? { relations: [...def.relations] } : {}),
      });
    },

    extendTable(name, ext): void {
      const table = store.get(name);
      if (!table) {
        refuse(
          `${ownerPath}.extendTable`,
          `Table "${name}" does not exist, so it cannot be extended. ` +
            `Schema hooks see core tables, plugin and app tables, and the collections, Singles and field groups declared in code; ` +
            `an entity created in the admin's Schema Builder is not known when hooks run.`
        );
      }
      const scope = {
        owner,
        ownerPath,
        isOwn: sameOwner(table.owner, owner),
        isEntity: table.owner.kind === "entity",
        mayIndexForeignTablesOf:
          owner.kind === "plugin"
            ? store.dependencies?.get(owner.id)
            : undefined,
      };
      addColumns(table, ext.columns, scope);
      addIndexes(table, ext.indexes ?? [], scope);
    },

    getTable(name): DraftTableView | undefined {
      const table = store.get(name);
      return table ? toView(table) : undefined;
    },

    tables(): readonly DraftTableView[] {
      return Object.freeze(store.all().map(toView));
    },
  };
}
