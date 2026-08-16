/**
 * Which type MODIFIER the snapshot records, read from real servers.
 *
 * A declared width is part of what a column does — `varchar(32)` rejects what `varchar(255)`
 * accepts — and `type` cannot carry it: `normalizeType` strips modifiers so the live and desired
 * sides compare equal, and PostgreSQL's `udt_name` never reports one in the first place. So the
 * modifier is recorded separately, and this suite is what proves the reading is right.
 *
 * 🔴 The cases that matter are the NEGATIVE ones, and they are why this must run against servers.
 * Both report a precision for types that were never declared with one, and reading those as
 * modifiers would compare a fabricated width against a generator that emits none:
 *
 * - PostgreSQL 17: `integer` reports numeric_precision 32, `double precision` reports 53.
 * - MySQL 8: a `TEXT` column reports CHARACTER_MAXIMUM_LENGTH 65535, while its `COLUMN_TYPE` is a
 *   bare `text`.
 *
 * No fixture would have shown either. Each dialect is therefore read from the source that reports
 * the DECLARATION — `COLUMN_TYPE` and `PRAGMA table_info.type` carry it already; PostgreSQL has no
 * equivalent, so it is reconstructed from the two families that genuinely take a modifier.
 *
 * Self-skips per dialect on the standard rule.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../introspect-live";
import type { ColumnSpec } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const TABLE = "nextly_typemod_probe";

/**
 * The column list per dialect, spelled as each one declares these types, with what the snapshot
 * must report. `undefined` means "no modifier" — those are the negative controls.
 */
const PER_DIALECT: Record<
  string,
  { ddl: string; expected: ReadonlyArray<[string, string | undefined]> }
> = {
  postgresql: {
    ddl: `CREATE TABLE "${TABLE}" (a_varchar VARCHAR(255), a_decimal NUMERIC(10,2), a_text TEXT, a_double DOUBLE PRECISION, a_int INTEGER)`,
    expected: [
      ["a_varchar", "255"],
      ["a_decimal", "10,2"],
      ["a_text", undefined],
      ["a_double", undefined],
      ["a_int", undefined],
    ],
  },
  mysql: {
    ddl: `CREATE TABLE \`${TABLE}\` (a_varchar VARCHAR(255), a_decimal DECIMAL(10,2), a_text TEXT, a_double DOUBLE, a_int INT)`,
    expected: [
      ["a_varchar", "255"],
      ["a_decimal", "10,2"],
      ["a_text", undefined],
      ["a_double", undefined],
      ["a_int", undefined],
    ],
  },
  sqlite: {
    // SQLite stores the declaration verbatim, so a modifier survives even where the type has no
    // meaning attached to it. Nothing this codebase generates carries one on SQLite — the creator
    // maps varchar() to TEXT — so the modifier is reported when declared and absent otherwise.
    ddl: `CREATE TABLE "${TABLE}" (a_varchar VARCHAR(255), a_decimal NUMERIC(10,2), a_text TEXT, a_double REAL, a_int INTEGER)`,
    expected: [
      ["a_varchar", "255"],
      ["a_decimal", "10,2"],
      ["a_text", undefined],
      ["a_double", undefined],
      ["a_int", undefined],
    ],
  },
};

for (const dialect of getConfiguredTestDialects()) {
  const spec = PER_DIALECT[dialect];
  if (!spec) continue;

  describe(`type modifiers — ${dialect}`, () => {
    it("records a declared modifier and invents none for types without one", async () => {
      current = await createTestNextly({ dialect });
      await current.adapter.executeQuery(spec.ddl);

      const snapshot = await introspectLiveSnapshot(
        current.adapter.getDrizzle(),
        dialect,
        [TABLE]
      );
      const table = snapshot.tables.find(t => t.name === TABLE);

      // The POPULATION first: an empty column list satisfies every per-column assertion below,
      // and an introspection that silently read nothing is exactly the failure that would hide.
      expect(table?.columns.map(c => c.name).sort()).toEqual(
        spec.expected.map(([name]) => name).sort()
      );

      const byName = new Map<string, ColumnSpec>(
        (table?.columns ?? []).map(c => [c.name, c])
      );
      // Asserted as a whole map rather than per column, so a reader sees which one drifted.
      expect(
        spec.expected.map(([name]) => [name, byName.get(name)?.typeModifier])
      ).toEqual(spec.expected.map(([name, modifier]) => [name, modifier]));
    });
  });
}
