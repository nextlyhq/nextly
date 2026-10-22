/**
 * `ctx.db` — typed, portable, owner-checked access to a plugin's own tables.
 *
 * Three properties, each earned:
 *
 * **Typed** without codegen, from the DSL's phantom types. A plugin reads a
 * row and gets the shape it declared, so a renamed column is a compile error
 * rather than an undefined at runtime.
 *
 * **Portable by construction.** The surface is narrowed to what behaves the
 * same on all three dialects. A first attempt typed these tables as Postgres,
 * which made `.returning()` and `onConflictDoNothing` type-check and then fail
 * on MySQL — a shape that compiles and cannot run is worse than one that does
 * not compile. `insertReturning` is the portable replacement for RETURNING.
 *
 * **Owner-checked in every method**, which is what makes it a boundary rather
 * than a convention. See `access.ts` for why the check is not hoisted.
 *
 * @module plugins/database/plugin-database
 * @since 1.0.0
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import type { AnyColumn, AnyRelations, SQL, Table } from "drizzle-orm";
import { eq, getColumns, inArray } from "drizzle-orm";

import { isMissingNamedColumnError } from "../../database/missing-column";
import type { SupportedDialect } from "../../database/schema-registry";
import { toDrizzleTable } from "../../domains/schema/extension/compile";
import type {
  ColumnBuilder,
  GeneratedIdKeys,
  InferInsert,
  InferRow,
  TableDefinition,
} from "../../domains/schema/extension/dsl";
import type { SchemaOwner } from "../../domains/schema/extension/types";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import { uuidV7 } from "../../utils/uuid-v7";
import { transactionScope } from "../transaction-scope";

import {
  assertContributedColumnAccess,
  assertTableAccess,
  canAccessTable,
  type ContributedColumn,
  type TableAccessRules,
} from "./access";
import { runInPluginTransactionFlow } from "./plugin-transaction-in-flow";
import { linkPluginTransaction } from "./plugin-transaction-link";

/** What a caller may narrow a read or a write with. */
export interface PortableWhere<TResult> {
  where(condition: SQL): Promise<TResult>;
}

export interface PortableSelect<TDefinition> {
  where(condition: SQL): PortableSelect<TDefinition>;
  orderBy(...columns: SQL[]): PortableSelect<TDefinition>;
  limit(count: number): PortableSelect<TDefinition>;
  offset(count: number): PortableSelect<TDefinition>;
  all(): Promise<InferRow<TDefinition>[]>;
  first(): Promise<InferRow<TDefinition> | null>;
}

export interface PluginDatabaseDeps {
  dialect: SupportedDialect;
  owner: SchemaOwner;
  dependsOn: ReadonlySet<string>;
  /** Table name → owner, from the compiled schema. Read per call, not captured. */
  owners: () => ReadonlyMap<string, SchemaOwner>;
  /** SQL name → Drizzle table, from the compiled schema. */
  tables: () => Record<string, unknown>;
  /** The compiled tables, for resolving an authored name to its SQL one. */
  tableList: () => readonly {
    name: string;
    authored: string;
    owner: SchemaOwner;
  }[];
  /** The Drizzle handle. */
  db: () => unknown;
  /**
   * The relations-enabled Drizzle handle (`db.query` lives here). The plain
   * `db` above is constructed without a relations config, whose query
   * namespace is empty — this one is built per call with the registry's
   * current relations, exactly as core services build theirs.
   */
  relationalDb: () => unknown;
  /**
   * The adapter's transaction, which serialises correctly on SQLite.
   *
   * The callback receives BOTH handles bound to the transaction's connection:
   * `db` for the builder methods and `relationalDb` for `query`. The pooled
   * handles above run on a different connection on PostgreSQL and MySQL, so
   * either one used inside the callback would read and write outside the
   * transaction.
   */
  transaction: <R>(
    fn: (tx: {
      db: unknown;
      relationalDb: unknown;
      /**
       * The adapter transaction both handles run on, when the supplier has
       * one: registered with the surface the callback receives, so core code
       * a plugin hands that surface as `{ tx }` writes inside it
       * (`plugin-transaction-link`).
       */
      adapterTx?: TransactionContext;
    }) => Promise<R>
  ) => Promise<R>;
  /**
   * Called with every statement's promise as it starts, and returns the
   * promise the caller receives. Absent outside a transaction; inside one it
   * is the transaction's record of the work still running on its connection
   * (see `transactionScope`).
   */
  track?: <R>(work: PromiseLike<R>, kind?: "write" | "read") => Promise<R>;
  /**
   * Columns contributed to tables `ctx.db` has no owner for — entity and
   * extendable core tables — keyed by table SQL name, with who contributed
   * each. Read per call. Absent, nothing is reachable through `contributed`:
   * a surface that cannot say who contributed a column refuses rather than
   * guesses.
   */
  contributions?: () => ReadonlyMap<string, readonly ContributedColumn[]>;
  /** The runtime Drizzle table of an entity or core table, by SQL name. */
  entityTable?: (tableName: string) => unknown;
}

/**
 * The SQL name a definition refers to, for this caller.
 *
 * Read from the compiled schema's recorded AUTHORED name rather than by
 * splitting the SQL name on the prefix separator. The split was a proxy for
 * the naming rules, and would have disagreed with them for any table whose
 * authored name contained the separator.
 *
 * A definition is plain data and records no owner, so the authored name alone
 * has to pick the table. It does so in this order:
 *
 * 1. The caller's OWN table. A plugin naming a table `notes` means its own
 *    `notes`, whatever a dependency also calls its table.
 * 2. Otherwise, a table the caller may REACH — the same rule the access check
 *    applies. A table the caller cannot reach is never a candidate: choosing
 *    it would only turn a valid dependency read into a refusal because some
 *    unrelated plugin happens to use the same name.
 * 3. Two reachable tables sharing the name are refused, not guessed between.
 *    Picking one would let `select` and `insert` quietly run against the
 *    wrong plugin's rows, and nothing downstream could notice.
 *
 * The way out of that refusal is the SQL name: a definition named after the
 * compiled table (`defineTable("other__notes", ...)`). An exact SQL-name match
 * the caller can reach therefore wins over every authored-name match — an
 * authored name may itself contain the separator, so another plugin's table
 * AUTHORED `other__notes` (compiled `h__other__notes`) must not capture it.
 * If that exact match and the caller's own authored match are different
 * tables, the name means two things and is refused as well.
 */
function sqlNameOf(
  definition: TableDefinition,
  deps: PluginDatabaseDeps
): string {
  const rules = rulesOf(deps);
  const candidates = deps
    .tableList()
    .filter(table => table.authored === definition.name);
  const own = candidates.find(table => isSameOwner(table.owner, deps.owner));
  const exact = reachableBySqlName(definition.name, deps, rules);
  if (own && exact && own.name !== exact.name) {
    throw ambiguousTable(definition.name, [own, exact]);
  }
  if (own) return own.name;
  if (exact) return exact.name;

  const reachable = candidates.filter(table =>
    canAccessTable(table.name, rules)
  );
  if (reachable.length > 1) throw ambiguousTable(definition.name, reachable);
  return (
    reachable[0]?.name ?? unreachableName(definition.name, candidates, rules)
  );
}

