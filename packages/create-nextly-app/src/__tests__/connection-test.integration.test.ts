/**
 * The connection test against real servers: the PostgreSQL and MySQL test
 * containers, named by TEST_POSTGRES_URL and TEST_MYSQL_URL (the root
 * `test:integration:postgres17` and `test:integration:mysql` scripts set
 * them). Each server's cases are skipped when it is not named.
 *
 * A server older than Nextly supports is not among the containers; that case
 * is held by the unit tests, from the version string a server answers with.
 */
import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createDatabase, serverUrl } from "../connection-test/create-database";
import { connectWithDriver } from "../connection-test/drivers";
import { testConnection } from "../connection-test/test-connection";
import type { ServerDialect } from "../connection-test/types";

const SERVERS: { dialect: ServerDialect; url: string | undefined }[] = [
  { dialect: "postgresql", url: process.env.TEST_POSTGRES_URL },
  { dialect: "mysql", url: process.env.TEST_MYSQL_URL },
];

/** `base` with its database, password or port replaced. */
function variant(
  base: string,
  change: { database?: string; password?: string; port?: string }
): string {
  const url = new URL(base);
  if (change.database !== undefined) url.pathname = `/${change.database}`;
  if (change.password !== undefined) url.password = change.password;
  if (change.port !== undefined) url.port = change.port;
  return url.toString();
}

const quote = (dialect: ServerDialect, name: string) =>
  dialect === "postgresql" ? `"${name}"` : `\`${name}\``;

for (const { dialect, url } of SERVERS) {
  describe.skipIf(!url)(`the connection test on ${dialect}`, () => {
    const base = url ?? "";
    const made: string[] = [];
    // A local address, as the test containers are, so "create it" is offered.
    const local = (database: string) =>
      variant(base.replace("@localhost", "@127.0.0.1"), { database });

    /** A fresh, empty database of this run's own, dropped afterwards. */
    async function freshDatabase(): Promise<string> {
      const name = `cna_ct_${randomBytes(4).toString("hex")}`;
      expect(await createDatabase(dialect, local(name))).toBeUndefined();
      made.push(name);
      return name;
    }

    async function run(database: string, sql: string) {
      const connection = await connectWithDriver(dialect, local(database));
      try {
        await connection.rows(sql);
      } finally {
        await connection.close();
      }
    }

    afterAll(async () => {
      if (made.length === 0) return;
      const server = await connectWithDriver(dialect, serverUrl(dialect, base));
      try {
        for (const name of made) {
          await server.rows(`DROP DATABASE IF EXISTS ${quote(dialect, name)}`);
        }
      } finally {
        await server.close();
      }
    });

    it("connects, and names the server's version and the database", async () => {
      const result = await testConnection(dialect, base);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.server).toMatch(
        dialect === "postgresql" ? /^PostgreSQL 1[5-9]\./ : /^MySQL 8\./
      );
      expect(result.database).toBe(new URL(base).pathname.slice(1));
    });

    it("says the server can't be reached when nothing listens", async () => {
      const result = await testConnection(
        dialect,
        variant(base, { port: "1" })
      );
      expect(result).toMatchObject({ ok: false, cause: "unreachable" });
    });

    it("says the login was refused, naming no user or password", async () => {
      const wrong = "Wr0ng-Pa55word";
      const result = await testConnection(
        dialect,
        variant(base, { password: wrong })
      );
      expect(result).toMatchObject({ ok: false, cause: "login-refused" });
      if (result.ok) return;
      expect(result.message).not.toContain(wrong);
      expect(result.message).not.toContain(new URL(base).username);
    });

    it("says a missing database is missing, offers to create it here, and creates it", async () => {
      const name = `cna_ct_${randomBytes(4).toString("hex")}`;
      const missing = await testConnection(dialect, local(name));
      expect(missing).toMatchObject({
        ok: false,
        cause: "database-missing",
        database: name,
        canCreate: true,
      });
      expect(await createDatabase(dialect, local(name))).toBeUndefined();
      made.push(name);
      expect(await testConnection(dialect, local(name))).toMatchObject({
        ok: true,
        database: name,
      });
    });

    it("reports an empty database as empty, unrelated tables as other, and a Nextly site's as nextly", async () => {
      const empty = await freshDatabase();
      const emptyResult = await testConnection(dialect, local(empty));
      expect(emptyResult.ok && emptyResult.existingTables).toBeUndefined();

      const other = await freshDatabase();
      await run(other, "CREATE TABLE orders (id INT PRIMARY KEY)");
      expect(await testConnection(dialect, local(other))).toMatchObject({
        ok: true,
        existingTables: "other",
      });

      const site = await freshDatabase();
      await run(site, "CREATE TABLE orders (id INT PRIMARY KEY)");
      await run(site, "CREATE TABLE nextly_schema_events (id INT PRIMARY KEY)");
      expect(await testConnection(dialect, local(site))).toMatchObject({
        ok: true,
        existingTables: "nextly",
      });
    });
  });
}
