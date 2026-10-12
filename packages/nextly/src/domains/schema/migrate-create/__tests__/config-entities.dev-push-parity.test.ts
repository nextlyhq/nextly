/**
 * `migrate:create` / `migrate:check` and dev push describe the same tables.
 *
 * Dev push builds each table from the config's fields as declared. The two
 * migration commands go through `toMinimalEntities` first, and every key that
 * step fails to carry is a column one path builds and the other does not. A
 * `virtual` field is the sharpest case: it stores nothing, so a column for it
 * is NOT NULL when the field is required, and every create then fails.
 *
 * Each entity kind is checked, because singles and components share the
 * reduction with collections.
 */
import { describe, expect, it } from "vitest";

import { defineCollection } from "../../../../collections/config/define-collection";
import { group, text } from "../../../../collections/fields/helpers";
import { defineFieldGroup } from "../../../../field-groups/config/define-field-group";
import { defineSingle } from "../../../../singles/config/define-single";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "../../pipeline/diff/build-from-fields";
import type { TableSpec } from "../../pipeline/diff/types";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { buildDesiredSnapshotFromConfig } from "../generate";

// A required virtual text field, a virtual group under each spelling the
// virtual predicate reads (root flag, and the group's `options.virtual`), and
// an ordinary field as the control that columns are produced at all.
const fields = [
  text({ name: "headline" }),
  text({ name: "readingTime", virtual: true, required: true }),
  group({
    name: "computed",
    virtual: true,
    fields: [text({ name: "score" })],
  }),
  {
    ...group({ name: "legacyComputed", fields: [text({ name: "score" })] }),
    options: { virtual: true },
  },
];

const collection = defineCollection({ slug: "articles", fields });
const single = defineSingle({ slug: "site-settings", fields });
const component = defineFieldGroup({ slug: "hero-card", fields });

function migrationTables(): TableSpec[] {
  return buildDesiredSnapshotFromConfig(
    toMinimalEntities([collection], e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    toMinimalEntities([single], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
    toMinimalEntities([component], e => resolveComponentTableName(e.slug)),
    "sqlite"
  ).tables;
}

// What dev push builds: the same builders, handed the declared fields.
function devPushTables(): TableSpec[] {
  const asBuilderFields = (declared: unknown) =>
    declared as Parameters<typeof buildDesiredTableFromFields>[1];
  return [
    buildDesiredTableFromFields(
      resolveCollectionTableName(collection.slug, collection.dbName),
      asBuilderFields(collection.fields),
      "sqlite",
      { builtBy: "codeFirst" }
    ),
    buildDesiredTableFromFields(
      resolveSingleTableName({ slug: single.slug, dbName: single.dbName }),
      asBuilderFields(single.fields),
      "sqlite",
      { builtBy: "codeFirst" }
    ),
    buildDesiredTableFromComponentFields(
      resolveComponentTableName(component.slug),
      asBuilderFields(component.fields),
      "sqlite",
      { builtBy: "codeFirst" }
    ),
  ];
}

const columnsOf = (tables: TableSpec[]) =>
  Object.fromEntries(
    tables.map(table => [
      table.name,
      table.columns.map(c => `${c.name}:${c.type}:${c.nullable}`).sort(),
    ])
  );

describe("migrate:create and dev push build the same columns", () => {
  it("for a collection, a single and a component with virtual fields", () => {
    const migration = migrationTables();
    expect(migration.map(t => t.name).sort()).toEqual(
      devPushTables()
        .map(t => t.name)
        .sort()
    );
    expect(columnsOf(migration)).toEqual(columnsOf(devPushTables()));
  });

  it("gives no virtual field a column, and still gives the ordinary one", () => {
    for (const table of migrationTables()) {
      const names = table.columns.map(c => c.name);
      expect(names, table.name).toContain("headline");
      expect(names, table.name).not.toContain("reading_time");
      expect(names, table.name).not.toContain("computed");
      expect(names, table.name).not.toContain("legacy_computed");
    }
  });
});
