/**
 * A second instance of a site on one SQLite file, as its own process: runs
 * increments on the database limit store and exits.
 *
 * Run by `database-limit-store-processes.integration.test.ts` through `tsx`,
 * so the store under test is this source, not a build. Arguments: the file,
 * the generation, the number of increments, then the keys of each, joined by
 * commas. Prints `done` once every increment has committed.
 */
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { createDatabaseLimitStore } from "../../database-limit-store";
import type { StoredLimit } from "../../limit-store";

const [file, generation, times, keyList] = process.argv.slice(2);
if (!file || !generation || !times || !keyList) {
  throw new Error("usage: <file> <generation> <times> <key,key,...>");
}
const keys = keyList.split(",");

const adapter = createSqliteAdapter({ url: `file:${file}` });
await adapter.connect();
// What `registerServices` does for an adapter handed to it, which this
// process, standing in for a second site, skips.
await loadDialectTables("sqlite");
const store = createDatabaseLimitStore({
  adapter,
  generation,
  sweepIntervalMs: false,
});
const increment = (current: ReadonlyMap<string, StoredLimit>, now: number) => ({
  write: new Map(
    keys.map(key => [
      key,
      {
        value: {
          n:
            ((current.get(key)?.value as { n?: number } | undefined)?.n ?? 0) +
            1,
        },
        expiresAt: now + 3_600_000,
      },
    ])
  ),
  result: undefined,
});
await Promise.all(
  Array.from({ length: Number(times) }, () => store.update(keys, increment))
);
await store.close();
await adapter.disconnect();
process.stdout.write("done\n");
