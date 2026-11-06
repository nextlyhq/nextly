// Empties the browser suite's database before the server opens it.
//
// Runs from the webServer command rather than globalSetup, which Playwright
// starts only once the server is already up and holding the file.
//
// Deletes by an exact allow-list of names. The suite's whole licence to delete
// things rests on it never being pointed at a database anyone wanted, and a
// glob here — or a path assembled from an env var — is how that stops being
// true.
//
// On PostgreSQL and MySQL (`E2E_DB_DIALECT`) it also creates the run's own
// database, empty (`support/server-database.mjs`), named by
// `support/e2e-database.mjs` and never by the environment, so the server boots
// on an empty database the run made.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { e2eDatabase } from "../support/e2e-database.mjs";
import { recreateServerDatabase } from "../support/server-database.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_DIR = path.resolve(HERE, "..", "..", "apps", "playground");
const DATA_DIR = path.join(PLAYGROUND_DIR, "data");

// sqlite in WAL mode keeps two sidecar files. Leaving them behind restores
// pages from the previous run into a database meant to be empty.
// The production suite's empty install is emptied too: it is only empty, and
// its setup only open, on a database no earlier run made an administrator in.
const FILES = [
  "e2e.db",
  "e2e.db-shm",
  "e2e.db-wal",
  "e2e-setup.db",
  "e2e-setup.db-shm",
  "e2e-setup.db-wal",
];

/**
 * The production suite's own database, emptied only when it is the one the
 * server about to start opens. The seed adds only what is missing, so a file
 * an earlier run left would keep that run's seeded content and a change to the
 * seed would never reach the suite; and named by the server's own
 * `DATABASE_URL` rather than always, so the other suite's reset never empties
 * it under a production run beside it.
 */
const PRODUCTION_DB = "e2e-prod.db";
const PRODUCTION_FILES = [
  PRODUCTION_DB,
  `${PRODUCTION_DB}-shm`,
  `${PRODUCTION_DB}-wal`,
];

const DEV_DB = "nextly.db";

async function main() {
  const database = e2eDatabase({ port: Number(process.env.PORT) });
  if (database.dialect !== "sqlite") await recreateServerDatabase(database);

  await fs.mkdir(DATA_DIR, { recursive: true });

  const opensProduction =
    process.env.DATABASE_URL === `file:./data/${PRODUCTION_DB}`;
  for (const name of opensProduction
    ? [...FILES, ...PRODUCTION_FILES]
    : FILES) {
    if (name.includes(DEV_DB)) {
      throw new Error(`Refusing to delete the development database: ${name}`);
    }
    await fs.rm(path.join(DATA_DIR, name), { force: true });
  }

  console.log(`[e2e] Reset ${path.join(DATA_DIR, FILES[0])}`);
}

await main();
