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
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { DeclaredCheck, DeclaredForeignKey } from "./types";

import type { ColumnBuilder, TableDefinition } from "./dsl";
import { defineTable } from "./dsl";
import {
  assertAddableToExistingRows,
  assertMayAddColumns,
  type ExtensionTarget,
} from "./extension-columns";
import {
  assertIndexBuildable,
  assertUsableAppTableName,
  pluginTableName,
  PREFIX_SEPARATOR,
} from "./naming";
import type { ExtensionColumn, ExtensionIndex, SchemaOwner } from "./types";

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
}

export interface SchemaDraft {
  readonly dialect: SupportedDialect;
  /** Adds a table owned by the caller. For a plugin the prefix is applied. */
  addTable(def: TableDefinition): void;
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
  columns: { name: string; kind: string; nullable: boolean }[];
}

export interface SchemaDraftStoreInput {
  dialect: SupportedDialect;
  coreTableNames: readonly string[];
  entities: readonly SeedEntityTable[];
  /** Prefix per plugin id, so a plugin's own tables can be named and found. */
  pluginPrefixes: ReadonlyMap<string, string>;
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
    for (const name of input.coreTableNames) {
      this.tables.set(name, {
        name,
        authored: name,
        owner: { kind: "core" },
        columns: [],
        indexes: [],
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
        columns: entity.columns.map(column => ({
          key: column.name,
          name: column.name,
          kind: column.kind as ExtensionColumn["kind"],
          nullable: column.nullable,
        })),
        indexes: [],
      });
    }
  }

  /** The extension tables only — what the compiler downstream consumes. */
  extensionTables(): DraftTable[] {
    return [...this.tables.values()].filter(
      table => table.owner.kind === "plugin" || table.owner.kind === "app"
    );
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
}

/**
 * Add columns, which only an owner may do to its own table.
 *
 * An entity table is refused even to the app, because entity reads select the
 * whole table: a raw column would either leak into API responses or be proposed
 * as a DROP by dev push. `contributes.extend` is the supported path and gives
 * the column REST, admin, validation and access control as well.
 */
function addColumns(
  table: DraftTable,
  columns: Record<string, ColumnBuilder> | undefined,
  scope: ExtendScope
): void {
  if (!columns || Object.keys(columns).length === 0) return;

  assertMayAddColumns(targetOf(table, scope), table.name, scope.owner);

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
    // Only on a table that already exists with rows in it. A table this
    // caller is declaring right now is empty by construction, so requiring a
    // default there would be a rule with no failure to prevent.
    if (onSomeoneElsesTable) {
      assertAddableToExistingRows(column, table.name);
    }
    table.columns.push({ ...column, hidden: onSomeoneElsesTable });
  }
}

/**
 * Add indexes, which an owner may do to its own tables and to entity tables.
 *
 * Entity tables are included because an index on one is carried by APP
 * migrations whoever contributed it, exactly as a plugin-contributed collection
 * already is — so there is no owner whose migration stream would be missing it.
 */
function addIndexes(
  table: DraftTable,
  indexes: readonly { columns: string[]; unique?: boolean; name?: string }[],
  scope: ExtendScope
): void {
  for (const index of indexes) {
    if (!scope.isOwn && !scope.isEntity) {
      refuse(
        `${scope.ownerPath}.extendTable.${table.name}`,
        `${describeOwner(scope.owner)} may not index "${table.name}", which belongs to ${describeOwner(table.owner)}.`
      );
    }
    const resolved: ExtensionIndex = {
      columns: index.columns,
      unique: index.unique === true,
      ...(index.name !== undefined ? { name: index.name } : {}),
    };
    // A table this layer SEEDS rather than declares carries no authoritative
    // column set: `publish.ts` seeds an entity with none at all, because the
    // field pipeline is what knows them. Saying so here keeps the full check
    // for tables that do declare their columns.
    const columnsAreKnown =
      table.owner.kind !== "entity" && table.owner.kind !== "core";
    assertIndexBuildable(resolved, table.columns, table.name, columnsAreKnown);
    table.indexes.push(resolved);
  }
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
        ...(def.foreignKeys.length > 0 ? { foreignKeys: [...def.foreignKeys] } : {}),
        ...(def.checks.length > 0 ? { checks: [...def.checks] } : {}),
      });
    },

    extendTable(name, ext): void {
      const table = store.get(name);
      if (!table) {
        refuse(
          `${ownerPath}.extendTable`,
          `Table "${name}" does not exist, so it cannot be extended.`
        );
      }
      const scope = {
        owner,
        ownerPath,
        isOwn: sameOwner(table.owner, owner),
        isEntity: table.owner.kind === "entity",
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
