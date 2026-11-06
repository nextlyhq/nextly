/**
 * Every command's `--help` ends by saying what its exit status means: the
 * codes every command shares, then the codes that command adds. `nextly
 * --help` ends with the shared codes, which every command it lists ends with
 * too. The commands
 * are read from the program's own list, so a command is covered by being
 * defined.
 *
 * The expected lines are written out here rather than built by the module that
 * writes them, so a block that drops or garbles a line cannot agree with
 * itself. Where a command's run is cheap in-process, its codes are pinned too.
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { COMPONENT_MAP_CHECK_EXIT } from "../commands/component-map-check-command";
import { COMMAND_EXIT_CODES } from "../exit-codes";
import { createProgram } from "../program";

import { commandAt, commandPaths } from "./helpers/answer-only-invocations";

const SHARED =
  "0 done or nothing to do · 1 failed or refused · 130 interrupted";

/** The codes each command adds, as its help must print them. */
const OWN: Record<string, string[]> = {
  migrate: ["2 an applied migration file was edited since it ran"],
  "generate:types": [
    "with --check: 2 the component map is out of step with the config, 1 it could not be checked",
  ],
};

/** What `--help` prints for `command`, custom help text included. */
function printedHelp(command: Command): string {
  let printed = "";
  command.configureOutput({
    writeOut: text => {
      printed += text;
    },
    writeErr: text => {
      printed += text;
    },
  });
  command.outputHelp();
  return printed;
}

const program = createProgram();
const paths = commandPaths(program).map(path => path.join(" "));

describe("every command's help ends with its exit codes", () => {
  it("reads a command list that is there", () => {
    // A list that came back empty would pass every case below by having none.
    expect(paths).toContain("migrate");
    expect(paths).toContain("media orphans");
    expect(paths.length).toBeGreaterThan(30);
  });

  it("nextly itself", () => {
    const help = printedHelp(program);
    expect(
      help.trimEnd().endsWith(["Exit codes:", `  ${SHARED}`].join("\n"))
    ).toBe(true);
    // Once: the commands' own blocks are not printed in the program's help.
    expect(help.split("Exit codes:")).toHaveLength(2);
  });

  it.each(paths)("%s", name => {
    const help = printedHelp(commandAt(program, name.split(" ")));
    const block = [
      "Exit codes:",
      `  ${SHARED}`,
      ...(OWN[name] ?? []).map(line => `  ${line}`),
    ].join("\n");
    expect(help.trimEnd().endsWith(block)).toBe(true);
    // Once: a block added twice would still end the help.
    expect(help.split("Exit codes:")).toHaveLength(2);
  });

  it("names its own codes only for commands the program defines", () => {
    // A key naming no command would document codes nobody can read.
    for (const name of Object.keys(COMMAND_EXIT_CODES)) {
      expect(paths).toContain(name);
    }
    expect(Object.keys(COMMAND_EXIT_CODES).sort()).toEqual(
      Object.keys(OWN).sort()
    );
  });
});

describe("the codes a run ends with", () => {
  // `migrate:create` with nothing to do exits 0: migrate-create-settings.test.ts
  // and migrate-create-record-snapshot.test.ts run it. `nextly migrate`'s 2 for
  // an edited applied file: migrate-core.test.ts (`migrateExitCode`). A
  // misspelt option on every command exits 1: suggest-nearest.test.ts.
  it("generate:types --check: 0 in step, 2 out of step, 1 could not check", () => {
    expect(COMPONENT_MAP_CHECK_EXIT).toEqual({
      agrees: 0,
      outOfDate: 2,
      couldNotCheck: 1,
    });
  });
});
