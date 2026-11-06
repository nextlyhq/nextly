/**
 * Creates and drops the browser suite's own database on PostgreSQL and MySQL,
 * the one named by `./e2e-database.mjs`.
 *
 * `scripts/reset-e2e-db.mjs` creates it, empty, before the server opens it,
 * and the run's teardown (`global-setup.ts`) drops it when the run ends. The
 * create drops first, so a run that was cut short before its teardown leaves
 * nothing the next run on its port inherits.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E2E_DATABASE_NAME } from "./e2e-database.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The database drivers the playground itself connects with, resolved from its
// own dependencies, so the suite talks to the server with the same client the
// app under test uses.
const playgroundRequire = createRequire(
  path.resolve(HERE, "..", "..", "apps", "playground", "package.json")
);

/**
 * Drops the run's database if one is left, and creates it empty.
 *
 * @param {import("./e2e-database.mjs").E2eDatabase} database
 */
export async function recreateServerDatabase(database) {
  await onServer(database, quoted => [
    `DROP DATABASE IF EXISTS ${quoted}${forceOn(database)}`,
    `CREATE DATABASE ${quoted}`,
  ]);
  console.log(
    `[e2e] Created an empty ${database.dialect} database ${database.name}`
  );
}

/**
 * Drops the run's database.
 *
 * @param {import("./e2e-database.mjs").E2eDatabase} database
 */
export async function dropServerDatabase(database) {
  await onServer(database, quoted => [
    `DROP DATABASE IF EXISTS ${quoted}${forceOn(database)}`,
  ]);
  console.log(
    `[e2e] Dropped the ${database.dialect} database ${database.name}`
  );
}

/**
 * FORCE, on PostgreSQL, ends the connections a server still holds, which
 * would otherwise make the drop fail: the run's own server is still up when
 * its teardown runs, and a previous run's may have been left running.
 *
 * @param {import("./e2e-database.mjs").E2eDatabase} database
 */
function forceOn(database) {
  return database.dialect === "postgresql" ? " WITH (FORCE)" : "";
}

/**
 * Runs the statements `statementsFor` spells with the database's quoted name,
 * on a connection to its server rather than to the database itself, which
 * cannot be dropped from a connection to itself.
 *
 * The name is checked against the suite's own pattern once more before it is
 * spelled into a statement: identifiers cannot be bound as parameters, and a
 * name that got here any other way is not one this suite may drop.
 *
 * @param {import("./e2e-database.mjs").E2eDatabase} database
 * @param {(quoted: string) => string[]} statementsFor
 */
async function onServer(database, statementsFor) {
  const { dialect, serverUrl, name } = database;
  if (serverUrl === null || !E2E_DATABASE_NAME.test(name)) {
    throw new Error(
      `[e2e] Refusing to drop a database this suite does not own: ${name}`
    );
  }

  if (dialect === "postgresql") {
    const { Client } = playgroundRequire("pg");
    // The server's maintenance database.
    const maintenance = new URL(serverUrl);
    maintenance.pathname = "/postgres";
    const client = new Client({ connectionString: maintenance.toString() });
    await client.connect();
    try {
      for (const statement of statementsFor(`"${name}"`)) {
        await client.query(statement);
      }
    } finally {
      await client.end();
    }
    return;
  }

  const mysql = playgroundRequire("mysql2/promise");
  const connection = await mysql.createConnection({
    host: serverUrl.hostname,
    port: Number(serverUrl.port) || 3306,
    user: decodeURIComponent(serverUrl.username),
    password: decodeURIComponent(serverUrl.password),
  });
  try {
    for (const statement of statementsFor(`\`${name}\``)) {
      await connection.query(statement);
    }
  } finally {
    await connection.end();
  }
}
