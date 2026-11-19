/**
 * No command prints a line that comes from a third-party library.
 *
 * The CLI once loaded its environment file with dotenv, which announces
 * itself and adds a tip on every run. Each command the CLI defines is run
 * here as a process, in a project with a `.env`, and neither of its output
 * streams may hold such a line. The first lines of three commands are also
 * held to what the CLI itself says.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createProgram } from "../program";

import { everyCommandInvocation, inTurns } from "./helpers/every-command";
import { NEXTLY_RUN_TIMEOUT, runNextly } from "./helpers/run-nextly";

/** dotenv's banner and its tip, in any release's wording. */
const THIRD_PARTY = /\[dotenv@|injecting env|dotenvx|◇ |tip: /i;

let project: string;
let home: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "nextly-no-banner-"));
  // A home of its own: a command that keeps a user-level setting keeps it here.
  home = mkdtempSync(join(tmpdir(), "nextly-no-banner-home-"));
  writeFileSync(
    join(project, ".env"),
    "DATABASE_URL=file:./data.db\nEXAMPLE_SETTING=1\n"
  );
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const run = (args: string[]) =>
  runNextly(args, project, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    DATABASE_URL: undefined,
    DB_DIALECT: undefined,
    NODE_ENV: undefined,
    CI: undefined,
  });

describe("no line from a third-party library", () => {
  it(
    "is printed by any command the CLI defines, on either stream",
    async () => {
      const invocations = everyCommandInvocation(createProgram());
      // The control: the list is the program's, and holds its commands.
      expect(invocations.length).toBeGreaterThan(30);
      expect(invocations.map(args => args[0])).toContain("migrate");

      const runs = await inTurns(invocations, 4, async args => ({
        args,
        run: await run(args),
      }));

      const offenders = runs
        .filter(({ run: each }) =>
          THIRD_PARTY.test(`${each.stdout}\n${each.stderr}`)
        )
        .map(({ args, run: each }) => ({
          command: args.join(" "),
          lines: `${each.stdout}\n${each.stderr}`
            .split("\n")
            .filter(line => THIRD_PARTY.test(line)),
        }));
      expect(offenders).toEqual([]);
      // Each did run: none was stopped for taking too long.
      expect(
        runs
          .filter(({ run: each }) => each.stderr.includes("[runNextly]"))
          .map(({ args }) => args.join(" "))
      ).toEqual([]);
    },
    NEXTLY_RUN_TIMEOUT * 6
  );

  it.each([["migrate:status"], ["migrate"], ["db:sync", "--dry-run"]])(
    "nextly %s starts with the CLI's own line naming the database",
    async (...args) => {
      const each = await run(args);
      const first = each.stderr.split("\n").find(line => line.trim() !== "");
      expect(first, `${each.stdout}\n${each.stderr}`).toBe(
        `Database: SQLite ${join(project, "data.db")} (development; DATABASE_URL from .env)`
      );
    },
    NEXTLY_RUN_TIMEOUT
  );
});
