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
// On PostgreSQL and MySQL (`E2E_DB_DIALECT`) it also drops and creates the
// run's own database, named by `support/e2e-database.mjs` and never by the
// environment, so the server boots on an empty database the run made.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E2E_DATABASE_NAME, e2eDatabase } from "../support/e2e-database.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_DIR = path.resolve(HERE, "..", "..", "apps", "playground");
const DATA_DIR = path.join(PLAYGROUND_DIR, "data");

// The database drivers the playground itself connects with, resolved from its
// own dependencies, so this script talks to the server with the same client
// the app under test uses.
const playgroundRequire = createRequire(
  path.join(PLAYGROUND_DIR, "package.json")
);

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

const DEV_DB = "nextly.db";

/**
 * Drops the run's database if an earlier run left it, and creates it empty.
 *
 * The name is checked against the suite's own pattern once more before it is
 * spelled into a statement: identifiers cannot be bound as parameters, and a
 * name that got here any other way is not one this suite may drop.
 *
 * @param {ReturnType<typeof e2eDatabase>} database
 */
async function recreateServerDatabase(database) {
  const { dialect, serverUrl, name } = database;
  if (serverUrl === null || !E2E_DATABASE_NAME.test(name)) {
    throw new Error(
      `[e2e] Refusing to drop a database this suite does not own: ${name}`
    );
  }

  if (dialect === "postgresql") {
    const { Client } = playgroundRequire("pg");
    // The server's maintenance database, since a database cannot be dropped
    // from a connection to itself.
    const maintenance = new URL(serverUrl);
    maintenance.pathname = "/postgres";
    const client = new Client({ connectionString: maintenance.toString() });
    await client.connect();
    try {
      // FORCE ends connections a previous run's server left open, which would
      // otherwise make the drop fail.
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${name}"`);
    } finally {
      await client.end();
    }
  } else {
    const mysql = playgroundRequire("mysql2/promise");
    const connection = await mysql.createConnection({
      host: serverUrl.hostname,
      port: Number(serverUrl.port) || 3306,
      user: decodeURIComponent(serverUrl.username),
      password: decodeURIComponent(serverUrl.password),
    });
    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await connection.query(`CREATE DATABASE \`${name}\``);
    } finally {
      await connection.end();
    }
  }
  console.log(`[e2e] Created an empty ${dialect} database ${name}`);
}

async function main() {
  const database = e2eDatabase({ port: Number(process.env.PORT) });
  if (database.dialect !== "sqlite") await recreateServerDatabase(database);

  await fs.mkdir(DATA_DIR, { recursive: true });

  for (const name of FILES) {
    if (name.includes(DEV_DB)) {
      throw new Error(`Refusing to delete the development database: ${name}`);
    }
    await fs.rm(path.join(DATA_DIR, name), { force: true });
  }

  console.log(`[e2e] Reset ${path.join(DATA_DIR, FILES[0])}`);
}

await main();