/** The table whose compiled SQL name is exactly `name`, if the caller may reach it. */
function reachableBySqlName(
  name: string,
  deps: PluginDatabaseDeps,
  rules: ReturnType<typeof rulesOf>
): { name: string; owner: SchemaOwner } | undefined {
  return deps
    .tableList()
    .find(table => table.name === name && canAccessTable(table.name, rules));
}

/**
 * The name to hand the access check when nothing reachable matched.
 *
 * A definition already carrying a compiled SQL name is taken as written, for
 * the access check to judge. Otherwise an unreachable candidate is returned so
 * the check refuses with the real reason — "not a declared dependency" —
 * rather than "not declared" for a table that exists.
 */
function unreachableName(
  name: string,
  candidates: readonly { name: string }[],
  rules: ReturnType<typeof rulesOf>
): string {
  if (rules.owners.has(name)) return name;
  return candidates[0]?.name ?? name;
}

/**
 * The refusal for `transaction` called on the handle a transaction passes its
 * work. Named in `logContext.reason` so a caller can tell it from a failure
 * of the work itself.
 */
function nestedTransactionError(): NextlyError {
  return NextlyError.invalidInput({
    message:
      "ctx.db.transaction cannot be nested: the handle a transaction passes its work has no transaction of its own. " +
      "Do the nested work in the same callback, through the handle it was given, so it commits or rolls back with the rest.",
    logContext: { reason: "nested-plugin-transaction" },
  });
}

/**
 * The deps' statement tracker, or, outside a transaction, a plain subscription.
 *
 * Both hand back a native promise that has already started its statement.
 * Drizzle's relational query is a lazy thenable that runs on every await, and
 * it carries the session and schema it was built from; handing it back as it
 * is outside a transaction would make `ctx.db.query.x.findMany()` run once per
 * await there and exactly once inside one, and would expose a handle able to
 * assemble queries past the owner check. Every other terminal call is an
 * async function, so for it this changes nothing. A read is marked as one,
 * so a rollback to a savepoint, which cannot undo it, does not count it.
 */
function trackerOf(
  deps: PluginDatabaseDeps
): <R>(work: PromiseLike<R>, kind?: "write" | "read") => Promise<R> {
  return deps.track ?? (work => Promise.resolve(work));
}

/**
 * The refusal for an authored name two reachable plugins both use.
 *
 * Names every colliding table and its owner, because the fix is the author's
 * to make and they cannot make it without knowing which SQL name to use.
 */
function ambiguousTable(
  authored: string,
  reachable: readonly { name: string; owner: SchemaOwner }[]
): NextlyError {
  const listed = reachable
    .map(table => `"${table.name}" (${describeOwner(table.owner)})`)
    .join(", ");
  return NextlyError.invalidInput({
    message:
      `The table "${authored}" is ambiguous: more than one table this plugin may reach uses that name — ${listed}. ` +
      `Refer to the one you mean by its SQL name instead, for example defineTable("${reachable[0].name}", ...), ` +
      `so a read or write cannot land on the wrong plugin's table.`,
    logContext: {
      reason: "ambiguous-authored-table-name",
      table: authored,
      candidates: reachable.map(table => table.name),
    },
  });
}

function describeOwner(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? `plugin "${owner.id}"` : "the app";
}

function isSameOwner(a: SchemaOwner, b: SchemaOwner): boolean {
  if (a.kind === "plugin" && b.kind === "plugin") return a.id === b.id;
  return a.kind === "app" && b.kind === "app";
}

/**
 * The rules as they stand NOW. `deps.owners()` is called on every use rather
 * than captured, so a handle built before a schema reload is judged against
 * the ownership map after it.
 */
function rulesOf(deps: PluginDatabaseDeps): TableAccessRules {
  return {
    owner: deps.owner,
    dependsOn: deps.dependsOn,
    owners: deps.owners(),
  };
}

/**
 * The Drizzle table for a definition, after the access check.
 *
 * Both halves matter and neither is optional: resolving without checking hands
 * a plugin somebody else's table, and checking without resolving checks a name
 * that is not the one the query will use.
 *
 * A method that hands back a builder calls this twice: once when the builder
 * is made, so a bad call fails where it was written, and again in the method
 * that runs the statement, which executes against what that second call
 * returned. Only the second is the boundary. A plugin can keep a builder
 * across a schema reload that drops the table or hands it to another owner,
 * and a check made when the builder was built would still be vouching for the
 * schema that has since been replaced.
 */
function resolveTable(
  definition: TableDefinition,
  deps: PluginDatabaseDeps
): { name: string; table: unknown } {
  assertTableDefinition(definition);
  const name = sqlNameOf(definition, deps);
  assertTableAccess(name, rulesOf(deps));

  const table = deps.tables()[name];
  if (table === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "declared table has no compiled handle",
        table: name,
      },
    });
  }
  return { name, table };
}

/**
 * Refuse a call written against the surface `ctx.db` USED to be, by name.
 *
 * `ctx.db` was the Drizzle instance itself, so a plugin wrote
 * `ctx.db.select().from(table)`. It is now the owner-checked surface, whose
 * `select` takes the table DEFINITION — the same four verbs, different
 * arguments. A plugin written against the old shape therefore reached
 * `sqlNameOf(undefined)` and died on a missing property, which says nothing
 * about what changed or where the old handle went.
 *
 * The old handle is still there, at `ctx.db.raw`, and this says so. Both
 * shapes cannot live on one object — the four names collide — so the decision
 * is a break, and the least a break can do is explain itself at the call site
 * that hit it.
 */
function assertTableDefinition(definition: TableDefinition): void {
  if (
    definition !== null &&
    typeof definition === "object" &&
    typeof definition.name === "string" &&
    Array.isArray(definition.columns)
  ) {
    return;
  }
  throw NextlyError.validation({
    errors: [
      {
        path: "ctx.db",
        code: "INVALID",
        message:
          "ctx.db now takes the table DEFINITION rather than being the Drizzle instance: " +
          "`ctx.db.select(myTable)` where you wrote `ctx.db.select().from(...)`. " +
          "The unchanged Drizzle handle is still available as `ctx.db.raw`, so " +
          "`ctx.db.raw.select().from(...)` keeps existing code working unchanged.",
      },
    ],
  });
}

/**
 * Fill the columns the DSL says are maintained for the caller.
 *
 * A `uuidv7` id is generated when absent, and `created_at`/`updated_at` take
 * the current moment. Done here rather than as a database default because a
 * generated id has to be KNOWN to the caller — `insertReturning` on MySQL has
 * no RETURNING to read it back with, and selecting "the last row" is a race.
 */
function withGeneratedColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...values };
  for (const column of definition.columns) {
    if (column.generated === "uuidv7" && out[column.key] === undefined) {
      out[column.key] = uuidV7();
    }
    if (
      typeof column.default === "object" &&
      column.default?.token === "now" &&
      out[column.key] === undefined
    ) {
      out[column.key] = new Date();
    }
  }
  return out;
}

