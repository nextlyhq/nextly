/**
 * What a migration file or plugin module would ADD that the connected server
 * cannot hold, refused before anything runs.
 *
 * MySQL before 8.0.16 accepts a CHECK and never enforces it, and before 8.0.13
 * cannot key an index on an expression. A declaration is judged at the compile
 * (`refuseConstructsTheServerCannotHold`); a migration is judged here, on what
 * it adds rather than on everything its snapshot carries:
 *
 * - **Structurally**, the checks and expression indexes the target snapshot
 *   holds and the snapshot before it did not. A construct already there was
 *   judged when it was added, so an unrelated later file is not refused for
 *   it — nor is a module that removes it. On a table another owner owns, the
 *   stream's snapshot keeps a frozen copy of the whole table, so only the
 *   elements the stream itself contributed are its to answer for.
 * - **By its statements**, the SQL that will actually run: a hand-written file
 *   has no snapshot at all, and a blank module's snapshot says nothing of what
 *   its author wrote. A `CHECK (` adds a check; an index key part that opens
 *   with `(` is an expression. Read through the one tokenizer
 *   (`statementTokens`), so a word inside a string or a comment is never one.
 *
 * @module domains/schema/migrate/server-constructs
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import {
  refuseConstructsTheServerCannotHold,
  type ServerConstructCapabilities,
} from "../extension/build-extension-schema";
import type { ContributedElements, TableSpec } from "../pipeline/diff/types";

import { statementTokens, type QuotedToken } from "./split-sql";

/** A table narrowed to the checks and indexes a change adds to it. */
export interface AddedConstructs {
  name: string;
  checks: TableSpec["checks"];
  indexes: TableSpec["indexes"];
}

/**
 * The checks and indexes each `target` table holds that the same table in
 * `before` did not, by name. A table in `foreign` belongs to another owner:
 * there only the elements the stream contributed count.
 */
export function constructsAdded(
  before: readonly TableSpec[],
  target: readonly TableSpec[],
  foreign: Readonly<Record<string, ContributedElements>> = {}
): AddedConstructs[] {
  const earlier = new Map(before.map(table => [table.name, table]));
  return target.map(table => {
    const was = earlier.get(table.name);
    const own = Object.hasOwn(foreign, table.name)
      ? foreign[table.name]
      : undefined;
    return {
      name: table.name,
      checks: newAndOwn(table.checks, was?.checks, own?.checks),
      indexes: newAndOwn(table.indexes, was?.indexes, own?.indexes),
    };
  });
}

/**
 * The named elements of `now` that `was` lacked, and, where `own` names the
 * stream's elements on another owner's table, only those among them.
 */
function newAndOwn<T extends { name: string }>(
  now: readonly T[] | undefined,
  was: readonly T[] | undefined,
  own: readonly string[] | undefined
): T[] {
  const had = new Set((was ?? []).map(element => element.name));
  const mine = own === undefined ? undefined : new Set(own);
  return (now ?? []).filter(
    element =>
      !had.has(element.name) && (mine === undefined || mine.has(element.name))
  );
}

type Token = string | QuotedToken;

/** Whether the statement adds a check: `CHECK` followed by its expression. */
function addsCheck(tokens: readonly Token[]): boolean {
  return tokens.some(
    (token, at) => token === "CHECK" && tokens[at + 1] === "("
  );
}

/** Words that may stand between `INDEX`/`KEY` and its key list. */
const INDEX_HEADER_LIMIT = 6;

/**
 * Where the key list of the `INDEX`/`KEY` at `at` opens, or -1 when what
 * follows is not one: a name, `ON` and its table, or `USING` and a method may
 * come first; a comma, a closing bracket or the end of the statement means the
 * word was no index definition (`DROP INDEX`, `ON DUPLICATE KEY UPDATE`).
 */
function keyListStart(tokens: readonly Token[], at: number): number {
  for (let step = 1; step <= INDEX_HEADER_LIMIT; step += 1) {
    const token = tokens[at + step];
    if (token === undefined || token === "," || token === ")") return -1;
    if (token === "UPDATE" || token === "=") return -1;
    if (token === "(") return at + step;
  }
  return -1;
}

/** Whether any key part of the list opening at `open` is an expression. */
function keyListHasExpression(tokens: readonly Token[], open: number): boolean {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === "(") {
      // A part opening with `(` at the list's own level is an expression.
      if (depth === 1 && (tokens[at - 1] === "(" || tokens[at - 1] === ",")) {
        return true;
      }
      depth += 1;
    } else if (token === ")") {
      depth -= 1;
      if (depth === 0) return false;
    }
  }
  return false;
}

/** Whether the statement defines an index with a key part on an expression. */
function addsExpressionIndex(tokens: readonly Token[]): boolean {
  return tokens.some((token, at) => {
    if (token !== "INDEX" && token !== "KEY") return false;
    const open = keyListStart(tokens, at);
    return open !== -1 && keyListHasExpression(tokens, open);
  });
}

function refuseStatement(source: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path: source, code: "INVALID", message }],
  });
}

/**
 * Refuse the first statement that adds a check the server would not enforce,
 * or an expression index it cannot build, naming `source` and the version.
 */
export function refuseStatementsTheServerCannotHold(
  statements: readonly string[],
  dialect: SupportedDialect,
  server: ServerConstructCapabilities,
  source: string
): void {
  if (
    server.enforcesCheckConstraints !== false &&
    server.functionalIndexes !== false
  ) {
    return;
  }
  const named = server.serverVersion ?? "this MySQL-compatible server";
  for (const statement of statements) {
    const tokens = statementTokens(statement, dialect);
    if (server.enforcesCheckConstraints === false && addsCheck(tokens)) {
      refuseStatement(
        source,
        `"${source}" adds a CHECK, and the connected server (${named}) accepts a CHECK without enforcing it — MySQL enforces from 8.0.16. A rule that holds nothing is refused rather than applied.`
      );
    }
    if (server.functionalIndexes === false && addsExpressionIndex(tokens)) {
      refuseStatement(
        source,
        `"${source}" adds an index on an expression, and the connected server (${named}) cannot key an index on an expression — MySQL can from 8.0.13.`
      );
    }
  }
}

/**
 * Both judgements for one migration unit: what its snapshots say it adds,
 * then what its statements would run.
 */
export function refuseUnitTheServerCannotHold(args: {
  source: string;
  dialect: SupportedDialect;
  server: ServerConstructCapabilities;
  statements: readonly string[];
  added: readonly AddedConstructs[];
}): void {
  refuseConstructsTheServerCannotHold(args.added, args.server);
  refuseStatementsTheServerCannotHold(
    args.statements,
    args.dialect,
    args.server,
    args.source
  );
}
