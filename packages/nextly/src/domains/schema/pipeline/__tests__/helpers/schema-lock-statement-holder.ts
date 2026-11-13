/**
 * A second process that holds the schema lock and sends one statement, as `nextly migrate` sends
 * a file's statement, which then waits on a table the suite keeps busy.
 *
 * Run through `tsx` by the takeover suite. Arguments: the dialect, the database URL, the lease in
 * seconds and a table prefix. It takes the lock, prints `held`, sends
 * `ALTER TABLE <prefix>_busy ADD COLUMN late varchar(64) DEFAULT '<a literal>'` through the
 * migration runner as `0007_late value.sql` (marked with its claim, outside a transaction), and
 * prints `sent` just after sending it. The suite then pauses or kills it while the statement
 * waits; it prints `done` only if the statement landed.
 */
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { installRegistryResolver } from "../../../../../cli/utils/registry-resolver";
import { loadDialectTables } from "../../../../../database/dialect-tables";
import { runMigrationStatements } from "../../../migrate/migration-transaction";
import { withSchemaLock } from "../../schema-lock";

import {
  HOLDER_LITERAL,
  HOLDER_UNIT,
} from "./schema-lock-statement-holder-names";

const [dialect, url, lease, prefix] = process.argv.slice(2);
if (!dialect || !url || !lease || !prefix) {
  throw new Error("usage: <dialect> <url> <leaseSeconds> <prefix>");
}

const adapter = (dialect === "postgresql"
  ? createPostgresAdapter({ url })
  : createMySqlAdapter({ url })) as unknown as DrizzleAdapter;
await adapter.connect();
await loadDialectTables(dialect);
installRegistryResolver(adapter);

await withSchemaLock(
  {
    adapter,
    command: "nextly migrate",
    whenHeld: "refuse",
    leaseSeconds: Number(lease),
  },
  async () => {
    process.stdout.write("held\n");
    const sending = runMigrationStatements(
      adapter,
      // A literal a refusal must never print, in a file whose name needs encoding to be carried.
      [
        `ALTER TABLE ${prefix}_busy ADD COLUMN late varchar(64) DEFAULT '${HOLDER_LITERAL}'`,
      ],
      { source: HOLDER_UNIT, transaction: false }
    );
    process.stdout.write("sent\n");
    await sending;
    process.stdout.write("done\n");
  }
);
await adapter.disconnect();