/** The columns the DSL marks as refreshed on every update. */
function withUpdatedColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...values };
  for (const column of definition.columns) {
    if (column.onUpdate === "now") {
      out[column.key] = new Date();
    }
  }
  return out;
}

/** Map an authored row onto the SQL column names the table uses. */
function toColumns(
  definition: TableDefinition,
  values: Record<string, unknown>
): Record<string, unknown> {
  // Onto the TABLE OBJECT's property names, which are the authored keys.
  //
  // Drizzle resolves `.values()` and `.set()` against the record it was built
  // from, and `toDrizzleTable` keys that record by the authored key — so
  // mapping to the SQL name here handed Drizzle properties it does not know.
  // The SQL name still reaches the database: it is on the column the builder
  // made, which is where Drizzle reads it from.
  const out: Record<string, unknown> = {};
  for (const column of definition.columns) {
    if (values[column.key] === undefined) continue;
    // A database-assigned key is never written, however it was supplied.
    //
    // `col.serial()` is documented as assigned by the database, and
    // `InferInsert` types its key `?: never`, so a typed caller cannot set it.
    // This is the same rule for the callers the type does not reach: plain
    // JavaScript, a cast, a spread of untyped input. An `undefined` value was
    // skipped above, so only a value actually supplied is refused.
    // Forwarding that value leaves PostgreSQL's sequence behind the row —
    // later generated inserts then collide with keys already taken — and the
    // three dialects disagree about what an explicit auto-increment value
    // even means. Refused rather than dropped: silently ignoring a value the
    // caller passed is how a plugin ends up believing it chose the key.
    if (column.kind === "serial") {
      throw NextlyError.validation({
        errors: [
          {
            path: `${definition.name}.${column.key}`,
            code: "INVALID",
            message: `"${column.key}" is a col.serial() key, which the database assigns — it cannot be written. Omit it and read the row back with the value the database chose.`,
          },
        ],
      });
    }
    out[column.key] = values[column.key];
  }
  return out;
}

/**
 * The Drizzle columns of a declared table, keyed as the author wrote them.
 *
 * `table()` returned `unknown`, which made the one thing it exists for —
 * naming a column in a `where` predicate — impossible without a cast. Every
 * other entry point on this surface is typed from the definition; this one
 * promised access to a column and handed back a value nothing could be read
 * from.
 *
 * `AnyColumn` rather than the precise per-column type: what a predicate needs
 * is something `eq`, `gt` and friends accept, and the phantom column map
 * carries builders rather than built columns.
 */
export type TableColumns<T> =
  T extends TableDefinition<string, infer TColumns>
    ? Record<keyof TColumns & string, AnyColumn>
    : Record<string, AnyColumn>;

/**
 * @experimental What `ctx.db.insert` and `insertReturning` take: the table's
 * `InferInsert`, with its `col.id()` key optional, because `ctx.db` fills a
 * UUIDv7 when the caller leaves it out.
 */
export type PluginInsert<T> =
  T extends TableDefinition<string, infer TColumns>
    ? Omit<InferInsert<T>, GeneratedIdKeys<TColumns>> &
        Partial<
          Pick<InferInsert<T>, GeneratedIdKeys<TColumns> & keyof InferInsert<T>>
        >
    : never;

/**
 * @experimental `ctx.db`: typed, owner-checked access to the tables a plugin
 * declared, its dependencies' tables and the columns it contributed, with one
 * behaviour on every dialect. Every method checks the caller's reach before it
 * builds a query. The untyped Drizzle builder is at `ctx.db.raw`.
 */
export interface PluginDatabase {
  table<T extends TableDefinition>(definition: T): TableColumns<T>;
  select<T extends TableDefinition>(definition: T): PortableSelect<T>;
  insert<T extends TableDefinition>(
    definition: T,
    values: PluginInsert<T> | PluginInsert<T>[]
  ): Promise<void>;
  insertReturning<T extends TableDefinition>(
    definition: T,
    values: PluginInsert<T>
  ): Promise<InferRow<T>>;
  update<T extends TableDefinition>(
    definition: T,
    set: Partial<InferInsert<T>>
  ): PortableWhere<number>;
  delete<T extends TableDefinition>(definition: T): PortableWhere<number>;
  /**
   * The columns this caller contributed to a table it does not own
   * (`schema.extendTable(table, { columns })`) — a collection, Single,
   * field-group or extendable core table, a plugin's table for the app, or a
   * dependency's table — addressed by the table's SQL name. Pass the same
   * `columns` object the contribution declared; its keys are the columns read
   * and written, and each must be one this caller contributed to that table.
   */
  contributed<TColumns extends Record<string, ColumnBuilder>>(
    tableName: string,
    columns: TColumns
  ): ContributedColumns<TColumns>;
  /**
   * Run `fn` in one transaction: it commits when `fn` resolves and rolls back
   * when it throws, and what `fn` threw reaches the caller as thrown. `tx` is
   * this surface bound to the transaction's own connection on every dialect;
   * write through it, since `ctx.db` itself runs outside the transaction on
   * PostgreSQL and MySQL. On SQLite a core service or `ctx.settings` called
   * inside joins it as a savepoint and rolls back with it, its after-commit
   * effects (hooks, events, revalidation) wait for the commit and never run
   * on rollback, and deleting media is refused. Keep it short, and never
   * await network I/O inside it. `tx` lives only as long as `fn`: a statement
   * `fn` started on it without awaiting is finished before the transaction
   * ends, and once it has ended, `tx` and every builder made from it refuse.
   * A statement still running on `tx` when `fn` settles (one `fn` did not
   * await) is waited for, and if it fails the transaction rolls back and
   * rejects with that failure, even though `fn` resolved. A statement that
   * failed before `fn` settled is `fn`'s to handle: caught, the transaction
   * carries on. When `fn` itself throws, its error is the one the caller
   * receives.
   */
  transaction<R>(fn: (tx: PluginTransaction) => Promise<R>): Promise<R>;
  /**
   * Relational queries (`db.query.<table>.findMany({ with })`), keyed by
   * FINAL table name and owner-checked like every other method. The
   * relations config is resolved per access through the same path core
   * services use, so a registry invalidation (a Builder save, an extension
   * reload) propagates immediately rather than stranding a plugin on edges
   * that close over dropped table objects.
   */
  readonly query: RelationalQueries;
}

/** One table's relational-query entry point. */
export interface RelationalQuery {
  findMany: (config?: unknown) => Promise<unknown[]>;
  findFirst: (config?: unknown) => Promise<unknown>;
}

/** The relational-query namespace, keyed by final table name. */
export type RelationalQueries = Record<string, RelationalQuery>;

/**
 * A row's key on a table reached through `contributed`: the value of the
 * table's single-column primary key, whatever that column is called. A
 * collection, Single, field-group or core table keys rows by a string id; a
 * plugin's table may key them by a `col.serial()` number.
 */
export type ContributedKey = string | number;

/**
 * A row of contributed columns: the row's key, as `id` whatever the key column
 * is named, plus the caller's columns.
 */
export type ContributedRow<TColumns extends Record<string, ColumnBuilder>> = {
  id: ContributedKey;
} & InferRow<TableDefinition<string, TColumns>>;

