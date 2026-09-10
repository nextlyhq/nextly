/**
 * Which PostgreSQL relation a read is about, decided the way the WRITES decide.
 *
 * Every statement this package emits is unqualified — the DDL that created a
 * table and the DDL a diff generates — so PostgreSQL resolves it across the
 * whole `search_path`. A read that filters on a schema NAME asks a different
 * question, and the two answers separate exactly where it matters: a deployment
 * whose search path is `tenant, public`.
 *
 * 🔴 `current_schema()` is not the answer either. It is only the FIRST entry of
 * the search path, so a table in `public` reached from `tenant, public` is
 * written by the ALTER and missed by the read. `live-table-facts.ts` settled
 * this for the same reason and resolves through `to_regclass`; this is that rule
 * for the reads that go through `information_schema` rather than through an OID.
 *
 * The failures it prevents are silent and point the wrong way. Columns that
 * exist read as absent, so a diff offers to add what is already there. And where
 * a same-named table exists in another schema on the path, ITS shape answers for
 * the real one — so the diff compares against a table nothing writes to.
 *
 * @module domains/schema/pipeline/pg-visible-relation
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * True for the one `information_schema.columns` row set whose relation an
 * unqualified statement would reach.
 *
 * 🔴 Written against the alias `c`, because a predicate over
 * `information_schema` has to name that view's own columns and they cannot be
 * passed as parameters. Every caller aliases the view `c`; there are two, both
 * in this directory, and a caller that aliases it otherwise gets a SQL error
 * rather than a wrong answer — which is the safe direction for a mistake that
 * would otherwise change WHICH TABLE is reported.
 *
 * Compared by identity rather than by spelling: `format('%I.%I', …)::regclass`
 * is this row's relation, `to_regclass(c.table_name)` is the one the search path
 * resolves, and the equality asks whether they are the same relation. The same
 * device the sequence-ownership check in `introspect-live.ts` already uses.
 */
export const PG_RELATION_THE_WRITES_HIT: SQL = sql`format('%I.%I', c.table_schema, c.table_name)::regclass = to_regclass(c.table_name)`;
