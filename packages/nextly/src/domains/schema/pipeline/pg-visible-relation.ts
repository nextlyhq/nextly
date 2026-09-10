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
 * ## Why the name is quoted before it is resolved
 *
 * 🔴 `to_regclass` takes TEXT and reparses it as an identifier reference, so an
 * unquoted catalog name is folded and split exactly as if it had been typed:
 * `dc_LegacyPosts` resolves as `dc_legacyposts`, and a name containing a dot
 * resolves as `schema.table`. Both are reachable — `resolveCollectionTableName`
 * passes an author's `dbName` through verbatim, prefixing `dc_` and nothing
 * else — and both would make an existing table read as ABSENT, which is the
 * worst answer this module can give: a diff that proposes to create a table that
 * is already there.
 *
 * `quote_ident` is the inverse of that parse, so the text goes back in as the
 * one identifier the catalog says it is.
 *
 * @module domains/schema/pipeline/pg-visible-relation
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * True for the one `information_schema` row whose relation an unqualified
 * statement would reach — of `columns` or of `tables` alike, since both name
 * the relation with `table_schema` and `table_name`.
 *
 * 🔴 Written against the alias `c`, because a predicate over
 * `information_schema` has to name that view's own columns and they cannot be
 * passed as parameters. Every caller aliases the view `c`; there are two, both
 * in this directory, and a caller that aliases it otherwise gets a SQL error
 * rather than a wrong answer — which is the safe direction for a mistake that
 * would otherwise change WHICH TABLE is reported.
 *
 * Compared by identity rather than by spelling: `format('%I.%I', …)::regclass`
 * is this row's relation, `to_regclass(…)` is the one the search path resolves,
 * and the equality asks whether they are the same relation. The same device the
 * sequence-ownership check in `introspect-live.ts` already uses.
 */
export const PG_RELATION_THE_WRITES_HIT_SQL = `format('%I.%I', c.table_schema, c.table_name)::regclass = to_regclass(quote_ident(c.table_name))`;

/**
 * The same predicate as a Drizzle fragment, BUILT from the text above rather
 * than written a second time.
 *
 * 🔴 Two spellings of this rule is the defect it exists to prevent, one level
 * up: some readers here compose Drizzle `sql` templates and others hand raw
 * text to the driver, and a rule copied between those forms drifts the first
 * time either is corrected. `sql.raw` over a module constant interpolates
 * nothing — the text is fixed at build time and names only catalog columns —
 * so it carries no injection surface.
 */
export const PG_RELATION_THE_WRITES_HIT: SQL = sql.raw(
  PG_RELATION_THE_WRITES_HIT_SQL
);

/**
 * The same question asked of a `pg_class` row, which carries the OID directly.
 *
 * Spelled here rather than inline at the index query so the two reads cannot
 * drift: they must agree about which relation they are describing, or the
 * columns come from one table and the indexes from another.
 */
export const PG_CLASS_IS_THE_RELATION_THE_WRITES_HIT: SQL = sql`t.oid = to_regclass(quote_ident(t.relname))`;