/**
 * The columns a caller contributed to one entity or core table, keyed by the
 * row's id. Reads and writes those columns only: the entity's own columns and
 * rows belong to the entry API, so there is no insert, no delete and no
 * free-form predicate here.
 */
export interface ContributedColumns<
  TColumns extends Record<string, ColumnBuilder>,
> {
  /** The caller's columns for one row, or `null` when no row has that id. */
  get(id: ContributedKey): Promise<ContributedRow<TColumns> | null>;
  /** The caller's columns for each row that exists among `ids`. */
  getMany(ids: readonly ContributedKey[]): Promise<ContributedRow<TColumns>[]>;
  /** Write some of the caller's columns on one row; resolves to rows changed. */
  set(
    id: ContributedKey,
    values: Partial<InferInsert<TableDefinition<string, TColumns>>>
  ): Promise<number>;
}

/**
 * @experimental The handle `ctx.db.transaction` passes its work: the same
 * surface as `ctx.db`, bound to the transaction's connection, without a
 * nested `transaction`.
 */
export type PluginTransaction = Omit<PluginDatabase, "transaction">;

/** One table's entry in a relations config: its edges, keyed by relation name. */
type TableRelations = AnyRelations[string];
type RelationEdge = TableRelations["relations"][string];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The relations config and one table's entry in it, or a refusal.
 *
 * Needed whenever a query names something that might be a relation, because
 * only the config can say which table a relation reaches. A handle whose
 * config is missing cannot be judged, so it is refused rather than let
 * through: this is the check, and a check that passes whatever it cannot read
 * is not one.
 */
function tableRelationsOf(
  relations: AnyRelations | undefined,
  tableKey: string
): { all: AnyRelations; table: TableRelations } {
  const table = relations?.[tableKey];
  if (relations === undefined || table === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "relational query has no relations config for its table",
        table: tableKey,
      },
    });
  }
  return { all: relations, table };
}

/**
 * Refuse a relation whose rows this caller may not reach.
 *
 * Judged by the TARGET's namespace key — the same key, and the same
 * `assertTableAccess`, the root of `ctx.db.query` is judged by — so a table a
 * plugin cannot open directly cannot be joined in either. A many-to-many edge
 * also reads its junction table, which is judged the same way. The junction is
 * recorded as a table object, so its key is looked up in the config; Drizzle
 * requires a junction to be part of the schema, and one the config does not
 * name cannot be judged, so it is refused.
 *
 * The refusal is the root's refusal — the same reason, core and collection
 * tables included, for a plugin and for the app alike — carrying the edge
 * that led to the table: which relation, on which table, followed from
 * `with` or from a `where` filter. A core or collection table is refused
 * here exactly as `ctx.db.query.users` is at the root; its rows are read
 * through `ctx.services`, and following an edge to it is not a second door.
 */
function assertRelationAccess(
  relation: RelationEdge,
  from: string,
  followedIn: "with" | "where",
  relations: AnyRelations,
  rules: TableAccessRules
): void {
  const via = {
    via: followedIn,
    relation: relation.fieldName,
    from,
    hint:
      `The relation "${relation.fieldName}" on "${from}" reaches "${relation.targetTableName}", ` +
      "which this caller may not reach: another plugin's table needs a dependsOn entry, " +
      "and a core or collection table is read through ctx.services.",
  };
  assertTableAccess(relation.targetTableName, rules, via);
  const through = relation.throughTable;
  if (through === undefined) return;
  const throughKey = Object.entries(relations).find(
    ([, config]) => config.table === through
  )?.[0];
  if (throughKey === undefined) {
    throw NextlyError.forbidden({
      logContext: {
        ...via,
        reason: "relation-junction-not-in-relations-config",
        table: relation.targetTableName,
      },
    });
  }
  assertTableAccess(throughKey, rules, via);
}

/**
 * The relation a query names, if the table declares one by that name.
 *
 * An OWN property only. The edges are a plain object, so a bare lookup
 * resolves `toString` or `constructor` through the prototype to a function
 * that is no relation at all, and the name would be judged as an edge with
 * no target.
 */
function ownRelation(
  table: TableRelations,
  name: string
): RelationEdge | undefined {
  return Object.hasOwn(table.relations, name)
    ? table.relations[name]
    : undefined;
}

/**
 * A relational-query config, checked and COPIED.
 *
 * The root check covers only the table the query starts from, and Drizzle
 * follows `with` and relation filters in `where` to other tables without
 * asking anyone. So every table the config reaches is judged here, before
 * the query is built, at any depth.
 *
 * Copied rather than checked in place: Drizzle reads the config when the query
 * EXECUTES, not when `findMany` is called, so a caller still holding the
 * object it passed could add a forbidden `with` between the check and the
 * run. Every container this walk reads — the config, its `with`, each filter
 * object — is rebuilt, and the copy is what Drizzle receives, so nothing the
 * caller holds can change what was judged. Leaves are kept by reference:
 * column selections, orderings and column filter values name columns of a
 * table already judged, and SQL (`RAW`, `extras`) is an escape this surface
 * accepts everywhere, `select().where(sql)` included.
 */
function checkedQueryConfig(
  config: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): unknown {
  // `undefined` and `true` select everything and reach no other table.
  if (!isRecord(config)) return config;
  const copy: Record<string, unknown> = { ...config };
  if (copy.with !== undefined && copy.with !== null) {
    copy.with = checkedWith(copy.with, tableKey, relations, rules);
  }
  if (copy.where !== undefined && copy.where !== null) {
    copy.where = checkedWhere(copy.where, tableKey, relations, rules);
  }
  return copy;
}

/** The `with` of a relational query: every included relation judged, then recursed into. */
function checkedWith(
  joins: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  // `Object.entries` over whatever arrived, exactly as Drizzle iterates it,
  // so no shape of `with` reaches Drizzle carrying a key this walk skipped.
  for (const [name, join] of Object.entries(joins as object)) {
    // Drizzle drops a falsy include without resolving it, so it reaches
    // nothing and needs no judgement.
    if (!join) {
      copy[name] = join;
      continue;
    }
    const { all, table } = tableRelationsOf(relations, tableKey);
    const relation = ownRelation(table, name);
    if (relation === undefined) {
      throw NextlyError.invalidInput({
        message: `"${name}" is not a relation of "${tableKey}", so it cannot be included with "with".`,
        logContext: {
          reason: "unknown-relation-in-with",
          table: tableKey,
          relation: name,
        },
      });
    }
    assertRelationAccess(relation, tableKey, "with", all, rules);
    copy[name] = checkedQueryConfig(join, relation.targetTableName, all, rules);
  }
  return copy;
}

/**
 * A relational `where`: every relation filter judged, then recursed into.
 *
 * A relation filter (`where: { author: { name: "x" } }`) compiles to an
 * EXISTS over the target table, so it reads rows the caller may not be
 * allowed to see even though none are returned — whether they exist is
 * itself what is leaked. `AND`/`OR`/`NOT` recurse on the same table, as
 * Drizzle does; `RAW` is SQL and kept as written.
 */
function checkedWhere(
  filter: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): unknown {
  if (!isRecord(filter)) return filter;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    const checked = checkedWhereEntry(key, value, tableKey, relations, rules);
    if (checked !== LEFT_OUT) copy[key] = checked;
  }
  return copy;
}

