/**
 * Every command that opens a database first says which one.
 *
 * Each command the CLI defines is run as a process, in a project whose
 * `.env` and `.env.local` name different SQLite files, with a probe that
 * records, in order, what the process wrote to standard error and each
 * database it opened. For a command that opened one, the line naming the
 * database must come before the first opening, name `.env.local`'s file and
 * `.env.local` as its source, and every opening must be of that file.
 *
 * The commands come from the program, not from a list here, so a new command
 * that opens a database another way fails this until it says so first.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  everyCommandInvocation,
  inTurns,
} from "../../__tests__/helpers/every-command";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { createProgram } from "../../program";

const PROBE = fileURLToPath(
  new URL("../../__tests__/helpers/database-open-probe.mjs", import.meta.url)
);

type Event = { said?: string; opened?: string };

/** These cases use SQLite files of their own, so they run once: on the leg that names no database. */
const OTHER_LEG = Boolean(
  process.env.TEST_POSTGRES_URL ?? process.env.TEST_MYSQL_URL
);

describe.skipIf(OTHER_LEG)("every command that opens a database", () => {
  let project: string;
  let home: string;
  let count = 0;

  beforeAll(async () => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "nextly-target-")));
    home = mkdtempSync(join(tmpdir(), "nextly-target-home-"));
    writeFileSync(join(project, ".env"), "DATABASE_URL=file:./from-env.db\n");
    writeFileSync(
      join(project, ".env.local"),
      "DATABASE_URL=file:./from-env-local.db\n"
    );
    writeFileSync(
      join(project, "nextly.config.ts"),
      `export default {
  collections: [{ slug: "target_posts", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`
    );
    // A database for the commands to read: one a sync has set up, so a
    // command that reads has something to open.
    const made = await run(["db:sync"]);
    expect(made.status, `${made.stdout}\n${made.stderr}`).toBe(0);
  }, NEXTLY_RUN_TIMEOUT * 2);

  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  /** Runs `args` with the probe, and reads what it recorded. */
  async function run(args: string[]) {
    const out = join(home, `probe-${String(count++)}.json`);
    const result = await runNextly(args, project, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      DATABASE_URL: undefined,
      DB_DIALECT: undefined,
      NODE_ENV: undefined,
      CI: undefined,
      NODE_OPTIONS: `--import=${PROBE}`,
      NEXTLY_OPEN_PROBE_OUT: out,
    });
    const events = existsSync(out)
      ? (JSON.parse(readFileSync(out, "utf8")) as Event[])
      : [];
    return { ...result, events };
  }

  it(
    "says which one first, from .env.local, and opens no other",
    async () => {
      const file = join(project, "from-env-local.db");
      const line = `Database: SQLite ${file} (development; DATABASE_URL from .env.local)`;
      const invocations = everyCommandInvocation(createProgram());

      const runs = await inTurns(invocations, 4, async args => ({
        command: args.join(" "),
        ...(await run(args)),
      }));

      const opened = runs.filter(each =>
        each.events.some(event => event.opened !== undefined)
      );
      // The control: the probe sees openings, and of commands that read and
      // commands that change the database alike.
      const names = opened.map(each => each.command.split(" --")[0]);
      expect(names).toEqual(
        expect.arrayContaining(["migrate:status", "migrate", "db:sync"])
      );

      const wrong = opened
        .map(each => {
          const first = each.events.findIndex(
            event => event.opened !== undefined
          );
          const said = each.events
            .slice(0, first)
            .some(event => event.said === line);
          const others = each.events
            .filter(event => event.opened !== undefined)
            .map(event => resolve(project, String(event.opened)))
            .filter(path => path !== file && !path.endsWith(":memory:"));
          return said && others.length === 0
            ? undefined
            : {
                command: each.command,
                saidFirst: said,
                openedOthers: others,
                stderr: each.stderr.split("\n").slice(0, 4),
              };
        })
        .filter(each => each !== undefined);
      expect(wrong).toEqual([]);

      // The file `.env` names was never made: nothing read that setting.
      expect(existsSync(join(project, "from-env.db"))).toBe(false);
    },
    NEXTLY_RUN_TIMEOUT * 8
  );
});
