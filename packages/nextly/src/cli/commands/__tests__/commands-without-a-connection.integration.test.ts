/**
 * The commands that read the core schema without opening a database
 * connection, run as a shell runs them in a fresh project, on every
 * configured dialect.
 *
 * Only the running dialect's table definitions are loaded, and opening a
 * connection is what loads them everywhere else. `migrate:create` and
 * `migrate:check` never connect: each settles its dialect from `DATABASE_URL`
 * alone, so each has to load that dialect's tables itself before it compiles
 * against the core schema. A test that booted an instance first would load
 * them for the command and hide the gap, which is why the commands run here
 * in a process of their own, against a project nothing else has touched.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const CONFIG = `
export default {
  collections: [{ slug: "cwc_posts", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

describe.each(getConfiguredTestDialects())(
  "a command that reads the core schema without connecting (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let instance: TestNextly | undefined;
    let databaseUrl: string;
    let previousUrl: string | undefined;
    let previousDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-no-connection-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      previousUrl = process.env.DATABASE_URL;
      previousDialect = process.env.DB_DIALECT;
      if (dialect === "sqlite") {
        databaseUrl = `file:${join(project, "test.db")}`;
      } else {
        // A database of this test's own, though neither command connects to
        // it: the URL names the dialect, and must not name anyone else's.
        instance = await createTestNextly({ dialect });
        databaseUrl = process.env.DATABASE_URL ?? "";
      }
    });

    afterEach(async () => {
      await instance?.destroy();
      instance = undefined;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previousDialect;
      _resetEnvCache();
      rmSync(project, { recursive: true, force: true });
    });

    // `--verbose`, so a failure's message carries what the command stopped on.
    const nextly = (args: string[]) =>
      runNextly([...args, "--verbose"], project, {
        DATABASE_URL: databaseUrl,
        DB_DIALECT: dialect,
      });

    it(
      "migrate:create writes the migration for a fresh project",
      () => {
        const run = nextly(["migrate:create", "init"]);
        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
        const migrations = join(project, "migrations");
        expect(existsSync(migrations)).toBe(true);
        expect(
          readdirSync(migrations, { recursive: true }).filter(name =>
            String(name).endsWith(".sql")
          )
        ).toHaveLength(1);
      },
      NEXTLY_RUN_TIMEOUT
    );

    it(
      "migrate:check passes the project migrate:create just wrote",
      () => {
        const created = nextly(["migrate:create", "init"]);
        expect(created.status, `${created.stdout}\n${created.stderr}`).toBe(0);
        const run = nextly(["migrate:check"]);
        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      },
      2 * NEXTLY_RUN_TIMEOUT
    );
  }
);
