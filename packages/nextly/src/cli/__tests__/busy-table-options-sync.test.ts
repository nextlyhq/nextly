/**
 * `nextly db:sync` offers `--lock-timeout` and `--lock-timeout-total` with the one help they carry
 * everywhere, and hands them to the schema pipeline as the variables it reads its bounds from,
 * refusing a value outside its range before the sync starts.
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { exportBusyTableBounds } from "../commands/db-sync";
import { registerDbSyncCommand } from "../commands/db-sync.command";

/** `db:sync`'s help, on a program of its own. */
function syncHelp(): string {
  const program = new Command();
  registerDbSyncCommand(program);
  const [command] = program.commands;
  return command.helpInformation().replace(/\s+/g, " ");
}

describe("nextly db:sync", () => {
  const help = syncHelp();

  it("offers --lock-timeout for one try, with its range, default and variable", () => {
    expect(help).toContain("--lock-timeout <seconds>");
    expect(help).toContain(
      "one try's wait for a table another database session is using"
    );
    expect(help).toContain("1 to 3600, default 5");
    expect(help).toContain("NEXTLY_LOCK_TIMEOUT");
  });

  it("offers --lock-timeout-total for every try together, with its range and default", () => {
    expect(help).toContain("--lock-timeout-total <seconds>");
    expect(help).toContain("one try's value to 86400, default 90");
    expect(help).toContain("NEXTLY_LOCK_TIMEOUT_TOTAL");
  });

  it("says they bound a busy table, not the schema lock", () => {
    expect(help).toContain("not the wait for the schema lock");
  });
});

describe("exportBusyTableBounds", () => {
  it("hands each flag given to its variable, replacing what it held", () => {
    const env: NodeJS.ProcessEnv = { NEXTLY_LOCK_TIMEOUT: "9" };
    exportBusyTableBounds({ lockTimeout: "1", lockTimeoutTotal: "5" }, env);
    expect(env).toMatchObject({
      NEXTLY_LOCK_TIMEOUT: "1",
      NEXTLY_LOCK_TIMEOUT_TOTAL: "5",
    });
  });

  it("leaves a variable whose flag was not given as it is", () => {
    const env: NodeJS.ProcessEnv = { NEXTLY_LOCK_TIMEOUT_TOTAL: "60" };
    exportBusyTableBounds({ lockTimeout: "2" }, env);
    expect(env).toMatchObject({
      NEXTLY_LOCK_TIMEOUT: "2",
      NEXTLY_LOCK_TIMEOUT_TOTAL: "60",
    });
  });

  it("refuses a value outside its range, read with the environment's, and hands nothing on", () => {
    // A total below the one try is refused, though each value is a whole number of seconds.
    const env: NodeJS.ProcessEnv = { NEXTLY_LOCK_TIMEOUT_TOTAL: "3" };
    expect(() => exportBusyTableBounds({ lockTimeout: "4" }, env)).toThrow(
      /NEXTLY_LOCK_TIMEOUT_TOTAL is "3"/
    );
    expect(env.NEXTLY_LOCK_TIMEOUT).toBeUndefined();
  });
});
