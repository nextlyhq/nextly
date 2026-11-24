/**
 * A Builder save a test kills at a point of its own: after a statement, before a file, or once the
 * translations table is in step. The save never goes on from it, as a process killed there, until
 * the case lets it go.
 *
 * Installed by a test file over each module a save passes through. This module imports nothing of
 * the save's itself (types only), so a mock's factory meets no module it is mocking:
 * `vi.mock("../../busy-table/run-unit", async original =>
 *   (await import("./helpers/stop-at-kill")).stoppingUnits(await original()))`.
 */
import type * as RunUnit from "../../../busy-table/run-unit";
import type * as HeldLeavingDrops from "../../../../i18n/migration/held-leaving-drops";
import type * as StatementExecutor from "../../../services/drizzle-statement-executor";

/** Where the save is stopped, and how to let it go. */
export const kill = {
  at: undefined as undefined | ((point: string) => boolean),
  reached: undefined as undefined | (() => void),
  release: undefined as undefined | (() => void),
};

/** Stop for good where `point` is the kill point; the case releases it once it has looked. */
export async function stopHere(point: string): Promise<void> {
  if (kill.at === undefined || !kill.at(point)) return;
  kill.at = undefined;
  await new Promise<void>((_, reject) => {
    kill.release = () =>
      reject(new Error(`the process was killed at ${point}`));
    kill.reached?.();
  });
}

/** Each file runs as a unit: stop before one starts, as a process killed between two files would. */
export function stoppingUnits(actual: typeof RunUnit): typeof RunUnit {
  return {
    ...actual,
    runUnitInTries: async (
      ...args: Parameters<typeof actual.runUnitInTries>
    ) => {
      await stopHere(`unit:${args[2].source}`);
      return actual.runUnitInTries(...args);
    },
  };
}

/**
 * A save brings a translations table in step after its file, through this function, whose statements
 * the file's stop points do not name: the save may be stopped before it, as a process killed with
 * the file applied, its registry row with it, and the translations table still the old one; or once
 * it has run, with that table the new one.
 */
export function stoppingCompanion(
  actual: typeof HeldLeavingDrops
): typeof HeldLeavingDrops {
  return {
    ...actual,
    applyCompanionTransition: async (
      ...args: Parameters<typeof actual.applyCompanionTransition>
    ) => {
      await stopHere("companion: before");
      const answer = await actual.applyCompanionTransition(...args);
      await stopHere("companion: after");
      return answer;
    },
  };
}

/**
 * A save that pushes its change runs the push's statements through the statement executor: one at a
 * time here, each followed by a point a process may be killed at, the statement kept, as MySQL keeps
 * each schema statement as it runs.
 */
export function stoppingStatements(
  actual: typeof StatementExecutor
): typeof StatementExecutor {
  class StoppingExecutor extends actual.DrizzleStatementExecutor {
    override async executeStatements(
      tx: unknown,
      statements: string[]
    ): Promise<void> {
      for (const statement of statements) {
        await super.executeStatements(tx, [statement]);
        await stopHere(`push: ${statement}`);
      }
    }
  }
  return { ...actual, DrizzleStatementExecutor: StoppingExecutor };
}
