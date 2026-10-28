/**
 * A second process holding the schema lock, as another `nextly` command would.
 *
 * Run by the schema lock's integration suites through `tsx`, so the lock under test is this
 * source, not a build. Arguments: the dialect, the database URL (a file path for SQLite), the
 * command the claim names, the lease in seconds, and a table prefix. It takes the lock, creates
 * `<prefix>_first`, prints `held`, and then reads lines from stdin:
 *
 * - `second` creates `<prefix>_second` and prints `second`;
 * - `release` ends the work, so the lock is released, and prints `released`.
 *
 * It takes the lock as a command does, releasing it on SIGINT or SIGTERM, so a suite can stop it
 * with a signal, or kill it outright with SIGKILL, between the two statements.
 */
import { createInterface } from "node:readline";

import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { loadDialectTables } from "../../../../../database/dialect-tables";
import { withSchemaLock } from "../../schema-lock";

const [dialect, url, command, lease, prefix] = process.argv.slice(2);
if (!dialect || !url || !command || !lease || !prefix) {
  throw new Error("usage: <dialect> <url> <command> <leaseSeconds> <prefix>");
}

const adapter = (dialect === "postgresql"
  ? createPostgresAdapter({ url })
  : dialect === "mysql"
    ? createMySqlAdapter({ url })
    : createSqliteAdapter({ url: `file:${url}` })) as unknown as DrizzleAdapter;
await adapter.connect();
// What `registerServices` does for an adapter handed to it, which this process skips.
await loadDialectTables(dialect);

const lines = createInterface({ input: process.stdin });
const next = (): Promise<string> =>
  new Promise(resolve => lines.once("line", line => resolve(line.trim())));

await withSchemaLock(
  {
    adapter,
    command,
    whenHeld: "refuse",
    leaseSeconds: Number(lease),
    releaseOnInterrupt: true,
  },
  async () => {
    await adapter.executeQuery(`CREATE TABLE ${prefix}_first (id integer)`);
    process.stdout.write("held\n");
    for (;;) {
      const line = await next();
      if (line === "second") {
        await adapter.executeQuery(
          `CREATE TABLE ${prefix}_second (id integer)`
        );
        process.stdout.write("second\n");
      }
      if (line === "release") return;
    }
  }
);
lines.close();
await adapter.disconnect();
process.stdout.write("released\n");
