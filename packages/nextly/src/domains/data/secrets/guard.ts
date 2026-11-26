/**
 * The guard every writer of a site's data calls before a row leaves the site.
 *
 * An archive, a backup, an export and a pull each hand every row they are
 * about to write through `createSecretGuard(...).row(table, row)`, and write
 * what comes back. Secret columns are gone from it, and a row that is secret
 * as a whole comes back as `null`. The answers come from `core-secrets.ts` for
 * core tables, and from the writer for the rest: a plugin's own tables, and
 * the columns a plugin added to a core table, both as the plugin declares
 * them.
 *
 * The guard fails closed in the ways a writer could otherwise slip past it
 * without noticing:
 *
 * - a table with no answer is refused, not passed through. Writers ask about
 *   tables they found, and a table found that nobody declared is exactly the
 *   one whose secrets nobody listed;
 * - a row whose keys are not that table's column names is refused, for a
 *   plugin's table as for a core one. Rows read through Drizzle are keyed by
 *   property (`tokenHash`), and a guard that matched `token_hash` against them
 *   would drop nothing and say nothing. So a column a plugin added to a core
 *   table is refused too until the plugin says whether it is secret.
 *
 * @module domains/data/secrets/guard
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { getCoreSchema } from "../../../schemas/core-schema";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { EXTENDABLE_CORE_TABLES } from "../../schema/extension/extension-columns";

import {
  CORE_SECRET_ANSWERS,
  type SecretAnswer,
  type SecretKind,
} from "./core-secrets";

/** A row keyed by column name, as it is about to be written out. */
export type OutgoingRow = Readonly<Record<string, unknown>>;

/** A table outside core: its answer, and every column it has. */
export interface OtherTable {
  readonly answer: SecretAnswer;
  /** Every column name, so a row keyed any other way is refused. */
  readonly columns: readonly string[];
}

/** A column a plugin added to a core table, and whether it is secret. */
export interface ContributedColumn {
  readonly name: string;
  readonly kind: SecretKind | "plain";
}

export interface SecretGuardOptions {
  /** The dialect the rows were read from, which decides each core table's columns. */
  readonly dialect: SupportedDialect;
  /**
   * The name this database gives the field-group registry, when it is not the
   * default one. The same table under either name gets the same answer.
   */
  readonly fieldGroupRegistryTable?: string;
  /**
   * Tables outside core: a plugin's own tables, as the plugin declares them.
   * A core table cannot be given a second answer here.
   */
  readonly otherTables?: Readonly<Record<string, OtherTable>>;
  /**
   * Columns plugins added to the core tables that take them (`users`,
   * `media` and the others extensions may widen), by core table.
   */
  readonly contributedColumns?: Readonly<
    Record<string, readonly ContributedColumn[]>
  >;
  /**
   * Keep sign-in data (password hashes). Only a writer making an encrypted
   * archive that was asked to carry sign-in data passes `true`; a secret is
   * left out whatever this says.
   */
  readonly includeSignInData?: boolean;
}

export interface SecretGuard {
  /** The row without its secrets, or `null` when the row is secret as a whole. */
  row(table: string, row: OutgoingRow): Record<string, unknown> | null;
  /** Every row that may leave, each without its secrets. */
  rows(table: string, rows: Iterable<OutgoingRow>): Record<string, unknown>[];
}

function refuse(
  reason: string,
  logContext: Record<string, unknown>
): NextlyError {
  // Generic in public: the detail names tables and columns, which belong in
  // the log, and a writer calling this is server code that reads the log.
  return NextlyError.internal({ logContext: { reason, ...logContext } });
}

/** Each core table's column names on this dialect, by table name. */
function coreColumns(options: SecretGuardOptions): Map<string, Set<string>> {
  const snapshot = getCoreSchema(options.dialect, {
    fieldGroupRegistryTable: options.fieldGroupRegistryTable,
  });
  const byTable = new Map<string, Set<string>>();
  for (const table of snapshot.tables) {
    byTable.set(table.name, new Set(table.columns.map(column => column.name)));
  }
  return byTable;
}

/** The columns an answer names, which the table must have. */
function namedColumns(answer: SecretAnswer): string[] {
  switch (answer.holds) {
    case "columns":
      return answer.columns.map(column => column.name);
    case "some-rows":
      return [answer.decidedBy];
    default:
      return [];
  }
}

/** Refuse a registry name that would make another core table answer as it. */
function assertRegistryName(registry: string | undefined): void {
  if (registry === undefined || registry === STORAGE_FORMAT.registryTable) {
    return;
  }
  if (Object.hasOwn(CORE_SECRET_ANSWERS, registry)) {
    throw refuse("registry-name-is-a-core-table", { table: registry });
  }
}

/**
 * Add each plugin-contributed column to its core table's known columns, and
 * return the contributed secrets by table. Refuses a contribution to a table
 * extensions cannot widen, and one that reuses a core column's name.
 */
