/**
 * What `migrate:fresh` will DROP, decided by a real PostgreSQL.
 *
 * This command empties a database. Its discovery step chooses the list, and its
 * drop step emits `DROP TABLE "name"` with no schema on it — so discovery is
 * only correct if it returns exactly the relations an unqualified name resolves
 * to. Too few and the reset silently leaves tables behind; too many and it
 * destroys data it was never pointed at.
 *
 * 🔴 A unit test cannot establish this, and the one that tried is why this file
 * exists. Asserting that the rendered SQL contains `to_regclass` stays green
 * when the predicate is inverted to `<>` or joined with `OR` — both of which
 * enumerate the wrong relations. The property that separates a correct
 * implementation from those is WHICH ROWS COME BACK, and only a database can
 * answer it.
 *
 * The fixture is built to make each wrong answer visible:
 *
 * - `shadowed` exists in BOTH schemas. Correct: returned once, and it is the
 *   tenant one the drop would reach.
 * - `tenant_only` is reachable and must be there.
 * - `public_only` is ALSO reachable — `public` is on the path — so it must be
 *   there too. This is the row that fails a `current_schema()` implementation,
 *   which sees only the first entry.
 * - `hidden_only` sits in a schema NOT on the path. Unreachable by the drop, so
 *   returning it would mean destroying a table this command cannot even name.
 *
 * @module cli/commands/__tests__/migrate-fresh-discovery.integration
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverTables } from "../migrate-fresh";

const URL = process.env.TEST_POSTGRES_URL ?? "";

// Dialect gate, matching the other PostgreSQL integration tests in this package.
const describePg = describe.skipIf(!URL);

const TENANT = "nx_discovery_tenant";
const HIDDEN = "nx_discovery_hidden";
const SHADOWED = "nx_discovery_shadowed";
const TENANT_ONLY = "nx_discovery_tenant_only";
const PUBLIC_ONLY = "nx_discovery_public_only";
const HIDDEN_ONLY = "nx_discovery_hidden_only";

describePg(
  "migrate:fresh discovers what the DROP will reach (postgres)",
  () => {
    let client: Client | undefined;
    // Typed from the call rather than from `typeof drizzle`, whose default
    // overload infers a Pool-backed client and does not accept this one.
    let db: ReturnType<typeof drizzle<Record<string, never>, Client>>;

    beforeAll(async () => {
      if (!URL) return;
      // 🔴 One Client, held for the file. `getDrizzle()` wraps a Pool, so
      // `SET search_path` would bind to whichever connection served it and the
      // reads could run on another — the fixture would then be asserting against
      // a session it never configured.
      client = new Client({ connectionString: URL });
      await client.connect();
      db = drizzle({ client });
      const run = (text: string) => db.execute(sql.raw(text));

      await run(`DROP TABLE IF EXISTS public.${SHADOWED}`);
      await run(`DROP TABLE IF EXISTS public.${PUBLIC_ONLY}`);
      await run(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`);
      await run(`DROP SCHEMA IF EXISTS ${HIDDEN} CASCADE`);
      await run(`CREATE SCHEMA ${TENANT}`);
      await run(`CREATE SCHEMA ${HIDDEN}`);

      await run(`CREATE TABLE ${TENANT}.${SHADOWED} (id integer)`);
      await run(`CREATE TABLE public.${SHADOWED} (id integer)`);
      await run(`CREATE TABLE ${TENANT}.${TENANT_ONLY} (id integer)`);
      await run(`CREATE TABLE public.${PUBLIC_ONLY} (id integer)`);
      await run(`CREATE TABLE ${HIDDEN}.${HIDDEN_ONLY} (id integer)`);

      await run(`SET search_path TO ${TENANT}, public`);
    });

    afterAll(async () => {
      if (client === undefined) return;
      await db.execute(sql.raw(`SET search_path TO public`));
      await db.execute(sql.raw(`DROP TABLE IF EXISTS public.${SHADOWED}`));
      await db.execute(sql.raw(`DROP TABLE IF EXISTS public.${PUBLIC_ONLY}`));
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`));
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${HIDDEN} CASCADE`));
      await client.end();
    });

    /** The adapter surface `discoverTables` asks for, backed by this session. */
    function runner() {
      return {
        queryStatement: async <T>(statement: unknown): Promise<T[]> => {
          const result = (await db.execute(
            statement as Parameters<typeof db.execute>[0]
          )) as unknown as { rows: T[] };
          return result.rows;
        },
      } as Parameters<typeof discoverTables>[0];
    }

    it("proves the session is the one that was configured", async () => {
      // The control for everything below. A session that had silently reset would
      // fail the assertions in a way that looks like a defect in the predicate.
      const shown = (await db.execute(sql`SHOW search_path`)) as unknown as {
        rows: { search_path: string }[];
      };
      expect(shown.rows[0]?.search_path).toContain(TENANT);
    });

    it("returns every relation the drop can reach, and only those", async () => {
      const found = await discoverTables(runner(), "postgresql");

      expect(found).toContain(TENANT_ONLY);
      // 🔴 On the path through its second entry, so the unqualified DROP reaches
      // it. A `current_schema()` implementation misses this one and leaves the
      // table behind.
      expect(found).toContain(PUBLIC_ONLY);
      // 🔴 Off the path entirely. Returning it would hand a DROP a table this
      // command cannot even name — which is what an inverted or OR-ed predicate
      // does.
      expect(found).not.toContain(HIDDEN_ONLY);
    });

    it("returns a shadowed name once, not once per copy", async () => {
      // 🔴 Two relations share this name; exactly one is what `DROP TABLE
      // "shadowed"` resolves to. Returning both would make the command issue the
      // same statement twice and believe it had dropped two different tables —
      // and the second `IF EXISTS` would quietly succeed having done nothing.
      const found = await discoverTables(runner(), "postgresql");

      expect(found.filter(name => name === SHADOWED)).toHaveLength(1);
    });

    it("never offers a system catalog table to the drop", async () => {
      // `pg_catalog` is on every search path implicitly, so relation visibility
      // alone admits it.
      const found = await discoverTables(runner(), "postgresql");

      expect(found).not.toContain("pg_class");
      expect(found).not.toContain("pg_namespace");
    });
  }
);