/** A `where` entry the copy leaves out because Drizzle would ignore it. */
const LEFT_OUT = Symbol("left-out");

/** One `where` entry, checked: a logical group, `NOT`, a column or a relation. */
function checkedWhereEntry(
  key: string,
  value: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): unknown {
  if (value === undefined || key === "RAW") return value;
  if (key === "AND" || key === "OR") {
    return checkedLogicalGroup(key, value, tableKey, relations, rules);
  }
  if (key === "NOT") return checkedWhere(value, tableKey, relations, rules);
  return checkedFieldFilter(key, value, tableKey, relations, rules);
}

/** An `AND` / `OR` group, each of its filters checked on the same table. */
function checkedLogicalGroup(
  key: "AND" | "OR",
  value: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): unknown {
  // Drizzle skips a group with no length — an empty array, or anything
  // without one — so it reaches nothing. It is left out of the copy rather
  // than handed through, because the object the caller still holds could
  // gain a length after this check. `Object(value)` reads a primitive's
  // length the way Drizzle's `value?.length` does.
  if (!Reflect.get(Object(value), "length")) return LEFT_OUT;
  // Otherwise Drizzle maps over it, so anything but a real array could
  // produce filters this walk never saw.
  if (!Array.isArray(value)) {
    throw NextlyError.invalidInput({
      message: `"${key}" in a relational "where" must be an array of filters.`,
      logContext: { reason: "non-array-logical-filter", table: tableKey },
    });
  }
  return value.map((sub: unknown) =>
    checkedWhere(sub, tableKey, relations, rules)
  );
}

/**
 * A column or relation filter. A column and a relation cannot share a name —
 * Drizzle refuses the pair when the relations are assembled — so a key the
 * config names as a relation is one, and its target is checked before the
 * filter under it is.
 */
function checkedFieldFilter(
  key: string,
  value: unknown,
  tableKey: string,
  relations: AnyRelations | undefined,
  rules: TableAccessRules
): unknown {
  const { all, table } = tableRelationsOf(relations, tableKey);
  const relation = ownRelation(table, key);
  if (relation === undefined) {
    // A name only the prototype answers for is neither a column nor a
    // relation, and Drizzle would resolve it the way a bare lookup does.
    if (key in table.relations) {
      throw NextlyError.invalidInput({
        message: `"${key}" is not a column or relation of "${tableKey}", so it cannot filter a relational "where".`,
        logContext: { reason: "unknown-field-in-where", table: tableKey },
      });
    }
    return value;
  }
  assertRelationAccess(relation, tableKey, "where", all, rules);
  return typeof value === "boolean"
    ? value
    : checkedWhere(value, relation.targetTableName, all, rules);
}

/**
 * The relational handle as it stands now: its query namespace, and the
 * relations config it was built with.
 *
 * `_.relations` is Drizzle's own record of the config this handle was built
 * with, on all three dialects' database classes. Read from the SAME handle as
 * `query` rather than asked of the registry again, so the edges judged cannot
 * be a different build from the edges run.
 */
function relationalHandle(deps: PluginDatabaseDeps): {
  query: RelationalQueries;
  relations: AnyRelations | undefined;
} {
  const db = deps.relationalDb() as {
    query: RelationalQueries;
    _?: { relations?: AnyRelations };
  };
  return { query: db.query, relations: db._?.relations };
}

/**
 * One table's entry point, judged again each time it runs.
 *
 * A plain object carrying only the two methods, rather than Drizzle's builder:
 * the builder also exposes the schema and session it was built from, which
 * are enough to assemble a query over any table without passing through here.
 *
 * Each call re-checks the root table, then resolves the handle afresh and
 * runs the entry, and judges the config against the relations, of THAT
 * handle. A plugin may keep `ctx.db.query.x` across a schema reload that
 * drops `x` or gives it to another owner; a check made only when the property
 * was read would keep answering for the schema that existed then. The check
 * is a precondition, so it comes before Drizzle is handed anything.
 */
function checkedEntry(
  tableKey: string,
  deps: PluginDatabaseDeps
): RelationalQuery {
  const prepare = (
    config: unknown
  ): { entry: RelationalQuery; checked: unknown } => {
    const rules = rulesOf(deps);
    assertTableAccess(tableKey, rules);
    const { query, relations } = relationalHandle(deps);
    const entry = Object.hasOwn(query, tableKey) ? query[tableKey] : undefined;
    if (entry === undefined) {
      throw NextlyError.internal({
        logContext: {
          reason: "declared table has no relational query entry",
          table: tableKey,
        },
      });
    }
    return {
      entry,
      checked: checkedQueryConfig(config, tableKey, relations, rules),
    };
  };
  return {
    // Judged synchronously, so a refusal throws at the call as it always
    // has; only the query itself is handed to the tracker.
    findMany: config => {
      const { entry, checked } = prepare(config);
      return trackerOf(deps)(entry.findMany(checked), "read");
    },
    findFirst: config => {
      const { entry, checked } = prepare(config);
      return trackerOf(deps)(entry.findFirst(checked), "read");
    },
  };
}

/**
 * The relational-query namespace, behind the same check as every other method.
 *
 * Drizzle's namespace is schema-WIDE: it names core tables and every other
 * plugin's tables alongside the caller's own. Handing it back unwrapped was a
 * read path around the boundary the rest of this surface enforces —
 * `ctx.db.select(users)` refuses, and `ctx.db.query.users.findMany()`
 * answered. The check is the same `assertTableAccess`, so the two can only
 * disagree by someone changing the rule in one place, which there no longer
 * is one of.
 *
 * A Proxy rather than a filtered copy, for the reason the getter is not
 * cached: the namespace is rebuilt whenever the registry invalidates its
 * relations, and a copy taken here would name the tables of a schema that has
 * since been replaced.
 *
 * The Proxy's target is an empty object of its own, never Drizzle's
 * namespace. Every reflective operation a Proxy does not trap is forwarded to
 * its target, so with the namespace as the target a descriptor lookup
 * (`Object.getOwnPropertyDescriptor(ctx.db.query, "users").value`) handed
 * back the raw entry for any table, and an assignment replaced an entry in the
 * namespace core itself queries through. Forwarded to an empty object, an
 * untrapped operation reaches nothing. `get`, `has`, `ownKeys` and
 * `getOwnPropertyDescriptor` read the namespace and answer for the same rule,
 * so neither reading nor enumerating it names a table a call would refuse,
 * and the only value any of them hands out for a table is its checked entry.
 *
 * The root check alone would judge only the table a query STARTS from, so the
 * entry handed back judges every table its config reaches as well — see
 * `checkedQueryConfig`. The check made here, when the property is read, is
 * the early refusal; the entry repeats it when it runs, against the handle
 * current at that moment (see `checkedEntry`).
 */
