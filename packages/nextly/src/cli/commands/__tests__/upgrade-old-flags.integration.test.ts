/**
 * `nextly upgrade` run with a flag of the database work it used to do
 * changes nothing and says where that work went.
 *
 * The command once consolidated an earlier release's migration records and
 * reconciled Nextly's own tables; `nextly migrate` does both now. Each flag
 * of that work still parses, and a run with one must not fall through to
 * what the command does today, which is move the project's packages. So
 * each case is a project with a newer release to move to and a database
 * holding Nextly's migration ledger, and asserts all three are as they were:
 * the packages, the files, the database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import type { LocalRegistry } from "../../__tests__/helpers/local-registry";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

import {
  MIDDLE,
  OLDEST,
  PACKAGES,
  createProject,
  startNextlyRegistry,
  type UpgradeProject,
} from "./helpers/upgrade-project";

const FLAGS: readonly (readonly string[])[] = [
  ["--confirm-backed-up"],
  ["--force"],
  ["-f"],
  ["--reconcile-core"],
  ["--target-table-name", "my_events"],
  ["--force-unlock"],
  ["--accept-data-loss"],
];

let registry: LocalRegistry;
let app: UpgradeProject | undefined;

beforeAll(async () => {
  registry = await startNextlyRegistry();
});

afterAll(async () => {
  await registry.close();
});

afterEach(() => {
  app?.remove();
  app = undefined;
});

/**
 * The database here is a SQLite file of the test's own, so the cases run
 * once: on the leg that sets no database address.
 */
const OTHER_LEG = Boolean(
  process.env.TEST_POSTGRES_URL ?? process.env.TEST_MYSQL_URL
);

describe.skipIf(OTHER_LEG)(
  "nextly upgrade with a flag of the database work it used to do",
  () => {
    it(
      "moves to the newer release without one: the fixture's control",
      async () => {
        app = await createProject({
          manager: "npm",
          registry,
          versions: OLDEST,
        });

        const run = await app.nextly(["upgrade"]);

        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
        expect(app.installed("nextly")).toBe(MIDDLE);
      },
      NEXTLY_RUN_TIMEOUT * 2
    );

    it.each(FLAGS)(
      "%s changes no package, no file and no table, and names nextly migrate",
      async (...flag) => {
        app = await createProject({
          manager: "npm",
          registry,
          versions: OLDEST,
        });
        // A database holding Nextly's migration ledger, made by the DDL the
        // product makes it with.
        const dbFile = join(app.dir, "site.db");
        const db = new Database(dbFile);
        for (const statement of getSchemaEventsDdl("sqlite"))
          db.exec(statement);
        db.close();
        const state = (of: UpgradeProject) => ({
          files: of.files(),
          packages: PACKAGES.map(name => [
            name,
            of.declared(name),
            of.installed(name),
          ]),
          database: readFileSync(dbFile, "base64"),
        });
        const before = state(app);
        const downloadsBefore = registry.downloads.length;

        const run = await runNextly(["upgrade", ...flag], app.dir, {
          DATABASE_URL: `file:${dbFile}`,
          DB_DIALECT: "sqlite",
        });
        const output = `${run.stdout}\n${run.stderr}`;

        expect(run.status, output).toBe(1);
        expect(output).toContain("`nextly migrate`");
        expect(output).toContain("(UPGRADE_WORK_MOVED)");
        expect(state(app)).toEqual(before);
        // Nothing was fetched either: the run ended before it asked anything.
        expect(registry.downloads.slice(downloadsBefore)).toEqual([]);
      },
      NEXTLY_RUN_TIMEOUT * 2
    );
  }
);
