/**
 * What the migration `migrate:create` is about to write deletes, judged as
 * `nextly migrate` will judge it.
 *
 * There is one answer to "what does this file delete": the statement judge
 * `nextly migrate`, `migrate:down` and `migrate:check` read every file with
 * (`file-deletions`). Here it reads the files a run is about to write, in the
 * order they run (the translation files that run before the main file, the
 * main file, then the rest), against the schema the latest snapshot records
 * (`offlineDeletionFacts`, as `migrate:check` reads it). So the listing, the
 * consent asked for and the main file's header name exactly what applying
 * the files will ask consent for.
 *
 * The plan adds only words: why a deletion goes, where the plan knows it (an
 * entity the config no longer declares, a rename declined, a type change, a
 * person's answer that removes rows). A deletion the plan cannot explain is
 * listed without a reason rather than with a guess.
 *
 * @module domains/schema/migrate-create/planned-deletions
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { deletionKey, type Deletion } from "../migrate/data-loss-consent";
import { functionsDefinedBy, runDeletions } from "../migrate/file-deletions";
import { offlineDeletionFacts } from "../migrate/offline-deletion-facts";
import { splitSqlStatements } from "../migrate/split-sql";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";
import type { ColumnResolution } from "../pipeline/sql-templates/resolution-statements";

/** A rename the person (or a run that cannot ask) declined: its pair stays a drop and an add. */
export interface DeclinedRename {
  tableName: string;
  fromColumn: string;
  toColumn: string;
}

/** An entity the latest snapshot records and the config no longer declares, by its own table. */
export interface RemovedEntity {
  kind: "collection" | "Single" | "field group";
  slug: string;
  table: string;
}

/** What the plan knows of why each deletion goes. */
export interface DeletionPlan {
  operations: readonly Operation[];
  declinedRenames?: readonly DeclinedRename[];
  resolutions?: readonly ColumnResolution[];
  removedEntities?: readonly RemovedEntity[];
  /**
   * What the translation files move before they drop: a table or column whose values are copied
   * or archived first, with the words that say so. The judge reads such a drop as a deletion, as
   * `nextly migrate` does, so it is listed and asked about; this says it is a move.
   */
  translationMoves?: readonly {
    table: string;
    column?: string;
    reason: string;
  }[];
}

/** What a run's files delete: the main file's, for its header, and every file's, for the consent. */
export interface JudgedDeletions {
  main: Deletion[];
  all: Deletion[];
}

/**
 * Judges `files` (each one's UP statements, in run order; `main` is the index
 * of the main file) against `previous`, and words each deletion from `plan`.
 */
export function judgedDeletions(args: {
  files: readonly (readonly string[])[];
  main: number;
  dialect: SupportedDialect;
  previous: NextlySchemaSnapshot;
  plan: DeletionPlan;
}): JudgedDeletions {
  // The functions a judged statement may delete through are the ones these
  // files define; a generated statement calls no other.
  const functions = new Set(
    args.files.flatMap(statements =>
      functionsDefinedBy(statements, args.dialect)
    )
  );
  const perFile = runDeletions(args.files, args.dialect, {
    ...offlineDeletionFacts(args.previous, functions),
    // The tables a removal of rows reaches through foreign keys (cascaded or set null) are not
    // known offline: a collection's keys are not in the snapshot. Unknown rather than none, so
    // such a removal is listed as reaching tables that could not be read, which only the
    // consent without targets covers, and never named narrower than applying it will be.
    cascadeFrom: () => undefined,
    nulledBy: () => undefined,
  }).map(deletions => deletions.map(d => withReason(d, args.plan)));
  const seen = new Set<string>();
  const all = perFile.flat().filter(deletion => {
    const key = deletionKey(deletion);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { main: perFile[args.main] ?? [], all };
}

/** The main file's UP as `nextly migrate` splits it: the statements as the file writes them. */
export function mainFileStatements(
  statements: readonly string[],
  dialect: SupportedDialect
): string[] {
  return splitSqlStatements(
    statements.map(statement => `${statement};`).join("\n\n"),
    dialect
  );
}

/** A translation file's UP as `nextly migrate` splits it. */
export function fileStatements(
  upSql: string,
  dialect: SupportedDialect
): string[] {
  return splitSqlStatements(upSql, dialect);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `deletion` with why it goes, where the plan knows. */
function withReason(deletion: Deletion, plan: DeletionPlan): Deletion {
  const reason = reasonFor(deletion, plan);
  return reason === undefined || deletion.kind === "unnamed"
    ? deletion
    : { ...deletion, reason };
}

function reasonFor(deletion: Deletion, plan: DeletionPlan): string | undefined {
  const move = (plan.translationMoves ?? []).find(
    m =>
      deletion.kind !== "unnamed" &&
      same(m.table, deletion.table) &&
      (deletion.kind === "column"
        ? m.column !== undefined && same(m.column, deletion.column)
        : m.column === undefined)
  );
  if (move !== undefined) return move.reason;
  switch (deletion.kind) {
    case "table": {
      const entity = (plan.removedEntities ?? []).find(e =>
        same(e.table, deletion.table)
      );
      return entity === undefined
        ? undefined
        : `${entity.kind} ${entity.slug} is no longer in the config`;
    }
    case "column": {
      const on = (table: string, column: string) =>
        same(table, deletion.table) && same(column, deletion.column);
      const declined = (plan.declinedRenames ?? [])
        .filter(r => on(r.tableName, r.fromColumn))
        .map(r => r.toColumn);
      if (declined.length > 0) {
        return `rename to ${declined.join(" or ")} declined`;
      }
      const change = plan.operations.find(
        op =>
          op.type === "change_column_type" &&
          on(op.tableName, op.columnName) &&
          op.fromType !== op.toType
      );
      return change?.type === "change_column_type"
        ? `type changes from ${change.fromType} to ${change.toType}`
        : undefined;
    }
    case "rows": {
      const emptied = (plan.resolutions ?? [])
        .filter(
          r =>
            r.kind === "delete_nonconforming" &&
            same(r.tableName, deletion.table)
        )
        .map(r => r.columnName);
      return emptied.length === 0
        ? undefined
        : `rows with no ${emptied.join(" or ")} removed, so the column can be required`;
    }
    case "unnamed":
      return undefined;
  }
}
