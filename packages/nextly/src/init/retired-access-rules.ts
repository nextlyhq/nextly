/**
 * Telling an operator that the access rules still in their database no longer
 * do anything.
 *
 * The stored per-operation access rules were removed, and with them the code
 * that read the `access_rules` column. The column itself is left in place on a
 * database that already has it — dropping a column that holds configured rules
 * is the operator's decision, and `nextly migrate` puts it to them by name. But
 * between the upgrade and that decision the rules sit in the database looking
 * exactly as they did while they were enforced, and nothing else would say
 * otherwise: no query fails, no feature errors, the rows simply come back that
 * a rule used to withhold.
 *
 * So the operator is told at startup, once, which tables still carry rules and
 * how many rows. Reporting only; nothing here changes the database. It is
 * derived from the same live snapshot the core-schema drift warning reads, in
 * the same bounded pass on the initialized-boot path, for the same reason that
 * warning exists — a message at startup rather than a discovery downstream.
 *
 * @module init/retired-access-rules
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot } from "../domains/schema/pipeline/diff/types";

/** The column the stored rules lived in. */
export const RETIRED_ACCESS_RULES_COLUMN = "access_rules";

/** The two registry tables that carried it. */
export const RETIRED_ACCESS_RULES_TABLES: readonly string[] = [
  "dynamic_collections",
  "dynamic_singles",
];

/** A registry table that still holds rows with a rule in the retired column. */
export interface RetiredAccessRules {
  table: string;
  rows: number;
}

/**
 * Which registry tables in this database still carry the retired column.
 *
 * A NEW database never gets the column, and an old one that has run the drop
 * no longer has it, so on those the answer is empty and nothing is counted.
 * Judged on the live snapshot rather than assumed from the version, because
 * the column's presence is the only thing that decides whether the count
 * below can even be asked.
 */
export function findRetiredAccessRulesColumns(
  live: NextlySchemaSnapshot
): string[] {
  return live.tables
    .filter(
      table =>
        RETIRED_ACCESS_RULES_TABLES.includes(table.name) &&
        table.columns.some(
          column => column.name === RETIRED_ACCESS_RULES_COLUMN
        )
    )
    .map(table => table.name);
}

export interface CountRetiredAccessRulesDeps {
  countRows: (
    db: unknown,
    dialect: SupportedDialect,
    table: string
  ) => Promise<number>;
  countNulls: (
    db: unknown,
    dialect: SupportedDialect,
    table: string,
    column: string
  ) => Promise<number>;
}

/**
 * How many rows of each table still hold a rule.
 *
 * Derived as rows minus null rows rather than asked with its own predicate: the
 * two counts already exist, and a third query written here would be a second
 * place for a dialect's quoting or result shape to be wrong. A row with no
 * rule was always stored as NULL, so "not null" is exactly "holds a rule".
 *
 * Tables with nothing to report are dropped here, so the caller warns only
 * about what actually needs attention.
 */
export async function countRetiredAccessRules(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[],
  deps: CountRetiredAccessRulesDeps
): Promise<RetiredAccessRules[]> {
  const counted = await Promise.all(
    tables.map(async table => {
      const [total, empty] = await Promise.all([
        deps.countRows(db, dialect, table),
        deps.countNulls(db, dialect, table, RETIRED_ACCESS_RULES_COLUMN),
      ]);
      return { table, rows: total - empty };
    })
  );
  return counted.filter(entry => entry.rows > 0);
}

export function formatRetiredAccessRulesWarning(
  found: readonly RetiredAccessRules[]
): string {
  const lines = [
    "[nextly] Your database still holds stored access rules, and this version of Nextly no longer enforces them.",
    "",
    ...found.map(
      entry =>
        `  ${entry.table}: ${entry.rows} ${entry.rows === 1 ? "row carries" : "rows carry"} a value in \`${RETIRED_ACCESS_RULES_COLUMN}\``
    ),
    "",
    "  Access is now decided by the RBAC gate alone: a super-admin session bypasses it; otherwise the",
    "  code-defined `access` on the collection's or Single's config decides an operation it names,",
    "  and an operation it does not name falls through to the roles and permissions granted in the",
    "  database. Existing role grants still apply; only the rules in this column are ignored.",
    "  Review those rules, express any you still need as code-defined `access`, then remove the column:",
    "  `nextly migrate` will name it and refuse, and NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 drops it.",
  ];
  return lines.join("\n");
}