function ownedQueries(
  namespace: RelationalQueries,
  deps: PluginDatabaseDeps
): RelationalQueries {
  const isEntry = (property: string | symbol): property is string =>
    typeof property === "string" && Object.hasOwn(namespace, property);
  const shell: RelationalQueries = {};

  return new Proxy(shell, {
    get(target, property, receiver) {
      if (isEntry(property)) {
        assertTableAccess(property, rulesOf(deps));
        return checkedEntry(property, deps);
      }
      // A symbol names no table, so it is read where it was set: on the
      // namespace. Every string key that is not an entry goes to the shell.
      if (typeof property === "symbol") return Reflect.get(namespace, property);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (isEntry(property)) return canAccessTable(property, rulesOf(deps));
      return Reflect.has(target, property);
    },
    ownKeys() {
      const rules = rulesOf(deps);
      return Object.keys(namespace).filter(key => canAccessTable(key, rules));
    },
    getOwnPropertyDescriptor(_target, property) {
      if (!isEntry(property) || !canAccessTable(property, rulesOf(deps))) {
        return undefined;
      }
      // Configurable, as a Proxy must report a property its target does not
      // hold; the value is the checked entry, as `get` hands out.
      return {
        value: checkedEntry(property, deps),
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
    // Nothing is added to the namespace through it: an assignment would only
    // ever reach the shell, and a property defined there would be one the
    // traps above do not answer for.
    defineProperty() {
      return false;
    },
  });
}

/** What a `select` builder has been narrowed by so far; copied, never mutated. */
interface SelectState {
  readonly where?: SQL;
  readonly orderBy: readonly SQL[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * An insert statement as the three dialects' Drizzle builders offer it: a
 * statement to await, and the two ways of having it return what the database
 * assigned. Each dialect offers one of the two.
 */
type AnyInsert = Promise<unknown> & {
  returning?: (
    fields: Record<string, unknown>
  ) => Promise<Array<Record<string, unknown>>>;
  $returningId?: () => Promise<Array<Record<string, unknown>>>;
};

/**
 * Run `statement`, and return the key the database assigned to the row it
 * inserted, read from that statement's own result.
 *
 * PostgreSQL and SQLite return it with `RETURNING`. MySQL has no `RETURNING`;
 * Drizzle's `$returningId()` reads the insert id the server reports for that
 * statement, in the reply to it. Either way the key answers this insert, on
 * the connection that ran it, so concurrent inserts cannot hand back each
 * other's keys — which is what asking `LAST_INSERT_ID()` or
 * `last_insert_rowid()` with a second statement would risk, since a pool may
 * run that statement on another connection.
 */
async function insertForAssignedKey(
  statement: AnyInsert,
  dialect: SupportedDialect,
  column: unknown,
  key: string
): Promise<unknown> {
  const rows =
    dialect === "mysql"
      ? await statement.$returningId?.()
      : await statement.returning?.({ [key]: column });
  return rows?.[0]?.[key];
}

/** Build the database surface one owner sees. */
export function createPluginDatabase(deps: PluginDatabaseDeps): PluginDatabase {
  type AnyDb = {
    select: (...args: unknown[]) => never;
    insert: (table: unknown) => {
      values: (rows: unknown) => AnyInsert;
    };
    update: (table: unknown) => {
      set: (values: unknown) => { where: (c: SQL) => Promise<unknown> };
    };
    delete: (table: unknown) => { where: (c: SQL) => Promise<unknown> };
  };

  // Every terminal call hands its whole promise to this, so a transaction
  // can wait for statements its callback started and never awaited.
  const track = trackerOf(deps);

  const surface: PluginDatabase = {
    table(definition) {
      // `resolveTable` carries the Drizzle object as `unknown` — it is built
      // by the compiler from the neutral model, which has no Drizzle types to
      // thread through. The cast is where that erasure is paid back, once,
      // rather than at every call site that wants to name a column.
      return resolveTable(definition, deps).table as TableColumns<
        typeof definition
      >;
    },

    select(definition) {
      // Resolved now so a bad call fails where it was written; `all` resolves
      // again, and runs against what it resolved then (see `resolveTable`).
      resolveTable(definition, deps);

      // Each step returns a NEW builder over a copy of the state, never
      // mutating the one it was called on. Two queries branched from one base
      // therefore keep their own `where`, and `first()` narrows only the copy
      // it runs, so a later `all()` on the same builder still returns every
      // row.
      const build = (
        state: SelectState
      ): PortableSelect<typeof definition> => ({
        where: condition => build({ ...state, where: condition }),
        orderBy: (...columns) => build({ ...state, orderBy: columns }),
        limit: count => build({ ...state, limit: count }),
        offset: count => build({ ...state, offset: count }),
        all: () => track(selectRows(state), "read"),
        async first() {
          const rows = await build({ ...state, limit: 1 }).all();
          return rows[0] ?? null;
        },
      });
      const selectRows = async (
        state: SelectState
      ): Promise<InferRow<typeof definition>[]> => {
        const { table } = resolveTable(definition, deps);
        const db = deps.db() as {
          select: () => {
            from: (t: unknown) => Record<string, (...a: never[]) => unknown>;
          };
        };
        let query = db.select().from(table);
        if (state.where) {
          query = query.where(state.where as never) as typeof query;
        }
        if (state.orderBy.length > 0) {
          query = query.orderBy(...(state.orderBy as never[])) as typeof query;
        }
        if (state.limit !== undefined) {
          query = query.limit(state.limit as never) as typeof query;
        }
        if (state.offset !== undefined) {
          query = query.offset(state.offset as never) as typeof query;
        }
        return (await (query as unknown as Promise<unknown>)) as never;
      };
      return build({ orderBy: [] });
    },

    insert(definition, values) {
      return track(writes.insert(definition, values));
    },

    insertReturning(definition, values) {
      return track(writes.insertReturning(definition, values));
    },

    update(definition, set) {
      // Resolved here to fail fast, and again in `where`, which writes to the
      // table it resolved itself (see `resolveTable`).
      resolveTable(definition, deps);
      const run = async (condition: SQL): Promise<number> => {
        const { table } = resolveTable(definition, deps);
        const values = toColumns(
          definition,
          withUpdatedColumns(definition, set)
        );
        const result = await (deps.db() as AnyDb)
          .update(table)
          .set(values)
          .where(condition);
        return affectedRows(result);
      };
      return { where: condition => track(run(condition)) };
    },

    delete(definition) {
      // As `update`: checked now, and resolved again where the delete runs.
      resolveTable(definition, deps);
      const run = async (condition: SQL): Promise<number> => {
        const { table } = resolveTable(definition, deps);
        const result = await (deps.db() as AnyDb)
          .delete(table)
          .where(condition);
        return affectedRows(result);
      };
      return { where: condition => track(run(condition)) };
    },

    contributed(tableName, columns) {
      const declared = Object.keys(columns);
      // Each statement is handed to `track`, as `update` and `delete` are, so
      // a transaction waits for one its callback started and never awaited.
      const readMany = async (
        ids: Parameters<ContributedColumns<typeof columns>["getMany"]>[0]
      ) => {
        const reach = contributedReach(tableName, declared, deps);
        if (ids.length === 0) return [];
        // Selected under the handle's own property names, then copied onto
        // the authored keys as own properties: a key such as `__proto__`,
        // assigned into an ordinary object, reaches the prototype setter and
        // the column silently drops out of the row.
        const fields: Record<string, unknown> = { id: reach.key };
        for (const granted of reach.columns) {
          fields[granted.property] = granted.column;
        }
        const db = deps.db() as {
          select: (fields: unknown) => {
            from: (table: unknown) => {
              where: (c: SQL) => Promise<unknown>;
            };
          };
        };
        const rows = await whenColumnsExist(reach, () =>
          db
            .select(fields)
            .from(reach.table)
            .where(inArray(reach.key as never, [...ids]))
        );
        return (rows as Record<string, unknown>[]).map(row =>
          authoredRow(row, reach.columns)
        ) as never;
      };
      const write = async (
        id: Parameters<ContributedColumns<typeof columns>["set"]>[0],
        values: Parameters<ContributedColumns<typeof columns>["set"]>[1]
      ): Promise<number> => {
        const named = Object.entries(values as Record<string, unknown>)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key);
        if (named.length === 0) {
          // A write that sets nothing changes nothing, and sends nothing. It
          // is still judged on the columns the handle was opened for, so a
          // handle the caller may not use is refused as a read of it is.
          contributedReach(tableName, declared, deps);
          return 0;
        }
        // The write is judged on what it names, against the same rule the
        // read's selection meets, before anything is sent.
        const reach = contributedReach(tableName, named, deps);
        const assignments: Record<string, unknown> = {};
        for (const granted of reach.columns) {
          assignments[granted.property] = (values as Record<string, unknown>)[
            granted.key
          ];
        }
        const result = await whenColumnsExist(reach, () =>
          (deps.db() as AnyDb)
            .update(reach.table)
            .set(assignments)
            .where(eq(reach.key as never, id as never))
        );
        return affectedRows(result);
      };
      // Closure-bound rather than methods reading `this`, so a destructured
      // `const { get } = ctx.db.contributed(...)` works like the object form.
      const getMany: ContributedColumns<typeof columns>["getMany"] = ids =>
        track(readMany(ids), "read");
      const get: ContributedColumns<typeof columns>["get"] = async id => {
        const [row] = await getMany([id]);
        return row ?? null;
      };
      const set: ContributedColumns<typeof columns>["set"] = (id, values) =>
        track(write(id, values));
      return { get, getMany, set };
    },

    async transaction(fn) {
      // What core work inside asked to run once this transaction commits
      // (`LinkedTransaction.afterCommit`). Run below, after `deps.transaction`
      // has resolved, which it does only once the commit has succeeded; a
      // rollback rejects first and the effects are dropped with the array.
      const committed: Array<() => unknown> = [];
      const result = await deps.transaction(async tx => {
        // The same surface, reading the transaction's handles. Built rather
        // than mutated so a caller holding the outer `ctx.db` cannot
        // accidentally write outside the transaction.
        //
        // BOTH handles, not just `db`. The `query` getter resolves
        // `relationalDb`, and the pooled one is a different connection on
        // PostgreSQL and MySQL, from which `tx.query.x.findMany()` could not
        // see the callback's uncommitted writes. The relational
        // handle cannot simply be `tx.db` either: that instance is built
        // without a relations config, and its `query` namespace is empty.
        // `deps.transaction` supplies a relations-enabled instance bound to
        // the same connection instead. `tx.relationalDb` is read on every
        // access to `query` rather than captured, so a supplier that resolves
        // it lazily — plugin-context does — keeps the relations config current.
        //
        // Its own `transaction` refuses. `PluginTransaction` leaves it out of
        // the type, but a plugin written in JavaScript can still call it, and
        // the outer `deps.transaction` would open a second transaction: on
        // PostgreSQL and MySQL that is another pooled connection, outside
        // this one and blind to its uncommitted writes.
        //
        // And it refuses everything once `fn` has settled, either way. A
        // plugin can keep `tx`, a builder made from it or one of its `query`
        // entries past the callback, and the transaction's handles then point
        // at a connection the transaction no longer owns — on SQLite the
        // shared one, outside any transaction; on PostgreSQL and MySQL a
        // client already back in the pool. Every statement this surface runs
        // reaches its handle through these two suppliers, so the one check in
        // them covers every path; it runs before `tx.relationalDb` is read,
        // since reading it may build a handle on that connection. The scope
        // closes only after `fn`'s promise settles and the statements it
        // started have finished, so neither work the callback is awaiting nor
        // work it started and did not await is refused or left to run after
        // the transaction ends. `scope.run` also decides the outcome: a
        // statement still in flight when the callback settled that then
        // fails rejects the transaction, and so rolls it back, even when the
        // callback itself resolved (see `transactionScope`).
        const scope = transactionScope("ctx.db.transaction");
        const scoped = createPluginDatabase({
          ...deps,
          // Read through rather than copied: the spread above reads a getter
          // once, and a reload that commits while this transaction runs
          // changes the dependencies its operations may reach.
          get dependsOn() {
            return deps.dependsOn;
          },
          db: () => {
            scope.assertOpen();
            return tx.db;
          },
          relationalDb: () => {
            scope.assertOpen();
            return tx.relationalDb;
          },
          transaction: () => Promise.reject(nestedTransactionError()),
          track: scope.track,
        });
        if (tx.adapterTx) {
          linkPluginTransaction(scoped, tx.adapterTx, scope, effect =>
            committed.push(effect)
          );
        }
        // Marked as the flow's transaction, so a core write that opens its
        // own and needs a lock this one holds can join it instead of waiting
        // on it (see `plugin-transaction-in-flow`).
        return scope.run(() =>
          runInPluginTransactionFlow(scoped, () => fn(scoped))
        );
      });
      await runCommitEffects(committed);
      return result;
    },

    // Resolved per access, never cached: the registry invalidates its
    // assembled relations when a table is re-registered, and that only
    // propagates if consumers re-resolve — the same rule core services
    // follow through BaseService.db.
    get query() {
      return ownedQueries(relationalHandle(deps).query, deps);
    },
  };

  // The two inserts, untracked: the surface's methods above hand each call's
  // promise to the tracker, and these are the work that promise stands for.
  const writes: Pick<PluginDatabase, "insert" | "insertReturning"> = {
    async insert(definition, values) {
      const { table } = resolveTable(definition, deps);
      const rows = (Array.isArray(values) ? values : [values]).map(row =>
        toColumns(
          definition,
          withGeneratedColumns(definition, row as Record<string, unknown>)
        )
      );
      await (deps.db() as AnyDb).insert(table).values(rows);
    },

    async insertReturning(definition, values) {
      const { table } = resolveTable(definition, deps);
      // A precondition, so it runs BEFORE the insert: a method that refuses
      // after writing leaves a row behind that the caller was told was not
      // created.
      const idColumn = definition.columns.find(c => c.primaryKey);
      if (!idColumn) {
        throw NextlyError.internal({
          logContext: {
            reason: "insertReturning needs a primary key",
            table: definition.name,
          },
        });
      }

      const filled = withGeneratedColumns(definition, values);
      const handle = table as Record<string, unknown>;
      const statement = (deps.db() as AnyDb)
        .insert(table)
        .values(toColumns(definition, filled));

      // The row is read back by its key, through the same select every other
      // read uses, so it comes back typed exactly as one. A key the caller
      // holds — a `col.id()` it set or `ctx.db` generated — is known before
      // the insert. A `col.serial()` key is chosen by the database during it,
      // so it is taken from the insert's own result (`insertForAssignedKey`),
      // which answers this insert even under concurrency.
      let key: unknown = filled[idColumn.key];
      if (idColumn.kind === "serial") {
        key = await insertForAssignedKey(
          statement,
          deps.dialect,
          handle[idColumn.key],
          idColumn.key
        );
      } else {
        await statement;
      }
      if (key === undefined || key === null) {
        throw NextlyError.internal({
          logContext: {
            reason: "the database reported no key for the inserted row",
            table: definition.name,
          },
        });
      }

      const row = await surface
        .select(definition)
        .where(eq(handle[idColumn.key] as never, key as never))
        .first();
      if (row === null) {
        throw NextlyError.internal({
          logContext: {
            reason: "inserted row could not be read back",
            table: definition.name,
          },
        });
      }
      return row;
    },
  };

  return surface;
}

/**
 * What a contributed-column call may touch: a handle on the table holding the
 * row's key and the caller's columns among `keys` — or a refusal, before any
 * query is built.
 *
 * Resolved per call, like every other method here, so a reload that removes
 * a contribution stops it being reachable on the next call.
 *
 * The handle is built from the compiled column specs rather than looked up on
 * the table's runtime definition. A collection's runtime table carries its
 * contributions, but a core table's is the static one its bundle declares and
 * carries none, so a lookup there found no column to read. The runtime table
 * is consulted only for the name of its key. The handle declares nothing but
 * those columns, so the statements it builds name nothing else.
 */
function contributedReach(
  tableName: string,
  keys: readonly string[],
  deps: PluginDatabaseDeps
): {
  tableName: string;
  table: unknown;
  key: unknown;
  columns: { key: string; name: string; property: string; column: unknown }[];
} {
  const granted = assertContributedColumnAccess(
    tableName,
    keys,
    rulesOf(deps),
    deps.contributions?.() ?? new Map()
  );
  // A row comes back with its key as `id`, so a column the caller authored
  // under `id` would be overwritten by it in every read.
  if (granted.some(column => column.key === "id")) {
    throw NextlyError.invalidInput({
      message: `A row read through ctx.db.contributed carries its key as "id", so the column contributed to "${tableName}" under the key "id" cannot be reached through it. Declare it under another key.`,
      logContext: { reason: "contributed-column-keyed-id", table: tableName },
    });
  }
  const runtime = deps.entityTable?.(tableName);
  if (runtime === undefined || runtime === null) {
    throw NextlyError.internal({
      logContext: {
        reason: "contributed table has no runtime table",
        table: tableName,
      },
    });
  }
  const primary = Object.values(getColumns(runtime as Table)).find(
    column => column.primary
  );
  if (primary === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "contributed table has no single-column primary key",
        table: tableName,
      },
    });
  }
  const handle = toDrizzleTable(
    {
      name: tableName,
      authored: tableName,
      owner: { kind: "app" },
      indexes: [],
      columns: [
        {
          // Declared with the key column's kind so the handle describes the
          // key as it is. The statements do not depend on it: each driver
          // sends the parameter untyped and the database compares it with
          // the column's own type, which a text declaration over an integer
          // key was measured not to change on SQLite, PostgreSQL or MySQL.
          key: ROW_KEY_PROPERTY,
          name: primary.name,
          kind: primary.dataType.startsWith("number") ? "integer" : "text",
          nullable: false,
          primaryKey: true,
        },
        // Each under a property of the handle's own, never its authored key:
        // a column authored under the row key's property would replace the
        // key on the handle, and every statement would then match rows by
        // the caller's column instead of by id.
        ...granted.map((column, at) => ({
          ...column.spec,
          key: contributedProperty(at),
        })),
      ],
    },
    deps.dialect
  ) as Table;
  const built = getColumns(handle);
  return {
    tableName,
    table: handle,
    key: built[ROW_KEY_PROPERTY],
    columns: granted.map((column, at) => ({
      key: column.key,
      name: column.name,
      property: contributedProperty(at),
      column: built[contributedProperty(at)],
    })),
  };
}

