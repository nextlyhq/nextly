/**
 * A second process that holds the schema lock and runs a file's two statements outside a
 * transaction, as `nextly migrate` runs a file marked to, with a pause between them.
 *
 * Run through `tsx` by the takeover suite. Arguments: the dialect, the database URL (a file path
 * for SQLite), the lease in seconds and a table prefix. It takes the lock, creates `<prefix>_one`
 * through the migration runner and prints `first`, then waits for a `second` line on stdin before
 * creating `<prefix>_two` the same way and printing `second`. The suite pauses or kills it between
 * the two.
 */
import { createInterface } from "node:readline";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import { installRegistryResolver } from "../../../../../cli/utils/registry-resolver";
import { loadDialectTables } from "../../../../../database/dialect-tables";
import { runMigrationStatements } from "../../../migrate/migration-transaction";
import { withSchemaLock } from "../../schema-lock";

const [dialect, url, lease, prefix] = process.argv.slice(2);
if (!dialect || !url || !lease || !prefix) {
  throw new Error("usage: <dialect> <url> <leaseSeconds> <prefix>");
}

const adapter = (dialect === "postgresql"
  ? createPostgresAdapter({ url })
  : dialect === "mysql"
    ? createMySqlAdapter({ url })
    : createSqliteAdapter({ url: `file:${url}` })) as unknown as DrizzleAdapter;
await adapter.connect();
await loadDialectTables(dialect);
installRegistryResolver(adapter);

const lines = createInterface({ input: process.stdin });
const next = (): Promise<string> =>
  new Promise(resolve => lines.once("line", line => resolve(line.trim())));

/** One statement of the file, run as the migration runner runs a file outside a transaction. */
const statement = (table: string) =>
  runMigrationStatements(adapter, [`CREATE TABLE ${table} (id integer)`], {
    source: "two.sql",
    transaction: false,
  });

await withSchemaLock(
  {
    adapter,
    command: "nextly migrate",
    whenHeld: "refuse",
    leaseSeconds: Number(lease),
  },
  async () => {
    await statement(`${prefix}_one`);
    process.stdout.write("first\n");
    while ((await next()) !== "second");
    await statement(`${prefix}_two`);
    process.stdout.write("second\n");
  }
);
lines.close();
await adapter.disconnect();
