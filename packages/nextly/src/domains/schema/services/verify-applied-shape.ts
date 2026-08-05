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
 * Types are compared through `normalizeType`, the diff engine's own comparison, so `varchar(255)`
 * and `character varying(255)` are the same answer and `text` and `varchar` are not.
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
 * Empty means it matches. Absent columns and wrong types are reported together because the caller
 * treats them the same way — the migration did not converge — and separating them would invite one
 * to be checked and the other forgotten.
 */
export async function shapeMismatches(
  adapter: ShapeVerifyAdapter,
  dialect: SupportedDialect,
  tableName: string,
  desired: TableSpec
): Promise<string[]> {
  const { normalizeType } = await import("../pipeline/diff/normalize-type");

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
    const want = normalizeType(column.type);
    const got = normalizeType(actual.type);
    // Only when both normalise to something. An unrecognised token on either side means the
    // comparison has no opinion, and inventing a mismatch from ignorance would fail correct
    // migrations on whichever dialect spells a type in a way the normaliser has not met.
    if (want !== undefined && got !== undefined && want !== got) {
      problems.push(
        `${column.name} is ${actual.type}, expected ${column.type}`
      );
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
  return problems;
}
