/**
 * The browser suite's own database on each dialect, and the one place its name
 * and address are decided.
 *
 * The suite deletes things, and its licence to do so is that its database is
 * one nobody wanted: a file it empties on SQLite, and on PostgreSQL and MySQL a
 * database the run drops and creates itself before the server opens it. So the
 * NAME is never taken from the environment. Only the database server's address
 * is, and an address that already names a database is refused, because that
 * database is somebody's.
 *
 * The database lives only as long as its run: the run's teardown drops it,
 * and the next run on the same port drops it first in case a run was cut
 * short. One per port, so two checkouts' runs never share one.
 *
 * Read by the Playwright config (which database the server is given), by
 * `scripts/reset-e2e-db.mjs` (which is created) and by the run's teardown
 * (which is dropped), so they can never disagree about which one the run
 * owns.
 */

/** The dialects the suite runs on. SQLite is the default. */
const E2E_DIALECTS = Object.freeze(["sqlite", "postgresql", "mysql"]);

/**
 * The database servers a local run uses unless told otherwise: the test
 * containers in `docker-compose.test.yml` (`nextly-postgres17-test` and
 * `nextly-mysql-test`). Their passwords are those containers' own.
 */
const SERVER_DEFAULTS = Object.freeze({
  postgresql: "postgres://postgres:postgres@localhost:5435",
  mysql: "mysql://root:root@localhost:3307",
});

/** Every name this suite may drop. Checked again before any statement runs. */
export const E2E_DATABASE_NAME = /^nextly_e2e_\d+$/;

/**
 * The dialect a run is on, from `E2E_DB_DIALECT`. Unset is SQLite, and an
 * unknown value is refused rather than read as SQLite: a run that silently
 * fell back would report a pass for a dialect it never touched.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {"sqlite" | "postgresql" | "mysql"}
 */
function e2eDialect(env = process.env) {
  const value = env.E2E_DB_DIALECT ?? "sqlite";
  if (!E2E_DIALECTS.includes(value)) {
    throw new Error(
      `[e2e] E2E_DB_DIALECT="${value}" is not one of ${E2E_DIALECTS.join(", ")}.`
    );
  }
  return /** @type {"sqlite" | "postgresql" | "mysql"} */ (value);
}

/**
 * @typedef {{ dialect: "sqlite" | "postgresql" | "mysql", serverUrl: URL | null, name: string, url: string }} E2eDatabase
 */

/**
 * The run's database: the dialect, the server's address (null on SQLite), the
 * database's own name, and the URL the playground is started with.
 *
 * The name carries the suite's port, so two checkouts running the suite at
 * once on one database server, each on a port of its own, never drop each
 * other's database.
 *
 * @param {{ port: number, env?: NodeJS.ProcessEnv }} options
 * @returns {E2eDatabase}
 */
export function e2eDatabase({ port, env = process.env }) {
  const dialect = e2eDialect(env);
  if (dialect === "sqlite") {
    // Relative, because the playground resolves it from its own directory.
    return {
      dialect,
      serverUrl: null,
      name: "e2e.db",
      url: "file:./data/e2e.db",
    };
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `[e2e] The suite's port must be a positive integer, not ${port}.`
    );
  }
  const name = `nextly_e2e_${port}`;

  const serverUrl = new URL(env.E2E_DB_SERVER_URL ?? SERVER_DEFAULTS[dialect]);
  const expectedProtocol =
    dialect === "postgresql" ? ["postgres:", "postgresql:"] : ["mysql:"];
  if (!expectedProtocol.includes(serverUrl.protocol)) {
    throw new Error(
      `[e2e] E2E_DB_SERVER_URL is a ${serverUrl.protocol} address, and this run is on ${dialect}.`
    );
  }
  if (serverUrl.pathname !== "" && serverUrl.pathname !== "/") {
    throw new Error(
      "[e2e] E2E_DB_SERVER_URL names a database. Give the server's address " +
        "alone: the suite creates and drops a database of its own on it, and " +
        "never uses one it did not create."
    );
  }

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return { dialect, serverUrl, name, url: url.toString() };
}
