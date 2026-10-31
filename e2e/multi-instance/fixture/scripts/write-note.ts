/**
 * A write outside any request: a process with the app's config and database
 * and no Next.js runtime, as a job, the CLI or a script makes one. With
 * `--raw`, the row is changed in the database directly, so nothing expires,
 * which is the driver's proof that the instances' reads are cached at all.
 *
 *   tsx scripts/write-note.ts <value> [--raw]
 */
import { getNextly, shutdownNextly } from "nextly";
import pg from "pg";

import { NOTE_SLUG, writeNote } from "../lib/note";
import config from "../nextly.config";

const [value, flag] = process.argv.slice(2);
if (!value) throw new Error("usage: write-note.ts <value> [--raw]");

if (flag === "--raw") {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const updated = await client.query(
      "UPDATE dc_notes SET value = $1 WHERE slug = $2",
      [value, NOTE_SLUG]
    );
    if (updated.rowCount !== 1) throw new Error("no note row to change");
  } finally {
    await client.end();
  }
} else {
  await writeNote(await getNextly({ config }), value);
  await shutdownNextly();
}
console.log(`wrote ${value}${flag === "--raw" ? " (raw)" : ""}`);
