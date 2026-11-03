/**
 * One meaning per flag, on every command the program defines: no command shows
 * a `--force` but `init`, none offers both `--dry-run` and `--apply`, and every
 * global option reaches every command through the program's one definition.
 * A hidden option is a retired spelling still honoured for a release, and only
 * the ones listed here exist.
 *
 * The commands are read from the program's own list, so a command is covered by
 * being defined.
 */
import type { Command, Option } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../domains/schema/migrate/can-prompt";
import { createProgram } from "../program";

import { commandAt, commandPaths } from "./helpers/answer-only-invocations";

// A run reaches the program's telemetry hook; nothing here is reported.
vi.mock("@nextlyhq/telemetry", () => ({
  init: async () => {},
  capture: () => {},
  shutdown: async () => {},
}));

afterEach(() => {
  setNonInteractive(false);
});

const program = createProgram();
const paths = commandPaths(program).map(path => path.join(" "));
const named = (name: string): Command => commandAt(program, name.split(" "));

/**
 * The retired spellings each command still answers, hidden from its help:
 * honoured for a release with a notice naming the new spelling, or, for
 * `db:sync`, refused with a notice.
 */
const RETIRED: Record<string, string[]> = {
  "db:sync": ["-f, --force"],
  "migrate:fresh": ["-f, --force"],
  prune: ["--force"],
  "generate:widget": ["--force"],
};

/** The program's options, every one of which every command accepts. */
const GLOBAL_FLAGS = [
  "-c",
  "--config",
  "--cwd",
  "--mode",
  "--verbose",
  "-q",
  "--quiet",
  "--no-color",
  "--color",
  "--non-interactive",
];

const flagsOf = (option: Option): string[] =>
  [option.short, option.long].filter(
    (flag): flag is string => flag !== undefined
  );

describe("the flag vocabulary", () => {
  it("is read from a command list that is there", () => {
    expect(paths).toContain("init");
    expect(paths).toContain("media orphans");
    expect(paths.length).toBeGreaterThan(30);
  });

  it("shows --force or -f on init alone", () => {
    const shown = paths.filter(name =>
      named(name).options.some(
        option =>
          !option.hidden &&
          flagsOf(option).some(flag => flag === "--force" || flag === "-f")
      )
    );
    expect(shown).toEqual(["init"]);
  });

  it("never offers --dry-run and --apply on one command", () => {
    const both = paths.filter(name => {
      const longs = named(name).options.map(option => option.long);
      return longs.includes("--dry-run") && longs.includes("--apply");
    });
    expect(both).toEqual([]);
  });

  it("hides only the retired spellings still honoured", () => {
    const hidden: Record<string, string[]> = {};
    for (const name of paths) {
      const flags = named(name)
        .options.filter(option => option.hidden)
        .map(option => option.flags);
      if (flags.length > 0) hidden[name] = flags;
    }
    expect(hidden).toEqual(RETIRED);
  });

  it("lets no command declare a global option of its own", () => {
    const redeclared = paths.flatMap(name =>
      named(name)
        .options.filter(option =>
          flagsOf(option).some(flag => GLOBAL_FLAGS.includes(flag))
        )
        .map(option => `${name}: ${option.flags}`)
    );
    expect(redeclared).toEqual([]);
  });

  it.todo(
    "offers --dry-run on every command that writes the database or the project folder by default"
  );
});

describe("every global option reaches every command", () => {
  /** The commands that run: a command with subcommands only dispatches. */
  const runnable = commandPaths(program).filter(
    path => commandAt(program, path).commands.length === 0
  );

  it.each(runnable.map(path => [path.join(" "), path] as const))(
    "nextly %s",
    async (_name, path) => {
      const run = createProgram();
      const command = commandAt(run, path);
      let seen: Record<string, unknown> | undefined;
      // Its own action is replaced, so nothing it does is loaded or run.
      command.action((...args: unknown[]) => {
        seen = (args.at(-1) as Command).optsWithGlobals();
      });
      const required = [
        ...command.registeredArguments
          .filter(argument => argument.required)
          .map(() => "x"),
        ...command.options.flatMap(option =>
          option.mandatory && option.long !== undefined
            ? [option.long, "x"]
            : []
        ),
      ];
      await run.parseAsync(
        [
          ...path,
          ...required,
          "-c",
          "custom.config.ts",
          "--cwd",
          "/project",
          "--mode",
          "test",
          "--verbose",
          "-q",
          "--no-color",
          "--non-interactive",
        ],
        { from: "user" }
      );
      const expected = {
        config: "custom.config.ts",
        cwd: "/project",
        mode: "test",
        verbose: true,
        quiet: true,
        color: false,
        nonInteractive: true,
      };
      // The program's own definition took each one, not a command's copy.
      expect(run.opts()).toMatchObject(expected);
      expect(seen).toMatchObject(expected);
    }
  );
});
