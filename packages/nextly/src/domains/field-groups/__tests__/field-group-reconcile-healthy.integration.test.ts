/**
 * A HEALTHY field group must reconcile to "nothing to repair", on every dialect and every field type.
 *
 * ## Why this test is the boundary rather than one more case
 *
 * The planner decides whether a stored definition still describes its tables. Every attribute it
 * compares — physical type, nullability, indexes, placement — is an independent chance to disagree
 * with the code that ACTUALLY creates those tables (`FieldGroupSchemaService`), and each such
 * disagreement is a false "this group is damaged" on a group that is perfectly fine. That failure
 * is worse than a missed repair: it refuses the one operation an operator runs to get out of
 * trouble.
 *
 * Reviewing attribute-by-attribute cannot catch it, because the mistake is always a spelling the
 * reviewer also believes. The measurement that catches it is this one: create a group through the
 * real creator, introspect the real tables, and require the planner to report NO changes and NO
 * blockers. Anything it reports here is by construction false, because nothing has drifted.
 *
 * 🔴 Two creators have built these tables, and they spell some columns differently. A Builder
 * create now builds its table through the save writer's migration, from the column descriptor; the
 * creator before it gave a PostgreSQL `email` `VARCHAR(255)` where the descriptor gives `text`, and a
 * MySQL `date` `DATETIME` where it gives `timestamp`. Tables of both kinds exist, so the planner
 * accepts either spelling and nothing else: the planted cases below hold each half of that.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { indexNameForColumn } from "../../schema/services/index-name";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";

let current: TestNextly | undefined;

// A field group's Builder create builds its table in development only; anywhere else it writes the
// migration for the deploy's `nextly migrate` and records the group pending, with no table. These
// cases judge the table a create leaves, so they run as a development server does. `vi.stubEnv`
// rather than assigning: `NODE_ENV` is declared read-only.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

/**
 * One field per storage shape the creator can emit, because the defect is per-shape.
 *
 * Deliberately includes the pairs that collapse to one physical column — `text`/`email`/`textarea`
 * all land on text-like storage — since preserving the DECLARED type across a reconcile is the
 * property the whole operation exists to protect.
 */
const EVERY_SHAPE = [
  { name: "a_text", type: "text" },
  { name: "a_email", type: "email" },
  { name: "a_textarea", type: "textarea" },
  { name: "a_number", type: "number" },
  // A number's storage is decided by `options.format`, not by its type alone: this one is
  // floating-point where `a_number` above is an integer, and the two are separate column types on
  // every dialect. Listing only the integer form leaves the whole floating-point branch of the
  // creator unexercised, which is a storage shape rather than a variation of one already covered.
  { name: "a_float", type: "number", options: { format: "float" } },
  { name: "a_checkbox", type: "checkbox" },
  { name: "a_date", type: "date" },
  { name: "a_json", type: "json" },
  // A short id string whose column the creator takes from the column descriptor rather than its
  // own type map: `text` on PostgreSQL and SQLite, `varchar(255)` on MySQL.
  { name: "a_icon", type: "icon" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a healthy field group reconciles to no-op — ${dialect}`, () => {
    it("reports no changes and no blockers for every field shape", async () => {
      current = await createTestNextly({ dialect });
      const slug = `healthy_${dialect.slice(0, 2)}`;

      await current.nextly.fieldGroups.create({
        slug,
        label: "Healthy",
        fields: EVERY_SHAPE,
      });

      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      const report = await reconcileFieldGroup({
        registry: current.getService("fieldGroupRegistryService"),
        adapter: current.adapter,
        logger: current.getService("logger"),
        slug,
      });

      // 🔴 Asserted by IDENTITY, not by count. A bare `unchanged === true` would hide WHICH field
      // the planner misread, and the field name is the whole diagnostic when this fails.
      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.adopted.map(a => a.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });

    // 🔴 WHAT THIS FILE DOES NOT ESTABLISH: the LOCALIZED case. A group whose translatable columns
    // live in the `_locales` companion is a separate chance for the planner to disagree with the
    // creator — the companion's columns are rendered by a different path (`fieldToLocalizedColumnSpec`
    // + `ddlType`) than the main table's. It is absent here because `fieldGroups.create()` takes no
    // `localized` argument and enabling it afterwards is gated on app-level localization config the
    // harness does not declare; a fixture that created the row without moving the columns would
    // never reach the mechanism, and would pass while proving nothing. Stated rather than faked,
    // and the expectation map covers the companion so the check itself is wired for it.
  });
}

/**
 * One column per server planted in the spelling the creator before the Builder's save writer gave
 * it, which reconcile accepts, and in a third spelling, which it still refuses. SQLite is not asked:
 * both creators spell these columns alike there.
 */
const PLANTED = {
  postgresql: {
    field: "a_email",
    earlier: "ALTER TABLE {t} ALTER COLUMN a_email TYPE varchar(255)",
    third: "ALTER TABLE {t} ALTER COLUMN a_email TYPE integer USING NULL",
  },
  mysql: {
    field: "a_date",
    earlier: "ALTER TABLE {t} MODIFY a_date DATETIME NULL",
    third: "ALTER TABLE {t} MODIFY a_date INT NULL",
  },
} as const;

for (const dialect of getConfiguredTestDialects()) {
  if (dialect === "sqlite") continue;
  const planted = PLANTED[dialect];
  describe(`a field group's column in another spelling — ${dialect}`, () => {
    /** A healthy group with one column then altered by `statement`, and the reconcile's answer. */
    async function reconcileAfter(statement: string) {
      current = await createTestNextly({ dialect });
      const slug = `planted_${dialect.slice(0, 2)}`;
      await current.nextly.fieldGroups.create({
        slug,
        label: "Planted",
        fields: EVERY_SHAPE,
      });
      await current.adapter.executeQuery(
        statement.replace("{t}", resolveComponentTableName(slug))
      );
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      return reconcileFieldGroup({
        registry: current.getService("fieldGroupRegistryService"),
        adapter: current.adapter,
        logger: current.getService("logger"),
        slug,
      });
    }

    it("accepts the spelling the creator before the Builder's save writer gave", async () => {
      const report = await reconcileAfter(planted.earlier);

      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.unchanged).toBe(true);
    });

    it("refuses a spelling neither creator gives, naming the field", async () => {
      await expect(reconcileAfter(planted.third)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining(`"${planted.field}" is declared`),
      });
    });
  });
}

