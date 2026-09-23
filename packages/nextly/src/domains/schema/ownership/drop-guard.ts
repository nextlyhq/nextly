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
import { NextlyError } from "../../../errors/nextly-error";

import type { OwnerRecord } from "./owner-registry";

/**
 * Tables a statement drops.
 *
 * Only DROP is extracted. A migration that creates or alters a table it does
 * not own is a different question with a different answer — it may be adding
 * an index a plugin asked for — and conflating the two here would refuse work
 * that is legitimate.
 */
const DROP_TABLE =
  /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?[\w-]+["`]?\.)?["`]?([\w-]+)["`]?/i;

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
    if (match) dropped.push(canonicalTableName(match[1]));
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
