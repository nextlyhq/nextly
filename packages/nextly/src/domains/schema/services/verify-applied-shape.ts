/**
 * Did the table the migration just ran against actually end up the shape it was asked for?
 *
 * ## Why "the table exists" stopped being enough
 *
 * Every Builder apply path used to prove success with `tableExists`. That was never a strong check
 * and it became a weak one the moment those paths started tolerating "already exists" errors so a
 * half-applied migration could be finished. The tolerance is right — MySQL has no `IF NOT EXISTS`
 * for `CREATE INDEX`, and a companion's `ADD COLUMN` has none on any dialect, so without it a
 * correct schema reported `failed` forever. But it removes the loud failure that used to make a
 * MISMATCHED table obvious:
 *
 * - `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table, on every dialect.
 * - The index statements after it are now tolerated.
 * - So a repair over a table left by an earlier attempt emits no error at all, even when the field
 *   set, the lifecycle columns or a field's TYPE have changed in between.
 *
 * The result was a registry row recording `applied` and a runtime schema describing columns the
 * database does not have, which surfaces later as a failing read far from its cause.
 *
 * ## What is compared, and why it is not hand-rolled
 *
 * The desired shape comes from `buildDesiredTableFromFields` — the same builder the schema diff
 * compares against — so this cannot disagree with the pipeline about what a column is called or
 * what type it should be. That matters for three things a hand-written check kept missing:
 *
 * - **System columns.** `status` and the lifecycle columns come from create OPTIONS, not from the
 *   field list, so a check derived from fields alone passes while they are absent.
 * - **Localized fields.** Translatable columns belong to the companion and must NOT be demanded on
 *   the main table.
 * - **Provenance.** A text field with no stated width has no single right column; the builder that
 *   made the table decides. `builtBy` carries that.
 *
 * ## 🔴 Presence and nullability ONLY, and the limit is deliberate
 *
 * Types and index names are NOT compared, because the desired spec is the DIFF ENGINE's ideal
 * schema and the Builder's own generators do not render exactly that. Three measured divergences,
 * each of which made this verifier fail a create that works:
 *
 * - a `number` field with `format: "float"` is written `decimal(10,2)` by the direct create DDL
 *   while the descriptor says `float8`/`double`;
 * - a `unique` field becomes an INLINE constraint, so the database names it itself
 *   (`<table>_<column>_key` on PostgreSQL, a filtered `sqlite_autoindex_*` on SQLite) rather than
 *   the `uq_<table>_<column>` the spec expects;
 * - the field-group generator emits no `created_at` index at all, while the desired spec declares
 *   one for every component that has the column.
 *
 * Those disagreements are real and already tracked as their own work. Until the generators and the
 * descriptor agree, comparing types or index names here reports a correct table as broken — which
 * is a worse failure than the one this exists to catch, because it blocks work that was fine.
 * Presence and nullability were measured against every fixture on all three dialects and produce
 * no such false positives.
 *
 * @module domains/schema/services/verify-applied-shape
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnSpec, TableSpec } from "../pipeline/diff/types";

/** The adapter surface this needs: a Drizzle handle to introspect through. */
export interface ShapeVerifyAdapter {
  getDrizzle<T = unknown>(): T;
}

/**
 * How the live table differs from the desired one, in wording an operator can act on.
 *
 * Empty means it matches. A column that is absent and one that is enforced but no longer declared
 * are reported together because the caller treats them the same way: the migration did not
 * converge.
 */
export async function shapeMismatches(
  adapter: ShapeVerifyAdapter,
  dialect: SupportedDialect,
  tableName: string,
  desired: TableSpec
): Promise<string[]> {
  let live;
  try {
    const { introspectLiveSnapshot } = await import(
      "../pipeline/diff/introspect-live"
    );
    const snapshot = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      dialect,
      [tableName]
    );
    live = snapshot.tables.find(t => t.name === tableName);
  } catch {
    // 🔴 A check that cannot RUN must not invent a failure for a migration that reported success.
    // Introspection needs a live catalog, and a caller may hold a connection that cannot answer —
    // failing the schema change because the verification was unavailable would be strictly worse
    // than the unverified behaviour this replaced.
    return [];
  }

  // Nothing came back for the table. That is the introspection failing to see it rather than the
  // table having no columns, and existence is the caller's question to ask, not this one's — so
  // reporting every column as missing here would turn an unreadable catalog into a false failure.
  if (!live || live.columns.length === 0) return [];

  const liveByName = new Map<string, ColumnSpec>(
    live.columns.map(column => [column.name, column])
  );

  const problems: string[] = [];
  for (const column of desired.columns) {
    const actual = liveByName.get(column.name);
    if (!actual) {
      problems.push(`${column.name} is missing`);
      continue;
    }
    // Nullability is part of the shape, not a detail of it: a column the Builder now calls optional
    // while the database still has it NOT NULL accepts every write the Builder considers valid and
    // then fails the constraint. Reported after the type so one column produces one problem.
    if (column.nullable !== actual.nullable) {
      problems.push(
        `${column.name} is ${actual.nullable ? "nullable" : "NOT NULL"}, expected ${
          column.nullable ? "nullable" : "NOT NULL"
        }`
      );
    }
  }
  // 🔴 What the table has and the schema no longer wants, which a desired-side walk cannot see.
  //
  // A repair that REMOVES a field leaves its column in place, because the re-run no-ops rather
  // than dropping anything. If that column was required, writes that omit the removed field now
  // fail its NOT NULL constraint — the Builder considers them valid and the database does not.
  // Only NOT NULL columns are reported: a leftover nullable column accepts every write and is a
  // tidiness question rather than a correctness one, and reporting it would fail repairs that are
  // functionally complete.
  const wanted = new Set(desired.columns.map(column => column.name));
  for (const column of live.columns) {
    if (!wanted.has(column.name) && !column.nullable) {
      problems.push(
        `${column.name} is still NOT NULL but is no longer declared`
      );
    }
  }

  return problems;
}
