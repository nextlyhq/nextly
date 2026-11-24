/**
 * Every command prints its first line before its own code loads.
 *
 * A command's work is imported when its action runs, and that takes seconds.
 * So each command that runs an action declares the line it starts with, and
 * the program prints it as the run begins. This drives the real program over
 * every command it defines, with the arguments the start-up timing uses, and
 * puts a recorder in place of each command's action: what is on standard
 * error when the recorder is called is what the user saw before any of the
 * command's code was imported. The real actions never load, so the test is
 * fast and touches no database.
 *
 * What would separate a correct program from a broken one:
 * - a command that declares no first line;
 * - a first line printed by the command's own code, after it loads;
 * - a database command whose first line is not the `Database: …` line;
 * - a line printed under `--quiet`, which keeps a run to its errors.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { loadCliEnvironment } from "../environment";
import { declaredFirstLine } from "../first-line";
import { createProgram } from "../program";

import { commandAt } from "./helpers/answer-only-invocations";
import { runsAnAction } from "./helpers/first-line-invocations";
// The same judges the start-up timing script loads, from the one module it loads them from.
import {
  commandPathOf,
  firstLineInvocations,
  firstNonBlankLine,
  wrongFirstLine,
} from "./helpers/startup-checks";

/** The variables the environment step may set, put back after each run. */
const KEPT = [
  "DATABASE_URL",
  "DB_DIALECT",
  "NODE_ENV",
  "NEXTLY_TELEMETRY_DISABLED",
  "XDG_CONFIG_HOME",
] as const;

let folder: string;
let kept: Partial<Record<(typeof KEPT)[number], string>>;

beforeAll(() => {
  kept = Object.fromEntries(KEPT.map(name => [name, process.env[name]]));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "nextly-first-line-")));
  writeFileSync(
    join(folder, ".env"),
    "DB_DIALECT=sqlite\nDATABASE_URL=file:./first-line.db\n"
  );
  isolate();
});

/**
 * The settings every run here starts from, set once, before the first: the
 * database from the test's own `.env`, which a variable already in the process
 * would win over, and the consent the program's telemetry keeps in a folder of
 * the test's own rather than the user's configuration folder. Once: Next.js's
 * loader reads the files on its first call and hands later calls in the same
 * process what it read then, so the variables it set must stay set.
 */
function isolate(): void {
  delete process.env.DATABASE_URL;
  delete process.env.DB_DIALECT;
  process.env.XDG_CONFIG_HOME = folder;
  process.env.NEXTLY_TELEMETRY_DISABLED = "1";
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  // Next.js's types declare NODE_ENV read-only, yet its loader sets it, so it
  // is put back like the others through the environment's plain record.
  const env: Record<string, string | undefined> = process.env;
  for (const name of KEPT) {
    if (kept[name] === undefined) delete env[name];
    else env[name] = kept[name];
  }
  rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs `args` through the real program, the environment read from the test's
 * folder, with a recorder in place of the action of the command they name:
 * what standard error held when the action would have started loading, or
 * `undefined` when no action ran.
 */
async function beforeTheAction(
  args: readonly string[],
  path: readonly string[]
): Promise<string | undefined> {
  const program = createProgram({
    beforeAction: (parsed: Command) =>
      loadCliEnvironment(parsed.opts<{ mode?: string }>().mode, folder),
  });
  let written = "";
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    written += String(chunk);
    return true;
  });
  let seen: string | undefined;
  commandAt(program, path).action(() => {
    seen = written;
  });
  await program.parseAsync(["node", "nextly", ...args]);
  return seen;
}

const INVOCATIONS = firstLineInvocations(createProgram()).filter(args =>
  runsAnAction(createProgram(), pathOf(args))
);

/** The words of `args` that name the command, before its own arguments. */
function pathOf(args: readonly string[]): string[] {
  return commandPathOf(createProgram(), args);
}

describe("every command prints its first line before its code loads", () => {
  it("covers every command that runs an action", () => {
    // The table the timing uses names every command, so this list is the program's own.
    expect(INVOCATIONS.length).toBeGreaterThan(30);
  });

  it.each(INVOCATIONS.map(args => [args.join(" "), args]))(
    "nextly %s",
    async (_name, args) => {
      const path = pathOf(args);
      const first = declaredFirstLine(commandAt(createProgram(), path));
      expect(
        first,
        `nextly ${path.join(" ")} declares no first line`
      ).toBeDefined();

      const seen = await beforeTheAction(args, path);
      expect(seen, "the action never ran").toBeDefined();
      const line = firstNonBlankLine(seen ?? "");
      if (first?.kind === "own") {
        // A command that prints its own first line at once gets nothing before it;
        // the start-up timing holds it to printing that line within the budget.
        expect(line).toBeUndefined();
      } else {
        expect(wrongFirstLine(createProgram(), path, line)).toBeUndefined();
        if (first?.kind === "database") {
          // The database the test's own `.env` names, not one from elsewhere.
          expect(line).toMatch(/^Database: SQLite .*first-line\.db \(/);
        }
      }
    }
  );

  it("takes only its own line from a command that prints one at once", () => {
    const program = createProgram();
    const path = ["telemetry", "status"];
    // A warning printed while the command loads is not its answer.
    expect(
      wrongFirstLine(program, path, "(node:1) ExperimentalWarning: loading")
    ).toBeDefined();
    expect(
      wrongFirstLine(
        program,
        path,
        "Telemetry is disabled (stdout is not a TTY)."
      )
    ).toBeUndefined();
  });

  it("prints nothing before the action under --quiet", async () => {
    const seen = await beforeTheAction(
      ["--quiet", "migrate:status"],
      ["migrate:status"]
    );
    expect(seen).toBe("");
  });
});
