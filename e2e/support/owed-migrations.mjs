// The migrations a run's tests wrote by making collections at runtime, and
// their removal once nothing will read them again.
//
// Making a collection at runtime writes its SQL into the playground's
// migrations folder. The suite's fresh database never needs it again, and left
// there it would pile up with every run and wait for the next migrate against
// the dev database. But it cannot go while the server runs: the server's
// migration ledger records each file it applied, and refuses the next Schema
// Builder save while one it recorded is missing. So a test notes its slug, and
// the files go when the run ends; and before the next server boots, for a run
// stopped before its end, since a booting dev server applies every file it
// finds to the empty database.
//
// Matched by each run's own unique slug, so nothing another run or person
// wrote is touched.
import { appendFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Where the playground writes the SQL migration of a collection made at
// runtime: `db.migrationsDir` in its config.
const MIGRATIONS_DIR = join(HERE, "../../apps/playground/src/db/migrations");

// The slugs owed, one per line, appended by any worker.
const OWED = join(HERE, "../.playwright/runtime-migrations-owed.txt");

/**
 * Notes that `slug`'s migrations are to be removed when the run ends.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
export async function oweMigrationsOf(slug) {
  await mkdir(dirname(OWED), { recursive: true });
  await appendFile(OWED, `${slug}\n`);
}

/**
 * Removes the migrations of every slug owed, and the list. Called by the run's
 * teardown, and by the reset before the server boots for a list a stopped run
 * left behind.
 *
 * @returns {Promise<void>}
 */
export async function removeOwedMigrations() {
  const listed = await readFile(OWED, "utf8").catch(() => "");
  const slugs = new Set(listed.split("\n").filter(slug => slug !== ""));
  for (const slug of slugs) await deleteMigrationsOf(slug);
  await rm(OWED, { force: true });
}

/**
 * Deletes the SQL files whose name or text names `slug`'s table.
 *
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function deleteMigrationsOf(slug) {
  const table = slug.replace(/-/g, "_");
  for (const dir of [MIGRATIONS_DIR, join(MIGRATIONS_DIR, "dynamic")]) {
    const names = await readdir(dir).catch(() => []);
    for (const name of names.filter(file => file.endsWith(".sql"))) {
      const path = join(dir, name);
      const sql = await readFile(path, "utf8").catch(() => "");
      if (name.includes(table) || sql.includes(table)) await rm(path);
    }
  }
}
