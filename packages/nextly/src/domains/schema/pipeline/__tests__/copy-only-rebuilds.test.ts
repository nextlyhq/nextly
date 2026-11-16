// Which drizzle-kit rebuilds of a SQLite table a push may leave out.
//
// Only a rebuild that moves no data: the same table name throughout, the new
// table's columns the live table's exactly (names and types), and an INSERT
// copying every one of them. The statements below are drizzle-kit's own
// spelling of a rebuild, as it emitted one for a field-group table whose live
// `_order` column had no DEFAULT. Every variation that could lose data, or
// that this cannot read, keeps the rebuild, for the destructive-statement
// guard to refuse as before.

import { describe, expect, it } from "vitest";

import { withoutCopyOnlyRebuilds, type LiveTable } from "../copy-only-rebuilds";

const TABLE = "comp_seo";

const liveSeo: LiveTable = {
  columns: [
    { name: "id", type: "text" },
    { name: "_parent_id", type: "text" },
    { name: "_parent_table", type: "text" },
    { name: "_parent_field", type: "text" },
    { name: "_order", type: "integer" },
    { name: "_component_type", type: "text" },
    { name: "og_image", type: "text" },
    { name: "created_at", type: "integer" },
    { name: "updated_at", type: "integer" },
  ],
  indexes: ["idx_comp_seo_parent", "idx_comp_seo_created_at"],
};

const ALL = [
  "id",
  "_parent_id",
  "_parent_table",
  "_parent_field",
  "_order",
  "_component_type",
  "og_image",
  "created_at",
  "updated_at",
];

const quoted = (names: readonly string[]) =>
  names.map(name => `\`${name}\``).join(", ");

/** drizzle-kit's rebuild of the table, with the parts a variation changes. */
function rebuild(
  options: {
    columns?: string;
    into?: readonly string[];
    from?: string;
    renameTo?: string;
  } = {}
): string[] {
  const columns =
    options.columns ??
    `\t\`id\` text PRIMARY KEY,
\t\`_parent_id\` text NOT NULL,
\t\`_parent_table\` text NOT NULL,
\t\`_parent_field\` text NOT NULL,
\t\`_order\` integer DEFAULT 0,
\t\`_component_type\` text,
\t\`created_at\` integer NOT NULL,
\t\`updated_at\` integer NOT NULL,
\t\`og_image\` text`;
  const into = options.into ?? ALL;
  return [
    "PRAGMA foreign_keys=OFF;",
    `CREATE TABLE \`__new_${TABLE}\` (\n${columns}\n);\n`,
    `INSERT INTO \`__new_${TABLE}\`(${quoted(into)}) SELECT ${options.from ?? quoted(into)} FROM \`${TABLE}\`;`,
    `DROP TABLE \`${TABLE}\`;`,
    `ALTER TABLE \`__new_${TABLE}\` RENAME TO \`${options.renameTo ?? TABLE}\`;`,
    "PRAGMA foreign_keys=ON;",
  ];
}

const ADD_COLUMN = "ALTER TABLE `dc_templates` ADD `entry` text;";
const RECREATE_LIVE_INDEX =
  "CREATE INDEX `idx_comp_seo_parent` ON `comp_seo` (`_parent_id`,`_parent_table`,`_parent_field`);";
const live = (table: string) =>
  table.toLowerCase() === TABLE ? liveSeo : undefined;

describe("a drizzle-kit rebuild this push did not approve", () => {
  it("is left out when it copies every column and row onto the same columns", () => {
    const statements = [ADD_COLUMN, ...rebuild(), RECREATE_LIVE_INDEX];

    const result = withoutCopyOnlyRebuilds(statements, new Set(), live);

    expect(result.skipped).toEqual([TABLE]);
    // The rebuild and the index it would add back are gone; the push's own
    // column and the foreign-key pragmas around it remain.
    expect(result.kept).toEqual([
      ADD_COLUMN,
      "PRAGMA foreign_keys=OFF;",
      "PRAGMA foreign_keys=ON;",
    ]);
  });

  it("is kept when its new table drops a live column, as a column drop encoded as a rebuild is", () => {
    const survivors = ALL.filter(name => name !== "og_image");
    const statements = rebuild({
      columns: `\t\`id\` text PRIMARY KEY,
\t\`_parent_id\` text NOT NULL,
\t\`_parent_table\` text NOT NULL,
\t\`_parent_field\` text NOT NULL,
\t\`_order\` integer DEFAULT 0,
\t\`_component_type\` text,
\t\`created_at\` integer NOT NULL,
\t\`updated_at\` integer NOT NULL`,
      into: survivors,
    });

    const result = withoutCopyOnlyRebuilds(statements, new Set(), live);

    expect(result.skipped).toEqual([]);
    expect(result.kept).toEqual(statements);
  });

  it("is kept when the new table has every column but its INSERT leaves one out", () => {
    const statements = rebuild({
      into: ALL.filter(name => name !== "og_image"),
    });

    const result = withoutCopyOnlyRebuilds(statements, new Set(), live);

    expect(result.skipped).toEqual([]);
    expect(result.kept).toEqual(statements);
  });

  it("is kept when it changes a column's type", () => {
    const statements = rebuild({
      columns: `\t\`id\` text PRIMARY KEY,
\t\`_parent_id\` text NOT NULL,
\t\`_parent_table\` text NOT NULL,
\t\`_parent_field\` text NOT NULL,
\t\`_order\` text,
\t\`_component_type\` text,
\t\`created_at\` integer NOT NULL,
\t\`updated_at\` integer NOT NULL,
\t\`og_image\` text`,
    });

    expect(
      withoutCopyOnlyRebuilds(statements, new Set(), live).skipped
    ).toEqual([]);
  });

  it("is kept when its SELECT reads an expression rather than the column itself", () => {
    const statements = rebuild({
      from: quoted(ALL).replace("`og_image`", "upper(`og_image`)"),
    });

    expect(
      withoutCopyOnlyRebuilds(statements, new Set(), live).skipped
    ).toEqual([]);
  });

  it("is kept when it renames the rebuilt table to another name", () => {
    const statements = rebuild({ renameTo: "comp_other" });

    expect(
      withoutCopyOnlyRebuilds(statements, new Set(), live).skipped
    ).toEqual([]);
  });

  it("is kept for a table the live snapshot cannot vouch for", () => {
    const statements = rebuild();

    expect(
      withoutCopyOnlyRebuilds(statements, new Set(), () => undefined)
    ).toEqual({ kept: statements, skipped: [] });
  });
});

describe("a drizzle-kit rebuild this push approved", () => {
  it("is kept whatever it copies, because the push asked for it", () => {
    const statements = rebuild();

    expect(withoutCopyOnlyRebuilds(statements, new Set([TABLE]), live)).toEqual(
      { kept: statements, skipped: [] }
    );
  });
});

describe("an index added after a rebuild that is left out", () => {
  it("is kept when the live table does not have it yet", () => {
    const newIndex =
      "CREATE INDEX `idx_comp_seo_og_image` ON `comp_seo` (`og_image`);";
    const statements = [...rebuild(), newIndex];

    const result = withoutCopyOnlyRebuilds(statements, new Set(), live);

    expect(result.skipped).toEqual([TABLE]);
    expect(result.kept).toContain(newIndex);
  });
});