/**
 * Fields whose index or default the generator decides beyond the flag the field carries.
 *
 * A single reference is indexed whether or not it declares `index`, by the rule the desired table
 * and the creator share, so the undeclared index on `a_ref` is part of a healthy table. A Builder
 * save writes no column DEFAULT for a user field (the default is filled when an instance is saved),
 * so `a_flag` has none on the table even though its field declares one. `a_count` asks for nothing,
 * and is the control for the index cases below.
 */
const GENERATOR_DECIDED = [
  { name: "a_ref", type: "relationship", relationTo: "users" },
  { name: "a_flag", type: "checkbox", defaultValue: true },
  { name: "a_count", type: "number" },
];

/** The statement that changes `a_flag`'s column DEFAULT, on the servers that can alter one in place. */
const SET_FLAG_DEFAULT: Partial<Record<string, string>> = {
  postgresql: "ALTER TABLE {t} ALTER COLUMN a_flag SET DEFAULT false",
  mysql: "ALTER TABLE {t} ALTER COLUMN a_flag SET DEFAULT 0",
};

/** The statement that drops the index `name` from `{t}`, as each dialect spells it. */
function dropIndexSql(dialect: string, name: string): string {
  return dialect === "mysql"
    ? `DROP INDEX ${name} ON {t}`
    : `DROP INDEX "${name}"`;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a Builder field group's generator-decided index and default — ${dialect}`, () => {
    const slug = `decided_${dialect.slice(0, 2)}`;
    const table = resolveComponentTableName(slug);

    /** A Builder-made group with the fields above, altered by `statements`, and its reconcile. */
    async function reconcileAfter(...statements: string[]) {
      current = await createTestNextly({ dialect });
      await current.nextly.fieldGroups.create({
        slug,
        label: "Decided",
        fields: GENERATOR_DECIDED,
      });
      for (const statement of statements) {
        await current.adapter.executeQuery(statement.replaceAll("{t}", table));
      }
      const { reconcileFieldGroup } = await import(
        "../services/field-group-reconcile-service"
      );
      return reconcileFieldGroup({
        registry: current.getService("fieldGroupRegistryService"),
        adapter: current.adapter,
        logger: current.getService("logger"),
        slug,
      });
    }

    it("reports nothing to repair for a single reference and a checkbox default", async () => {
      const report = await reconcileAfter();

      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.adopted.map(a => a.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });

    // The break-checks: each of these is a table that no longer matches the definition, and the
    // healthy answer above must not have been bought by ceasing to look.
    it("still records an index the definition does not ask for", async () => {
      const report = await reconcileAfter(
        `CREATE INDEX extra_${slug}_count ON {t} (a_count)`
      );

      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        ["a_count.index"]
      );
    });

    it("refuses a single reference whose index is gone, naming the field", async () => {
      await expect(
        reconcileAfter(
          dropIndexSql(dialect, indexNameForColumn(table, "a_ref"))
        )
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining('"a_ref"'),
      });
    });

    const setDefault = SET_FLAG_DEFAULT[dialect];
    // SQLite cannot change a column's DEFAULT without rebuilding the table, so it is asked only on
    // the servers.
    it.skipIf(setDefault === undefined)(
      "refuses a checkbox column whose default differs from the declared one",
      async () => {
        await expect(reconcileAfter(setDefault ?? "")).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining('"a_flag"'),
        });
      }
    );
  });
}
