/**
 * The guard every writer of a site's data calls before a row leaves the site.
 *
 * An archive, a backup, an export and a pull each hand every row they are
 * about to write through `createSecretGuard(...).row(table, row)`, and write
 * what comes back. Secret columns are gone from it, and a row that is secret
 * as a whole comes back as `null`. The answers come from `core-secrets.ts` for
 * core tables, and from the writer for any other table (a plugin's own tables,
 * which the plugin declares).
 *
 * The guard fails closed in the two ways a writer could otherwise slip past it
 * without noticing:
 *
 * - a table with no answer is refused, not passed through. Writers ask about
 *   tables they found, and a table found that nobody declared is exactly the
 *   one whose secrets nobody listed;
 * - a core row whose keys are not that table's column names is refused. Rows
 *   read through Drizzle are keyed by property (`tokenHash`), and a guard that
 *   matched `token_hash` against them would drop nothing and say nothing.
 *
 * @module domains/data/secrets/guard
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { getCoreSchema } from "../../../schemas/core-schema";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";

import { CORE_SECRET_ANSWERS, type SecretAnswer } from "./core-secrets";

/** A row keyed by column name, as it is about to be written out. */
export type OutgoingRow = Readonly<Record<string, unknown>>;

export interface SecretGuardOptions {
  /** The dialect the rows were read from, which decides each core table's columns. */
  readonly dialect: SupportedDialect;
  /**
   * The name this database gives the field-group registry, when it is not the
   * default one. The same table under either name gets the same answer.
   */
  readonly fieldGroupRegistryTable?: string;
  /**
   * Answers for tables outside core: a plugin's own tables, as the plugin
   * declares them. A core table cannot be given a second answer here.
   */
  readonly otherTables?: Readonly<Record<string, SecretAnswer>>;
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
function coreColumns(
  options: SecretGuardOptions
): Map<string, ReadonlySet<string>> {
  const snapshot = getCoreSchema(options.dialect, {
    fieldGroupRegistryTable: options.fieldGroupRegistryTable,
  });
  return new Map(
    snapshot.tables.map(table => [
      table.name,
      new Set(table.columns.map(column => column.name)),
    ])
  );
}

/**
 * Build the guard for one dialect. Built once per write rather than per row,
 * since it reads the core schema to know each table's columns.
 */
export function createSecretGuard(options: SecretGuardOptions): SecretGuard {
  const columns = coreColumns(options);
  const registry = options.fieldGroupRegistryTable;
  const others = options.otherTables ?? {};

  for (const table of Object.keys(others)) {
    if (columns.has(table) || Object.hasOwn(CORE_SECRET_ANSWERS, table)) {
      throw refuse("secret-answer-for-core-table", { table });
    }
  }

  /** The core table name `table` answers as, or null when it is not core. */
  function coreName(table: string): string | null {
    if (!columns.has(table)) return null;
    return registry !== undefined && table === registry
      ? STORAGE_FORMAT.registryTable
      : table;
  }

  function answerFor(table: string): SecretAnswer {
    const core = coreName(table);
    const answer =
      core !== null
        ? CORE_SECRET_ANSWERS[core]
        : Object.hasOwn(others, table)
          ? others[table]
          : undefined;
    if (answer === undefined)
      throw refuse("table-without-secret-answer", { table });
    return answer;
  }

  function row(
    table: string,
    input: OutgoingRow
  ): Record<string, unknown> | null {
    const answer = answerFor(table);

    const known = columns.get(table);
    if (known !== undefined) {
      const strange = Object.keys(input).filter(key => !known.has(key));
      if (strange.length > 0) {
        throw refuse("row-keys-are-not-column-names", { table, keys: strange });
      }
    }

    switch (answer.holds) {
      case "nothing":
        return { ...input };
      case "every-row":
        return null;
      case "some-rows":
        // A row that does not carry the deciding column cannot be told apart,
        // so it is kept back rather than guessed at.
        if (!Object.hasOwn(input, answer.decidedBy)) {
          throw refuse("row-without-deciding-column", {
            table,
            column: answer.decidedBy,
          });
        }
        return answer.isSecret(input[answer.decidedBy]) ? null : { ...input };
      case "columns": {
        const out: Record<string, unknown> = { ...input };
        for (const column of answer.columns) {
          if (column.kind === "sign-in" && options.includeSignInData === true)
            continue;
          delete out[column.name];
        }
        return out;
      }
    }
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
