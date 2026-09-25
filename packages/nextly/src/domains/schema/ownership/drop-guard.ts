/**
 * Never drop a table on behalf of an owner that does not own it.
 *
 * Two mechanisms are needed because two different executors run DDL, and they
 * fail differently.
 *
 * **Dev push** goes through `filterUnsafeStatements`, which already blocks
 * drops of tables outside the desired set and allows the in-desired drop a
 * SQLite rebuild needs. Both rules stay exactly as they are; the push side of
 * this module adds one more, and only in the direction of refusing.
 *
 * **File migrations do not pass through that filter at all** — `executeSql`
 * runs the SQL verbatim. Filtering statements there would be worse than
 * useless: a file with some statements removed would be recorded as APPLIED,
 * so the ledger would claim a migration ran that partly did not. So a
 * migration is judged WHOLE, before its first statement executes, and refused
 * outright.
 *
 * @module domains/schema/ownership/drop-guard
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import type { OwnerRecord } from "./owner-registry";
import { SchemaOwnersRepository } from "./schema-owners-repository";

/**
 * Tables a statement drops.
 *
 * Only DROP is extracted. A migration that creates or alters a table it does
 * not own is a different question with a different answer — it may be adding
 * an index a plugin asked for — and conflating the two here would refuse work
 * that is legitimate.
 */
const DROP_TABLE =
  /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+?)(?:\s+(?:CASCADE|RESTRICT))?\s*;?\s*$/i;

/** One name in a DROP list, with its optional schema qualifier and quotes off. */
const DROP_TARGET = /^(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?$/;

/**
 * SQLite rebuilds a table through a `__new_<table>` twin.
 *
 * A statement naming `__new_dc_posts` is really about `dc_posts`, so the
 * prefix is stripped before the owner is looked up. Without this a rebuild's
 * intermediate drop would be attributed to a table nobody owns and waved
 * through, which is the one case where waving through is wrong.
 */
function canonicalTableName(name: string): string {
  return name.startsWith("__new_") ? name.slice("__new_".length) : name;
}

/** The tables a set of statements would drop. */
export function tablesDroppedBy(statements: readonly string[]): string[] {
  const dropped: string[] = [];
  for (const statement of statements) {
    const match = DROP_TABLE.exec(statement);
    if (!match) continue;

    // EVERY name, not just the first.
    //
    // `DROP TABLE a, b` is one statement naming two tables, and reading only
    // `a` let a module drop `b` — a table belonging to another stream — with
    // the guard approving it, because the name it checked was the one the
    // module was entitled to. The repository's own integration setup writes
    // comma-separated drops, so the single-name assumption was not safe even
    // in this codebase.
    for (const raw of match[1].split(",")) {
      const target = DROP_TARGET.exec(raw.trim());
      // A name this cannot parse is NOT skipped: skipping is what made the
      // first hole. Anything unrecognised is carried through as written, so
      // the owner lookup decides rather than the parser.
      dropped.push(canonicalTableName(target ? target[1] : raw.trim()));
    }
  }
  return dropped;
}

/** Which migration stream is running: `core`, `app`, or `plugin:<name>`. */
export type MigrationStream = string;

/**
 * Refuse a migration that drops a table belonging to another stream.
 *
 * Judged before execution and for the file as a WHOLE. An app migration
 * dropping `auth__identities` is refused; plugin-auth's own down migration
 * dropping it is allowed; a plugin dropping another plugin's table is refused.
 *
 * A table with NO owner row keeps today's behaviour exactly — it is not
 * refused. Absence means nobody has claimed it, and a migration that drops a
 * table nothing claims is the ordinary case for tables created before this
 * registry existed.
 */
export function assertNoForeignDrops(args: {
  statements: readonly string[];
  stream: MigrationStream;
  owners: ReadonlyMap<string, OwnerRecord>;
  /** For the error message. */
  source: string;
}): void {
  for (const table of tablesDroppedBy(args.statements)) {
    const owner = args.owners.get(table);
    if (!owner) continue;
    if (owner.migratedBy === args.stream) continue;

    throw new NextlyError({
      code: "DROP_OF_FOREIGN_TABLE",
      publicMessage:
        "A migration would drop a table that belongs to a different owner. It has been refused, and nothing was applied.",
      logContext: {
        table,
        droppedBy: args.stream,
        belongsTo: owner.migratedBy,
        ownerId: owner.ownerId,
        source: args.source,
      },
    });
  }
}

/**
 * Whether dev push may drop this table.
 *
 * A plugin-migrated table is never dropped by dev push, whatever the desired
 * set says. Dev push reconciles what the CONFIG describes, and a plugin table
 * removed from config is exactly the moment its data is most at risk — the
 * plugin is being uninstalled, and that is a decision for `plugin:uninstall`
 * rather than a side effect of a reload.
 */
export function pushMayDropTable(
  table: string,
  owners: ReadonlyMap<string, OwnerRecord>
): boolean {
  const owner = owners.get(canonicalTableName(table));
  if (!owner) return true;
  return !owner.migratedBy.startsWith("plugin:");
}

/** Whether one statement is a DROP of a plugin-migrated table. */
export function dropsPluginMigratedTable(
  statement: string,
  pluginMigratedTables: ReadonlySet<string>
): boolean {
  const match = DROP_TABLE.exec(statement);
  if (!match) return false;
  return pluginMigratedTables.has(canonicalTableName(match[1]).toLowerCase());
}

/**
 * The plugin-migrated table set dev push refuses to drop, from the owner
 * registry. Undefined when the registry cannot be read (a database that
 * predates it, or a fresh install before core reconcile), which callers read
 * as "nothing is claimed" — the pre-registry behaviour exactly.
 */
export async function pluginMigratedTableSet(
  db: unknown,
  dialect: SupportedDialect
): Promise<ReadonlySet<string> | undefined> {
  try {
    const rows = await new SchemaOwnersRepository(db, dialect).read();
    return new Set(
      rows
        .filter(row => row.migratedBy.startsWith("plugin:"))
        .map(row => row.tableName.toLowerCase())
    );
  } catch {
    return undefined;
  }
}