/**
 * A row selected under a handle's property names, keyed as its caller
 * authored the columns, each defined as an own property.
 */
function authoredRow(
  row: Record<string, unknown>,
  columns: readonly { key: string; property: string }[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id };
  for (const column of columns) {
    Object.defineProperty(out, column.key, {
      value: row[column.property],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * The properties a contributed-column handle holds its columns under. The
 * handle is built for one statement and never seen by the caller, so none
 * is an authored key, and the row key's cannot meet a column's.
 */
const ROW_KEY_PROPERTY = "rowKey";
const contributedProperty = (at: number): string => `column${String(at)}`;

/**
 * Run a contributed-column statement, naming a column the database does not
 * have yet rather than surfacing the driver's error.
 *
 * A contribution to a core or entity table is created by the app's
 * migrations, so between declaring it and applying the migration that adds
 * it, the column is in the compiled schema and not in the database. That is a
 * state the caller can act on — apply the migration — and it is reported as
 * one, naming the column and the table.
 */
async function whenColumnsExist<T>(
  reach: { tableName: string; columns: { name: string }[] },
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const missing = reach.columns.find(column =>
      isMissingNamedColumnError(error, column.name)
    );
    if (missing === undefined) throw error;
    throw NextlyError.conflict({
      reason: "state",
      message: `The column "${missing.name}" contributed to "${reach.tableName}" is not in the database yet. Apply the app's migration that adds it (\`nextly migrate:create\`, then \`nextly migrate\`).`,
      cause: error instanceof Error ? error : undefined,
      logContext: {
        reason: "contributed-column-not-migrated",
        table: reach.tableName,
        column: missing.name,
      },
    });
  }
}

/**
 * How many rows a write touched, across three drivers that disagree.
 *
 * Postgres returns `rowCount`, MySQL `affectedRows`, and better-sqlite3
 * `changes`. Returning 0 for an unrecognised shape would report "nothing
 * matched" for a write that succeeded, so an unknown shape is -1: a value a
 * caller can test for rather than one that lies.
 *
 * mysql2 hands its result header back as the FIRST element of a
 * `[header, fields]` pair rather than as the result itself, so the header is
 * read from there; read from the pair, every MySQL write reported -1.
 */
/**
 * Run a committed transaction's effects in the order they were registered.
 * Each is awaited before the next starts, and one that fails is logged rather
 * than thrown: the transaction has committed, and its caller is owed that
 * result, not an effect's failure in its place.
 */
async function runCommitEffects(
  effects: readonly (() => unknown)[]
): Promise<void> {
  for (const effect of effects) {
    try {
      await effect();
    } catch (error) {
      getNextlyLogger().error({
        kind: "after-commit-effect-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (typeof header === "object" && header !== null) {
    const shape = header as {
      rowCount?: unknown;
      affectedRows?: unknown;
      changes?: unknown;
    };
    for (const value of [shape.rowCount, shape.affectedRows, shape.changes]) {
      if (typeof value === "number") return value;
    }
  }
  return -1;
}
