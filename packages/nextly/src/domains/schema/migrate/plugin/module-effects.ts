/**
 * What a plugin migration module's statements do, as far as recording it
 * without running it is concerned.
 *
 * A module may be adopted — recorded as applied without running — when the
 * database already stands where it leads, and "where it leads" is a schema
 * snapshot: tables, columns, indexes, foreign keys and checks. That proves a
 * module's effect only when its statements have no other. A backfill, a seed,
 * a trigger or a function leaves nothing the snapshot compares, so a module
 * carrying one adopted on the strength of its tables would never do that work
 * anywhere it was adopted, while its ledger row said it had.
 *
 * - `schema`: every statement is table or index DDL, or writes into
 *   scaffolding — a table an earlier statement of the module created and a
 *   later one drops or renames away, absent from the module's target: the
 *   copy and the guard of a generated SQLite table rebuild, whose effect is
 *   the rebuilt table. The snapshot describes all of it, so adopting it loses
 *   nothing. Rows written into a table that outlives the module — a seed —
 *   are an effect like any other.
 * - `data`: no statement is table or index DDL, and at least one does
 *   something else. Nothing it does is in the snapshot, so it must run. So is
 *   a module that runs anything at all while its snapshot equals its start —
 *   a `--blank` module holding DDL the snapshot cannot carry, a partial index
 *   written by hand, say: dev push builds the snapshot, so the database
 *   standing past such a module says nothing about whether its DDL ran.
 * - `mixed`: both. Adopting it skips its other effect; running it again
 *   repeats DDL the database already holds.
 *
 * Transaction and session statements a module may hold (`SET LOCAL`,
 * savepoints) change nothing that outlives the module and count as neither.
 * Anything not recognised as one of these counts as an effect, so a statement
 * this does not understand is never adopted away.
 *
 * @module domains/schema/migrate/plugin/module-effects
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../../database/schema-registry";
import {
  tableInsertedInto,
  tableNamedByCreate,
  tablesRemovedBy,
} from "../../ownership/drop-guard";
import { snapshotsEquivalent } from "../drift-reconcile";
import { leadingWords } from "../split-sql";

import {
  pluginModuleStatements,
  type PluginMigration,
} from "./plugin-migration";

export type ModuleEffects = "schema" | "data" | "mixed";

/** What one statement contributes to its module's effects. */
type StatementEffect = "schema" | "other" | "none";

/** Table and index DDL: what a schema snapshot describes. */
function isSchemaStatement(words: readonly string[]): boolean {
  const [first, second, third] = words;
  switch (first) {
    case "CREATE":
      return (
        second === "TABLE" ||
        second === "INDEX" ||
        (second === "UNIQUE" && third === "INDEX")
      );
    case "ALTER":
    case "DROP":
      return second === "TABLE" || second === "INDEX";
    case "RENAME":
      return second === "TABLE";
    default:
      return false;
  }
}

/**
 * The statements that change nothing outliving the module: transaction-scoped
 * settings and savepoints, the only session statements a module may hold.
 */
const NEUTRAL_FIRST_WORDS = new Set(["SET", "SAVEPOINT", "RELEASE"]);

function statementEffect(
  statement: string,
  dialect: SupportedDialect,
  isScaffolding: (table: string) => boolean
): StatementEffect {
  const words = leadingWords(statement, dialect, 3);
  if (isSchemaStatement(words)) return "schema";
  const [first, second] = words;
  if (first !== undefined && NEUTRAL_FIRST_WORDS.has(first)) return "none";
  if (first === "ROLLBACK" && second === "TO") return "none";
  const target = tableInsertedInto(statement, dialect);
  return target !== undefined && isScaffolding(target) ? "schema" : "other";
}

/** What a module's UP does on `dialect`; see the module comment. */
export function moduleEffects(
  migration: Pick<
    PluginMigration,
    "dialects" | "snapshot" | "before" | "contributed" | "contributedBefore"
  >,
  dialect: SupportedDialect
): ModuleEffects {
  const statements = pluginModuleStatements(migration, dialect, "up");
  // The module's two sides as the reconcile compares them: its own tables
  // and the foreign ones it contributes to.
  const before = {
    tables: [
      ...(migration.before[dialect]?.tables ?? []),
      ...(migration.contributedBefore?.[dialect]?.tables ?? []),
    ],
  };
  const target = {
    tables: [
      ...(migration.snapshot[dialect]?.tables ?? []),
      ...(migration.contributed?.[dialect]?.tables ?? []),
    ],
  };
  // A table written into must be absent from the target to count as
  // scaffolding.
  const outlives = new Set(
    target.tables.map(table => table.name.toLowerCase())
  );
  // The tables a statement AFTER each one drops or renames away, so that a
  // table written into counts as scaffolding only when it is gone by the end.
  const removedAfter: ReadonlySet<string>[] = [];
  let removed = new Set<string>();
  for (let at = statements.length - 1; at >= 0; at -= 1) {
    removedAfter[at] = removed;
    removed = new Set([
      ...removed,
      ...tablesRemovedBy(statements[at], dialect),
    ]);
  }
  // Every table an earlier statement created, under the name it was created
  // by, as the walk reaches each statement.
  const created = new Set<string>();
  let schema = false;
  let other = false;
  statements.forEach((statement, at) => {
    const effect = statementEffect(
      statement,
      dialect,
      table =>
        !outlives.has(table) &&
        created.has(table) &&
        removedAfter[at].has(table)
    );
    const made = tableNamedByCreate(statement, dialect);
    if (made !== undefined) created.add(made);
    if (effect === "schema") schema = true;
    else if (effect === "other") other = true;
  });
  if (!other && !schema) return "schema";
  // Nothing in the snapshot moves, so the database standing past the module
  // cannot show that its statements ran.
  if (snapshotsEquivalent(before, target)) return "data";
  if (!other) return "schema";
  return schema ? "mixed" : "data";
}
