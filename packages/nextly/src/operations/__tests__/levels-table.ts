/**
 * The expected level, effects, doors and chat mark of every core operation,
 * one row each. A test holds the list to this table, so a level changed by
 * accident, an operation added without a row, or a row left behind for one
 * removed fails it.
 *
 * Every change that adds a core operation adds its row here, written from
 * what the operation does rather than copied from its declaration: the table
 * is the second, independent statement of each risk.
 */
import type { Door, OperationEffects, RiskLevel } from "../definition";
import type { ListedOperation } from "../list";

export interface LevelsRow {
  readonly level: RiskLevel;
  readonly alwaysAllow: boolean;
  readonly effects: OperationEffects;
  readonly doors: readonly Door[];
  readonly chatExposed: boolean;
}

/** Core's rows, by operation ID. Empty while core's list is. */
export const CORE_LEVELS_TABLE: Readonly<Record<string, LevelsRow>> = {};

/**
 * The only core operations that may run in a deploy pipeline: those that bring
 * the database's schema up to the code, or check that it is.
 */
export const DEPLOY_DOOR_OPERATIONS: ReadonlySet<string> = new Set([
  "migrate",
  "migrations.status",
  "migrations.check",
  "doctor",
]);

/** The operations on the deploy door that are not in the fixed set. */
export function outsideDeploySet(
  operations: readonly ListedOperation[]
): string[] {
  return operations
    .filter(
      op => op.doors.includes("deploy") && !DEPLOY_DOOR_OPERATIONS.has(op.id)
    )
    .map(op => op.id);
}

/** Each way `operations` differs from `table`, as a sentence. */
export function levelsTableProblems(
  operations: readonly ListedOperation[],
  table: Readonly<Record<string, LevelsRow>>
): string[] {
  const problems: string[] = [];
  const ids = new Set(operations.map(op => op.id));
  for (const op of operations) {
    const row = table[op.id];
    if (!row) {
      problems.push(`"${op.id}" has no row in the levels table`);
      continue;
    }
    const actual: LevelsRow = {
      level: op.level,
      alwaysAllow: op.alwaysAllow,
      effects: { ...op.effects },
      doors: [...op.doors].sort(),
      chatExposed: op.chatExposed,
    };
    const expected: LevelsRow = {
      ...row,
      effects: { ...row.effects },
      doors: [...row.doors].sort(),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `"${op.id}" differs from its row: declared ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
      );
    }
  }
  for (const id of Object.keys(table)) {
    if (!ids.has(id))
      problems.push(
        `the levels table has a row for "${id}", which is not in the list`
      );
  }
  return problems;
}
