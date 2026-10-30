/**
 * The commands that read the core schema without opening a database
 * connection, run as a shell runs them in a fresh project, on every
 * configured dialect.
 *
 * Only the running dialect's table definitions are loaded, and creating an
 * adapter is what loads them everywhere else. `migrate:create` and
 * `migrate:check` never connect: each settles its dialect from `DATABASE_URL`
 * alone, so the dialect's tables have to be loaded on their way to the core
 * schema. A test that booted an instance first would load them for the
 * command and hide the gap, which is why the commands run here in a process
 * of their own, against a project nothing else has touched.
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
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
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

/**
 * A URL naming each server dialect on a port nothing listens on: neither
 * command connects, and one that started to would fail here rather than reach
 * a database.
 */
const UNREACHABLE: Record<Exclude<TestDialect, "sqlite">, string> = {
  postgresql: "postgres://nextly@127.0.0.1:1/never_connected",
  mysql: "mysql://nextly@127.0.0.1:1/never_connected",
};

describe.each(getConfiguredTestDialects())(
  "a command that reads the core schema without connecting (%s)",
  (dialect: TestDialect) => {
    let project: string;

    beforeEach(() => {
      project = mkdtempSync(join(tmpdir(), "nextly-no-connection-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
    });

    afterEach(() => {
      rmSync(project, { recursive: true, force: true });
    });

    // The dialect comes from the URL alone, as it does for a shell that sets
    // only DATABASE_URL; `--verbose`, so a failure's message carries what the
    // command stopped on.
    const sqliteFile = () => join(project, "test.db");
    const nextly = (args: string[]) =>
      runNextly([...args, "--verbose"], project, {
        DATABASE_URL:
          dialect === "sqlite" ? `file:${sqliteFile()}` : UNREACHABLE[dialect],
        DB_DIALECT: undefined,
      });

    it(
      "migrate:create writes a fresh project's migration, and migrate:check passes it",
      async () => {
        const created = await nextly(["migrate:create", "init"]);
        expect(created.status, `${created.stdout}\n${created.stderr}`).toBe(0);
        expect(
          readdirSync(join(project, "migrations"), { recursive: true }).filter(
            name => String(name).endsWith(".sql")
          )
        ).toHaveLength(1);

        const checked = await nextly(["migrate:check"]);
        expect(checked.status, `${checked.stdout}\n${checked.stderr}`).toBe(0);

        // Opening SQLite creates its file, and would load the tables for the
        // command, hiding the gap this covers; a server URL above refuses it.
        expect(existsSync(sqliteFile())).toBe(false);
      },
      2 * NEXTLY_RUN_TIMEOUT
    );
  }
);
