/**
 * `--lock-timeout` and `--lock-timeout-total` on every command this release gives them, with help
 * that says they bound the wait for a busy table and not the wait for the schema lock.
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerMigrateCommand } from "../commands/migrate.command";
import { registerMigrateDownCommand } from "../commands/migrate-down.command";

/** The help `register` gives its one command, on a program of its own. */
function helpOf(register: (program: Command) => void): string {
  const program = new Command();
  register(program);
  const [command] = program.commands;
  return command.helpInformation();
}

describe.each([
  ["migrate", registerMigrateCommand],
  ["migrate:down", registerMigrateDownCommand],
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

  it("says a one try set past the default total, with no total given, raises it", () => {
    expect(help).toContain(
      "set longer than the default total, with no total given, the total rises to match"
    );
  });
});
