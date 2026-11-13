/**
 * `--lock-timeout` and `--lock-timeout-total` on every command this release gives them, with help
 * that says they bound the wait for a busy table and not the wait for the schema lock.
 */
import { join } from "node:path";

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerMigrateCommand } from "../commands/migrate.command";
import { registerMigrateDownCommand } from "../commands/migrate-down.command";
import {
  runPluginInstall,
  runPluginInstallAll,
  runPluginUninstall,
} from "../commands/plugin-lifecycle-runner";
import { registerPluginsCommand } from "../commands/plugins.command";
import { createContext } from "../context";

/**
 * The help of the command `path` names (`["plugins", "install"]` for a subcommand), registered by
 * `register` on a program of its own.
 */
function helpOf(
  register: (program: Command) => void,
  path: readonly string[]
): string {
  const program = new Command();
  register(program);
  let command: Command = program;
  for (const name of path) {
    const found = command.commands.find(candidate => candidate.name() === name);
    if (found === undefined) throw new Error(`no command ${name}`);
    command = found;
  }
  return command.helpInformation();
}

describe.each([
  ["migrate", registerMigrateCommand, ["migrate"]],
  ["migrate:down", registerMigrateDownCommand, ["migrate:down"]],
  ["plugins install", registerPluginsCommand, ["plugins", "install"]],
  ["plugins uninstall", registerPluginsCommand, ["plugins", "uninstall"]],
])("nextly %s", (_, register, path) => {
  const help = helpOf(register, path).replace(/\s+/g, " ");

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

describe("the plugins commands' bounds", () => {
  // A project that does not exist: a bound checked after the config is read would be refused for
  // the missing config instead, so the refusal below shows it was checked before anything was read.
  const missing = join(__dirname, "no-such-project");
  const context = createContext({ quiet: true, cwd: missing });
  const options = {
    cwd: missing,
    config: join(missing, "nextly.config.ts"),
    lockTimeout: "0",
  };

  it.each([
    ["install", () => runPluginInstall("seo", options, context)],
    ["install --all", () => runPluginInstallAll(options, context)],
    [
      "uninstall",
      () =>
        runPluginUninstall(
          "seo",
          { ...options, keepData: false, yes: false },
          context
        ),
    ],
    [
      "install --dry-run",
      () => runPluginInstall("seo", { ...options, dryRun: true }, context),
    ],
  ])(
    "refuses a --lock-timeout out of range before reading anything (%s)",
    async (_, run) => {
      await expect(run()).rejects.toMatchObject({
        code: "INVALID_INPUT",
        logContext: {
          reason: "busy-table-bound-invalid",
          setting: "--lock-timeout",
        },
      });
    }
  );
});