function addContributions(
  known: Map<string, Set<string>>,
  contributions: SecretGuardOptions["contributedColumns"]
): Map<string, readonly ContributedColumn[]> {
  const byTable = new Map<string, readonly ContributedColumn[]>();
  for (const [table, added] of Object.entries(contributions ?? {})) {
    const columns = known.get(table);
    if (columns === undefined || !EXTENDABLE_CORE_TABLES.has(table)) {
      throw refuse("contribution-to-a-table-that-takes-none", { table });
    }
    for (const column of added) {
      if (columns.has(column.name)) {
        throw refuse("contribution-reuses-a-core-column", {
          table,
          column: column.name,
        });
      }
      columns.add(column.name);
    }
    byTable.set(table, added);
  }
  return byTable;
}

/** Add each table outside core to the known columns, refusing a core name. */
function addOtherTables(
  known: Map<string, Set<string>>,
  others: Readonly<Record<string, OtherTable>>
): void {
  for (const [table, other] of Object.entries(others)) {
    if (known.has(table) || Object.hasOwn(CORE_SECRET_ANSWERS, table)) {
      throw refuse("secret-answer-for-core-table", { table });
    }
    const columns = new Set(other.columns);
    const unknown = namedColumns(other.answer).filter(c => !columns.has(c));
    if (unknown.length > 0) {
      throw refuse("answer-names-a-column-the-table-lacks", {
        table,
        columns: unknown,
      });
    }
    known.set(table, columns);
  }
}

/** Refuse a row keyed by anything but its table's column names. */
function assertColumnNames(
  table: string,
  input: OutgoingRow,
  known: ReadonlySet<string>
): void {
  const strange = Object.keys(input).filter(key => !known.has(key));
  if (strange.length > 0) {
    throw refuse("row-keys-are-not-column-names", { table, keys: strange });
  }
}

/** Whether a row of a `some-rows` table is secret, by its deciding column. */
function isSecretRow(
  table: string,
  input: OutgoingRow,
  answer: Extract<SecretAnswer, { holds: "some-rows" }>
): boolean {
  // A row that does not carry the deciding column cannot be told apart, so it
  // is refused rather than guessed at.
  if (!Object.hasOwn(input, answer.decidedBy)) {
    throw refuse("row-without-deciding-column", {
      table,
      column: answer.decidedBy,
    });
  }
  return answer.isSecret(input[answer.decidedBy]);
}

/** Whether a column of this kind leaves the site. */
function leaves(
  kind: SecretKind | "plain",
  includeSignInData: boolean
): boolean {
  return kind === "plain" || (kind === "sign-in" && includeSignInData);
}

/** The row without the columns that may not leave. */
function withoutColumns(
  input: OutgoingRow,
  columns: readonly { name: string; kind: SecretKind | "plain" }[],
  includeSignInData: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const column of columns) {
    if (!leaves(column.kind, includeSignInData)) delete out[column.name];
  }
  return out;
}

/** The row as its table's own answer leaves it, before any contribution. */
function applyAnswer(
  table: string,
  input: OutgoingRow,
  answer: SecretAnswer,
  includeSignInData: boolean
): Record<string, unknown> | null {
  switch (answer.holds) {
    case "nothing":
      return { ...input };
    case "every-row":
      return null;
    case "some-rows":
      return isSecretRow(table, input, answer) ? null : { ...input };
    case "columns":
      return withoutColumns(input, answer.columns, includeSignInData);
  }
}

/**
 * Build the guard for one dialect. Built once per write rather than per row,
 * since it reads the core schema to know each table's columns.
 */
export function createSecretGuard(options: SecretGuardOptions): SecretGuard {
  const registry = options.fieldGroupRegistryTable;
  assertRegistryName(registry);
  const known = coreColumns(options);
  const core = new Set(known.keys());
  const contributed = addContributions(known, options.contributedColumns);
  const others = options.otherTables ?? {};
  addOtherTables(known, others);
  const includeSignInData = options.includeSignInData === true;

  function answerFor(table: string): SecretAnswer {
    if (core.has(table)) {
      const name =
        registry !== undefined && table === registry
          ? STORAGE_FORMAT.registryTable
          : table;
      const answer = CORE_SECRET_ANSWERS[name];
      if (answer !== undefined) return answer;
    } else if (Object.hasOwn(others, table)) {
      return others[table].answer;
    }
    throw refuse("table-without-secret-answer", { table });
  }

  function row(
    table: string,
    input: OutgoingRow
  ): Record<string, unknown> | null {
    const answer = answerFor(table);
    assertColumnNames(table, input, known.get(table) ?? new Set());
    const kept = applyAnswer(table, input, answer, includeSignInData);
    const added = contributed.get(table);
    return kept === null || added === undefined
      ? kept
      : withoutColumns(kept, added, includeSignInData);
  }

  return {
    row,
    rows(table, input) {
      const out: Record<string, unknown>[] = [];
      for (const each of input) {
        const kept = row(table, each);
        if (kept !== null) out.push(kept);
      }
      return out;
    },
  };
}
