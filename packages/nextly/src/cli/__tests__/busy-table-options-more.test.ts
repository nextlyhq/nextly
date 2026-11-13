/**
 * `--lock-timeout` and `--lock-timeout-total` on `migrate:fresh` and `prune`, whose drops wait for
 * a busy table in tries, with the help every command gives them; and a value outside its range
 * refused before anything is read or changed.
 */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { registerMigrateFreshCommand } from "../commands/migrate-fresh.command";
import { runPruneCommand } from "../commands/prune";
import { registerPruneCommand } from "../commands/prune.command";
import { createLogger } from "../utils/logger";

/** The help `register` gives its one command, on a program of its own. */
function helpOf(register: (program: Command) => void): string {
  const program = new Command();
  register(program);
  const [command] = program.commands;
  return command.helpInformation();
}

describe.each([
  ["migrate:fresh", registerMigrateFreshCommand],
  ["prune", registerPruneCommand],
])("nextly %s", (_, register) => {
  const help = helpOf(register).replace(/\s+/g, " ");

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

describe("nextly prune with a bound out of range", () => {
  it("is refused by name before its consent is read", async () => {
    const logger = createLogger({ quiet: true });
    const header = vi.spyOn(logger, "header");
    // `--force` is the consent's earlier spelling, named deprecated when it is read.
    const warn = vi.spyOn(logger, "warn");

    const refused = await runPruneCommand({ lockTimeout: "0", force: true }, {
      logger,
    } as Parameters<typeof runPruneCommand>[1]).catch(
      (error: unknown) => error
    );

    expect(header).toHaveBeenCalledOnce();
    expect(refused).toMatchObject({ code: "INVALID_INPUT" });
    expect(String((refused as Error).message)).toContain("--lock-timeout");
    expect(warn).not.toHaveBeenCalled();
  });
});
