/**
 * One meaning per flag, on every command the program defines: no command shows
 * a `--force` but `init` (and `upgrade`, until that command changes), none
 * offers both `--dry-run` and `--apply`, and every global option reaches every
 * command through the program's one definition. A hidden option is a spelling
 * still answered, honoured for a release or refused with a notice, and only the
 * ones listed here exist.
 *
 * The commands are read from the program's own list, so a command is covered by
 * being defined.
 */
import type { Command, Option } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canPrompt,
  cancelEndsRun,
  setCancelEndsRun,
  setNonInteractive,
} from "../../domains/schema/migrate/can-prompt";
import { DRY_RUN_HELP } from "../dry-run";
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
  setCancelEndsRun(false);
});

const program = createProgram();
const paths = commandPaths(program).map(path => path.join(" "));
const named = (name: string): Command => commandAt(program, name.split(" "));

/**
 * The retired spellings each command still answers, hidden from its help:
 * honoured for a release with a notice naming the new spelling, or, for
 * `db:sync`, refused with a notice. `migrate:fresh --yes` is refused too: a
 * habit carried from other commands, it never consents to deleting data, and
 * the refusal names the consent that does.
 */
const RETIRED: Record<string, string[]> = {
  "db:sync": ["-f, --force"],
  "migrate:fresh": ["-f, --force", "--yes"],
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

  it("shows --force or -f on init alone, upgrade aside", () => {
    // upgrade's old flags, its -f/--force among them, are replaced when the
    // command changes, so its visible --force is left to that change.
    const shown = paths.filter(
      name =>
        name !== "upgrade" &&
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

  it("hides only the retired spellings listed", () => {
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
});

/**
 * What each command does when given no flag that changes it: writes the
 * database or the project folder (or a user-level setting), previews until
 * `--apply`, or reads only. Every command the program defines is listed, so a
 * new one fails here until it is placed.
 */
const WRITES = [
  "add",
  "build",
  "db:sync",
  "events abandon",
  "generate:manifest",
  "generate:types",
  "generate:widget",
  "i18n:restore",
  "init",
  "media reindex-usage",
  "migrate",
  "migrate:baseline",
  "migrate:create",
  "migrate:fresh",
  "migrate:down",
  "migrate:resolve",
  "permissions:cleanup",
  "plugins add",
  "plugins install",
  "plugins uninstall",
  "prune",
  "setup-token",
  "telemetry disable",
  "telemetry enable",
  "telemetry reset",
  "upgrade",
  "users:create-admin",
  "webhooks:prune",
  "workflow:move-stranded",
];
const PREVIEWS = [
  "media orphans",
  "media remove-sizes",
  "migrate:field-groups",
  "repair-columns",
  "users:clear-plaintext-passwords",
];
const READS = [
  "events",
  "events report",
  "generate:schema",
  "media",
  "migrate:check",
  "migrate:status",
  "plugins",
  "plugins info",
  "plugins list",
  "telemetry",
  "telemetry status",
  "workflow:stranded",
];

describe("--dry-run and --apply by what a command does", () => {
  const longs = (name: string) =>
    named(name).options.map(option => option.long);

  it("places every command the program defines exactly once", () => {
    const placed = [...WRITES, ...PREVIEWS, ...READS];
    expect([...placed].sort()).toEqual([...paths].sort());
  });

  it("offers --dry-run on every command that writes by default", () => {
    expect(WRITES.filter(name => !longs(name).includes("--dry-run"))).toEqual(
      []
    );
  });

  it("describes --dry-run in the same words on every command", () => {
    const worded = paths.flatMap(name =>
      named(name)
        .options.filter(option => option.long === "--dry-run")
        .filter(option => option.description !== DRY_RUN_HELP)
        .map(option => `${name}: ${option.description}`)
    );
    expect(worded).toEqual([]);
  });

  it("refuses --dry-run together with --check wherever a command has both", async () => {
    // `--check` exits non-zero on drift and `--dry-run` exits 0 with the plan,
    // so the two together would have one silently override the other.
    const both = paths.filter(name => {
      const flags = longs(name);
      return flags.includes("--dry-run") && flags.includes("--check");
    });
    expect(both.length).toBeGreaterThan(0);
    const unrefused: string[] = [];
    for (const name of both) {
      const run = createProgram();
      const command = commandAt(run, name.split(" "));
      // Its action is replaced and its output kept, so nothing it does runs.
      command
        .exitOverride()
        .configureOutput({ writeErr: () => {} })
        .action(() => {});
      const code = await run
        .parseAsync([
          "node",
          "nextly",
          ...name.split(" "),
          "--check",
          "--dry-run",
        ])
        .then(
          () => undefined,
          (error: { code?: string }) => error.code
        );
      if (code !== "commander.conflictingOption") unrefused.push(name);
    }
    expect(unrefused).toEqual([]);
  });

  it("ends a run given both flags before anything runs, naming the clash", async () => {
    const run = createProgram();
    const command = commandAt(run, ["generate:types"]);
    let written = "";
    command
      .exitOverride()
      .configureOutput({ writeErr: text => void (written += text) });
    // The action is replaced, so reaching it would show the run went on.
    let ran = false;
    command.action(() => {
      ran = true;
    });

    await expect(
      run.parseAsync([
        "node",
        "nextly",
        "generate:types",
        "--check",
        "--dry-run",
      ])
    ).rejects.toMatchObject({
      code: "commander.conflictingOption",
      exitCode: 1,
    });
    expect(written).toContain(
      "option '--dry-run' cannot be used with option '--check'"
    );
    expect(ran).toBe(false);
  });

  it("refuses db:sync --dry-run together with --watch, which never ends", async () => {
    const run = createProgram();
    const command = commandAt(run, ["db:sync"]);
    let written = "";
    command
      .exitOverride()
      .configureOutput({ writeErr: text => void (written += text) });
    // The action is replaced, so reaching it would show the run went on.
    let ran = false;
    command.action(() => {
      ran = true;
    });

    await expect(
      run.parseAsync(["node", "nextly", "db:sync", "--watch", "--dry-run"])
    ).rejects.toMatchObject({
      code: "commander.conflictingOption",
      exitCode: 1,
    });
    expect(written).toContain(
      "option '--dry-run' cannot be used with option '-w, --watch'"
    );
    expect(ran).toBe(false);
  });

  it("offers --apply on every command that previews by default", () => {
    expect(PREVIEWS.filter(name => !longs(name).includes("--apply"))).toEqual(
      []
    );
  });

  it("offers neither on a command that only reads", () => {
    expect(
      READS.filter(
        name =>
          longs(name).includes("--dry-run") || longs(name).includes("--apply")
      )
    ).toEqual([]);
  });
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

describe("--non-interactive typed on the command line", () => {
  // A test worker's streams are not terminals and carry no `isTTY` at all, so
  // each case makes them terminals, and the original (usually absent) is put
  // back after.
  const original = {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
  };
  const restore = (
    stream: NodeJS.ReadStream | NodeJS.WriteStream,
    was?: PropertyDescriptor
  ) => {
    if (was) Object.defineProperty(stream, "isTTY", was);
    else delete (stream as { isTTY?: boolean }).isTTY;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    restore(process.stdin, original.stdin);
    restore(process.stdout, original.stdout);
  });

  /** Whether `prune`'s action, run from `argv` at a terminal, may ask. */
  async function mayAskFrom(argv: string[]): Promise<boolean | undefined> {
    vi.stubEnv("CI", undefined);
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, "isTTY", {
        value: true,
        configurable: true,
      });
    }
    const run = createProgram();
    let mayAsk: boolean | undefined;
    // Its own action is replaced, so nothing it does is loaded or run.
    commandAt(run, ["prune"]).action(() => {
      mayAsk = canPrompt();
    });
    await run.parseAsync(argv);
    return mayAsk;
  }

  it("reaches canPrompt, so the command may not ask", async () => {
    expect(
      await mayAskFrom(["node", "nextly", "prune", "--non-interactive"])
    ).toBe(false);
  });

  it("is what turns it off: without it, the same run at a terminal may ask", async () => {
    expect(await mayAskFrom(["node", "nextly", "prune"])).toBe(true);
  });
});

describe("a cancel at a prompt", () => {
  // The app's dev server never runs the program, so the flag starts off and a
  // cancel there stops only the change it was asked about.
  it("ends the run under every command the program runs", async () => {
    const run = createProgram();
    let ends: boolean | undefined;
    // Its own action is replaced, so nothing it does is loaded or run.
    commandAt(run, ["prune"]).action(() => {
      ends = cancelEndsRun();
    });
    expect(cancelEndsRun()).toBe(false);
    await run.parseAsync(["node", "nextly", "prune"]);
    expect(ends).toBe(true);
  });
});
