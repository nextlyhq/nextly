/**
 * Introspection must read the table the WRITES hit, not one named `public`.
 *
 * Every statement this package emits is unqualified — the DDL that created the
 * tables and the DDL the diff generates — so PostgreSQL resolves it across the
 * whole `search_path`. A read filtered on a schema NAME asks a different
 * question, and the answers diverge exactly where it matters: a deployment whose
 * search path is `tenant, public`.
 *
 * Only a real database can establish this. The predicate is SQL the server
 * evaluates, and every failure mode is silent — columns that exist read as
 * absent, so the diff proposes to add what is already there; or a same-named
 * table in another schema answers for this one.
 *
 * 🔴 A DECOY, not an empty schema. Pointing the search path somewhere empty
 * would prove only that something was found somewhere; a test that cannot tell
 * "read the right table" from "read any table" passes on a predicate that names
 * `public` outright.
 *
 * The fixture tables are SYNTHETIC: a decoy and a subject that exist only to be
 * resolved, with no production counterpart. Written out here rather than derived
 * from a table the product also defines, because deriving them would tie this
 * file to that table's shape — and what it measures is which relation a name
 * resolves to, which any two columns can demonstrate.
 *
 * 🔴 ONE SESSION, held open for the whole file. `PostgresAdapter.getDrizzle()`
 * wraps a `pg.Pool`, so `SET search_path` binds to whichever client served that
 * statement and the next `execute()` may run on another — which would make this
 * file assert against the decoy at random. A `Client` is one connection by
 * construction, so the search path this sets is the one every read below uses.
 *
 * @module domains/schema/pipeline/diff/__tests__/introspect-search-path.integration
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { queryLiveColumnTypes } from "../../live-column-types";
import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_POSTGRES_URL ?? "";

// Dialect gate, matching the other PostgreSQL integration tests in this package.
const describePg = describe.skipIf(!URL);

const TENANT = "nx_search_path_probe";
const TABLE = "nx_search_path_subject";
// Uppercase on purpose: `resolveCollectionTableName` passes an author's `dbName`
// through verbatim, so a real table can carry capitals — and an unquoted name
// handed to `to_regclass` is folded to lower case and resolves to nothing.
const MIXED_CASE = "nx_SearchPath_Mixed";

describePg("introspection follows the search path (postgres)", () => {
  let client: Client | undefined;
  // Typed from the call rather than from `typeof drizzle`, whose default
  // overload infers a Pool-backed client and does not accept this one.
  let db: ReturnType<typeof drizzle<Record<string, never>, Client>>;

  beforeAll(async () => {
    if (!URL) return;
    client = new Client({ connectionString: URL });
    await client.connect();
    db = drizzle({ client });

    // 🔴 Sent through Drizzle rather than through the driver, because these
    // statements establish the session state the assertions depend on: the
    // `SET search_path` below has to land on the connection the reads use, and
    // the only way to be sure of that is to send it the way the reads are sent.
    const run = (text: string) => db.execute(sql.raw(text));

    await run(`DROP TABLE IF EXISTS public."${TABLE}"`);
    await run(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`);
    await run(`CREATE SCHEMA ${TENANT}`);

    // The decoy, in `public`: same name, a column the real one does not have.
    // A read pinned to `public` finds THIS one and reports its shape.
    await run(`CREATE TABLE public."${TABLE}" (decoy_only integer)`);
    // The subject, in the tenant schema, carrying a different column.
    await run(`CREATE TABLE ${TENANT}."${TABLE}" (subject_only text)`);
    await run(`CREATE INDEX ix_subject ON ${TENANT}."${TABLE}" (subject_only)`);
    // And one whose name survives only if it is quoted before it is resolved.
    await run(`CREATE TABLE ${TENANT}."${MIXED_CASE}" (mixed_only text)`);

    // What a deployment on a non-default search path looks like.
    await run(`SET search_path TO ${TENANT}, public`);
  });

  afterAll(async () => {
    if (client === undefined) return;
    await db.execute(sql.raw(`SET search_path TO public`));
    await db.execute(sql.raw(`DROP TABLE IF EXISTS public."${TABLE}"`));
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`));
    // The connection itself is still the client's to close: it is what pins the
    // session, so nothing above can release it.
    await client.end();
  });

  it("proves the session is the one that was configured", async () => {
    // The control for every assertion below. If the search path were not the
    // one set in `beforeAll` — a pooled connection, a reset — the decoy would
    // answer and the failures would look like defects in the predicate.
    const shown = await db.execute(sql`SHOW search_path`);
    const rows = (shown as unknown as { rows: { search_path: string }[] }).rows;
    expect(rows[0]?.search_path).toContain(TENANT);
  });

  it("reads the columns of the table an unqualified write would hit", async () => {
    const live = await introspectLiveSnapshot(db, "postgresql", [TABLE]);
    const columns = live.tables
      .find(t => t.name === TABLE)
      ?.columns.map(c => c.name);

    expect(columns).toEqual(["subject_only"]);
    // Named separately: the decoy's column appearing IS the defect, and saying
    // so makes a failure readable rather than a diff of two arrays.
    expect(columns).not.toContain("decoy_only");
  });

  it("reads the indexes of that table, not a same-named one elsewhere", async () => {
    const live = await introspectLiveSnapshot(db, "postgresql", [TABLE]);
    const indexes = live.tables.find(t => t.name === TABLE)?.indexes ?? [];

    // The decoy carries no index, so a read pinned to `public` reports none —
    // which reads as "this table has no indexes" rather than as an error.
    expect(indexes.map(i => i.name)).toContain("ix_subject");
  });

  it("resolves a table whose name carries capitals", async () => {
    // 🔴 `to_regclass` reparses its argument as an identifier reference, so an
    // unquoted `nx_SearchPath_Mixed` folds to lower case and resolves to
    // nothing — and the table reads as ABSENT, which makes a diff propose to
    // create one that already exists.
    const live = await introspectLiveSnapshot(db, "postgresql", [MIXED_CASE]);
    const columns = live.tables
      .find(t => t.name === MIXED_CASE)
      ?.columns.map(c => c.name);

    expect(columns).toEqual(["mixed_only"]);
  });

  it("reports live column TYPES from the same table", async () => {
    // A second query with the same predicate, feeding the type diff. Pinned to
    // `public` it answers for the decoy: a column the subject does not have,
    // and none of the ones it does.
    const types = await queryLiveColumnTypes(db, "postgresql", [TABLE]);
    const forTable = types.get(TABLE);

    expect(forTable?.get("subject_only")).toBe("text");
    expect(forTable?.has("decoy_only")).toBe(false);
  });
});
