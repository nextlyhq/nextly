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
 * evaluates, and every failure mode here is silent — columns that exist read as
 * absent, so the diff proposes to add what is already there; or a same-named
 * table in another schema answers for this one, so the diff compares against a
 * table nothing writes to.
 *
 * 🔴 The second case is why this file creates a DECOY. Pointing the search path
 * at an empty schema would prove only that something was found somewhere; a test
 * that cannot tell "read the right table" from "read any table" passes on a
 * predicate that names `public` outright.
 *
 * @module domains/schema/pipeline/diff/__tests__/introspect-search-path.integration
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../../../database/factory";
import { queryLiveColumnTypes } from "../../live-column-types";
import { introspectLiveSnapshot } from "../introspect-live";

const URL = process.env.TEST_POSTGRES_URL ?? "";

// Dialect gate, matching the other PostgreSQL integration tests in this package.
const describePg = describe.skipIf(!URL);

const TENANT = "nx_search_path_probe";
const TABLE = "nx_search_path_subject";

describePg("introspection follows the search path (postgres)", () => {
  let db: Awaited<ReturnType<typeof createAdapter>> | undefined;
  // Typed through the one call site that needs a shape: `execute` is what the
  // fixture statements below use, and `introspectLiveSnapshot` takes `unknown`.
  let drizzle: { execute: (q: unknown) => Promise<unknown> };

  beforeAll(async () => {
    if (!URL) return;
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = URL;
    db = await createAdapter({
      type: "postgresql",
      url: URL,
    } as Parameters<typeof createAdapter>[0]);
    drizzle = db.getDrizzle() as typeof drizzle;

    const run = (text: string) => drizzle.execute(sql.raw(text));

    await run(`DROP TABLE IF EXISTS public.${TABLE}`);
    await run(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`);
    await run(`CREATE SCHEMA ${TENANT}`);

    // The decoy, in `public`: same table name, a column the real one does not
    // have. A read pinned to `public` finds THIS one and reports its shape.
    await run(`CREATE TABLE public.${TABLE} (decoy_only integer)`);
    // The subject, in the tenant schema, carrying a different column.
    await run(`CREATE TABLE ${TENANT}.${TABLE} (subject_only text)`);
    await run(`CREATE INDEX ix_subject ON ${TENANT}.${TABLE} (subject_only)`);

    // What a deployment on a non-default search path looks like. Set on the
    // connection, which is what an unqualified statement reads.
    await run(`SET search_path TO ${TENANT}, public`);
  });

  afterAll(async () => {
    if (db === undefined) return;
    const run = (text: string) => drizzle.execute(sql.raw(text));
    await run(`SET search_path TO public`);
    await run(`DROP TABLE IF EXISTS public.${TABLE}`);
    await run(`DROP SCHEMA IF EXISTS ${TENANT} CASCADE`);
    await db.disconnect?.();
  });

  it("reads the columns of the table an unqualified write would hit", async () => {
    const live = await introspectLiveSnapshot(drizzle, "postgresql", [TABLE]);
    const columns = live.tables
      .find(t => t.name === TABLE)
      ?.columns.map(c => c.name);

    expect(columns).toEqual(["subject_only"]);
    // Stated as its own expectation rather than left to the equality above: the
    // decoy's column appearing is the specific defect, and naming it is what
    // makes a failure readable.
    expect(columns).not.toContain("decoy_only");
  });

  it("reads the indexes of that table, not a same-named one elsewhere", async () => {
    const live = await introspectLiveSnapshot(drizzle, "postgresql", [TABLE]);
    const indexes = live.tables.find(t => t.name === TABLE)?.indexes ?? [];

    // The decoy carries no index, so a read pinned to `public` reports none —
    // which reads as "this table has no indexes" rather than as an error.
    expect(indexes.map(i => i.name)).toContain("ix_subject");
  });

  it("reports live column TYPES from the same table", async () => {
    // `liveColumnTypes` is a second query with the same predicate, and it feeds
    // the type diff. Pinned to `public` it answers for the decoy: a column the
    // subject does not have, and none of the ones it does.
    const types = await queryLiveColumnTypes(drizzle, "postgresql", [TABLE]);
    const forTable = types.get(TABLE);

    expect(forTable?.get("subject_only")).toBe("text");
    expect(forTable?.has("decoy_only")).toBe(false);
  });
});
