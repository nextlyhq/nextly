/**
 * A snapshot as a written migration leaves it, for tests that start from one:
 * with its migration file beside the `meta/` folder. A snapshot alone is one
 * whose migration was never written, which no reader takes for the newest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeSnapshot } from "../../snapshot-io";

/** `writeSnapshot`, then the migration file it is the snapshot of. */
export async function recordedSnapshot(
  ...args: Parameters<typeof writeSnapshot>
): Promise<string> {
  const [metaDir, baseName, , sqlContent] = args;
  const path = await writeSnapshot(...args);
  mkdirSync(dirname(metaDir), { recursive: true });
  writeFileSync(join(dirname(metaDir), `${baseName}.sql`), sqlContent);
  return path;
}
