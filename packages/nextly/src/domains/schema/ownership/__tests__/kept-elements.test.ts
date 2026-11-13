/**
 * What a development push keeps of a removed plugin's elements on other
 * owners' tables, what it records, and what it refuses to change.
 */
import { describe, expect, it } from "vitest";

import type { ExtensionSchema } from "../../extension/build-extension-schema";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../../pipeline/diff/types";
import {
  assertNoContributedOwnerChange,
  contributedElements,
  declaringOwners,
  keptElements,
  ownerRowsToRecord,
  refuseChangesToKeptElements,
  refuseRebuildsLosingKeptElements,
  withKeptElements,
  type KeptElement,
} from "../kept-elements";
import type { OwnerRecord } from "../owner-registry";

const POSTS = "dc_posts";

/** An element row for `ownerId`, carried by `migratedBy`. */
function row(
  ownerId: string,
  elementKind: NonNullable<OwnerRecord["elementKind"]>,
  elementName: string,
  tableName = POSTS,
  ownerKind: OwnerRecord["ownerKind"] = "plugin"
): OwnerRecord {
  return {
    tableName,
    elementKind,
    elementName,
    ownerKind,
    ownerId,
    migratedBy: ownerKind === "plugin" ? `plugin:${ownerId}` : ownerKind,
    ownerVersion: null,
    schemaVersion: null,
    state: "active",
  };
}

const headline = { name: "headline", type: "text", nullable: false };
const stamp = { name: "stamp", type: "text", nullable: true };
const stampIndex = {
  name: "idx_dc_posts_stamp",
  columns: ["stamp"],
  unique: false,
};
const ownIndex = {
  name: "idx_dc_posts_headline",
  columns: ["headline"],
  unique: false,
};

/** The posts table as the database has it: the removed plugin's column and index on it. */
const liveTable: TableSpec = {
  name: POSTS,
  columns: [headline, stamp],
  indexes: [ownIndex, stampIndex],
};
const live: NextlySchemaSnapshot = { tables: [liveTable] };

/** The posts table as the configuration describes it, without the plugin. */
const desired: NextlySchemaSnapshot = {
  tables: [{ name: POSTS, columns: [headline], indexes: [ownIndex] }],
};

/** A compiled schema in which only `ids` add an element to the posts table. */
function schemaFrom(
  ids: readonly string[]
): Pick<
  ExtensionSchema,
  "owners" | "elementOwners" | "entityColumns" | "entityIndexes"
> {
  return {
    owners: new Map(),
    elementOwners: new Map(),
    entityColumns: new Map([
      [
        POSTS,
        ids.map(id => ({
          key: `${id}Col`,
          name: `${id}_col`,
          kind: "shortText" as const,
          nullable: true,
          hidden: true,
          contributedBy: { kind: "plugin" as const, id },
        })),
      ],
    ]),
    entityIndexes: new Map(),
  };
}

describe("contributedElements", () => {
  it("reads both records: element owners and an entity table's hidden columns, enum checks and indexes", () => {
    const schema = {
      owners: new Map(),
      elementOwners: new Map([
        [
          "kh__items",
          [
            {
              elementKind: "fk" as const,
              elementName: "fk_kh__items_mark_id",
              owner: { kind: "plugin" as const, id: "ka" },
            },
          ],
        ],
      ]),
      entityColumns: new Map([
        [
          POSTS,
          [
            {
              key: "tone",
              name: "tone",
              kind: "enum" as const,
              nullable: true,
              enumValues: ["a", "b"],
              hidden: true,
              contributedBy: { kind: "plugin" as const, id: "seo" },
            },
          ],
        ],
      ]),
      entityIndexes: new Map([
        [
          POSTS,
          [
            {
              columns: ["tone"],
              unique: false,
              contributedBy: { kind: "app" as const },
            },
          ],
        ],
      ]),
    } as unknown as Parameters<typeof contributedElements>[0];
    const got = contributedElements(schema, "postgresql").map(
      e =>
        `${e.table}:${e.elementKind}:${e.owner.kind === "plugin" ? e.owner.id : "app"}`
    );
    expect(got).toEqual([
      "kh__items:fk:ka",
      `${POSTS}:column:seo`,
      `${POSTS}:check:seo`,
      `${POSTS}:index:app`,
    ]);
  });
});

describe("declaringOwners", () => {
  it("is the app and every plugin that declares a table or an element", () => {
    const schema = schemaFrom(["seo"]);
    schema.owners.set("kh__items", { kind: "plugin", id: "kh" });
    expect([...declaringOwners(schema, "sqlite")].sort()).toEqual([
      "app",
      "kh",
      "seo",
    ]);
    expect([...declaringOwners(null, "sqlite")]).toEqual(["app"]);
  });
});

describe("ownerRowsToRecord", () => {
  const elements = [
    {
      table: POSTS,
      elementKind: "column" as const,
      elementName: "stamp",
      owner: { kind: "plugin" as const, id: "seo" },
    },
    {
      table: "kh__items",
      elementKind: "index" as const,
      elementName: "idx_kh__items_x",
      owner: { kind: "plugin" as const, id: "seo" },
    },
  ];

  it("names the app's stream for an entity table and the contributor's for an extension table", () => {
    const rows = ownerRowsToRecord(elements, new Set(["kh__items"]), []);
    expect(rows.map(r => `${r.tableName}:${r.migratedBy}`)).toEqual([
      `${POSTS}:app`,
      "kh__items:plugin:seo",
    ]);
  });

  it("writes only the rows not recorded yet, so a migration's versions stay", () => {
    const rows = ownerRowsToRecord(elements, new Set(["kh__items"]), [
      row("seo", "column", "stamp"),
    ]);
    expect(rows.map(r => r.elementName)).toEqual(["idx_kh__items_x"]);
  });
});

describe("keptElements", () => {
  const rows = [
    row("gone", "column", "stamp"),
    row("gone", "index", stampIndex.name),
  ];

  it("keeps what a plugin no longer declaring anything added, where the configuration leaves it out", () => {
    expect(
      keptElements({ rows, declaring: new Set(["app"]), live, desired })
    ).toEqual([
      { table: POSTS, kind: "column", name: "stamp", ownerId: "gone" },
      { table: POSTS, kind: "index", name: stampIndex.name, ownerId: "gone" },
    ]);
  });

  it("keeps nothing of a plugin still declaring schema: its removal of an element is its own", () => {
    expect(
      keptElements({ rows, declaring: new Set(["app", "gone"]), live, desired })
    ).toEqual([]);
  });

  it("keeps nothing of the app's, nor what the database no longer has, nor an untracked dimension", () => {
    expect(
      keptElements({
        rows: [row("app", "column", "stamp", POSTS, "app")],
        declaring: new Set(["app"]),
        live,
        desired,
      })
    ).toEqual([]);
    expect(
      keptElements({
        rows: [row("gone", "column", "vanished")],
        declaring: new Set(["app"]),
        live,
        desired,
      })
    ).toEqual([]);
    expect(
      keptElements({
        rows: [row("gone", "index", stampIndex.name)],
        declaring: new Set(["app"]),
        live,
        desired: { tables: [{ name: POSTS, columns: [headline] }] },
      })
    ).toEqual([]);
  });
});

describe("withKeptElements", () => {
  it("adds each kept element as the database has it", () => {
    const kept: KeptElement[] = [
      { table: POSTS, kind: "column", name: "stamp", ownerId: "gone" },
      { table: POSTS, kind: "index", name: stampIndex.name, ownerId: "gone" },
    ];
    expect(withKeptElements(desired, live, kept).tables[0]).toEqual({
      name: POSTS,
      columns: [headline, stamp],
      indexes: [ownIndex, stampIndex],
    });
  });
});

describe("refuseChangesToKeptElements", () => {
  const rows = [row("gone", "column", "stamp")];
  const retype: Operation = {
    type: "change_column_type",
    tableName: POSTS,
    columnName: "stamp",
    fromType: "text",
    toType: "integer",
  };

  it("refuses a change another owner's declaration plans for a removed plugin's column, naming both", () => {
    expect(() =>
      refuseChangesToKeptElements({
        operations: [retype],
        rows,
        declaring: new Set(["app"]),
        kept: [],
        live,
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringMatching(
                /change the column "stamp" that the plugin "gone" added to the table "dc_posts"/
              ),
            }),
          ],
        },
      })
    );
  });

  it("lets the same change through while the plugin still declares schema", () => {
    expect(() =>
      refuseChangesToKeptElements({
        operations: [retype],
        rows,
        declaring: new Set(["app", "gone"]),
        kept: [],
        live,
      })
    ).not.toThrow();
  });

  const dropHeadline: Operation = {
    type: "drop_column",
    tableName: POSTS,
    columnName: "headline",
    columnType: "text",
  };
  const keptIndex: KeptElement = {
    table: POSTS,
    kind: "index",
    name: "idx_dc_posts_headline",
    ownerId: "gone",
  };

  it("refuses a kept index over a column this push drops, which the database would drop with it", () => {
    expect(() =>
      refuseChangesToKeptElements({
        operations: [dropHeadline],
        rows: [row("gone", "index", "idx_dc_posts_headline")],
        declaring: new Set(["app"]),
        kept: [keptIndex],
        live,
      })
    ).toThrow(
      expect.objectContaining({
        publicData: {
          errors: [
            expect.objectContaining({
              message: expect.stringContaining(
                'along with the column "headline"'
              ),
            }),
          ],
        },
      })
    );
  });

  it("leaves a kept index alone when no operation this push runs drops its column", () => {
    // A UI save leaves out the operations on tables it does not own, so a
    // column the configuration omits there is not one this push drops.
    expect(() =>
      refuseChangesToKeptElements({
        operations: [],
        rows: [row("gone", "index", "idx_dc_posts_headline")],
        declaring: new Set(["app"]),
        kept: [keptIndex],
        live,
      })
    ).not.toThrow();
  });

  it("refuses a kept check that names a column this push drops", () => {
    // PostgreSQL drops a check with a column it names, and nothing would put
    // the kept check back.
    const withCheck: NextlySchemaSnapshot = {
      tables: [
        {
          ...liveTable,
          checks: [
            { name: "ck_dc_posts_short", sql: 'length("headline") < 20' },
          ],
        },
      ],
    };
    const keptCheck: KeptElement = {
      table: POSTS,
      kind: "check",
      name: "ck_dc_posts_short",
      ownerId: "gone",
    };
    const refuse = (operations: Operation[]) =>
      refuseChangesToKeptElements({
        operations,
        rows: [row("gone", "check", "ck_dc_posts_short")],
        declaring: new Set(["app"]),
        kept: [keptCheck],
        live: withCheck,
      });
    expect(() => refuse([dropHeadline])).toThrow();
    expect(() =>
      refuse([{ ...dropHeadline, columnName: "headline_old" }])
    ).not.toThrow();
  });
});

describe("refuseRebuildsLosingKeptElements", () => {
  it("refuses a rebuild of a table holding a kept column, and allows one holding only a kept index", () => {
    const column: KeptElement = {
      table: POSTS,
      kind: "column",
      name: "stamp",
      ownerId: "gone",
    };
    const index: KeptElement = { ...column, kind: "index", name: "i" };
    expect(() =>
      refuseRebuildsLosingKeptElements([POSTS], [column, index])
    ).toThrow();
    expect(() =>
      refuseRebuildsLosingKeptElements([POSTS], [index])
    ).not.toThrow();
    expect(() =>
      refuseRebuildsLosingKeptElements(["dc_other"], [column])
    ).not.toThrow();
  });
});

describe("assertNoContributedOwnerChange", () => {
  const shared = (id: string) => ({
    table: POSTS,
    elementKind: "index" as const,
    elementName: "idx_dc_posts_stamp",
    owner: { kind: "plugin" as const, id },
  });

  it("accepts an element two plugins contribute alike, recorded for either", () => {
    // The compiler accepts identical contributions and makes one index; the
    // row names the first contributor, and the second is not a takeover.
    expect(() =>
      assertNoContributedOwnerChange(
        [shared("a"), shared("b")],
        [row("a", "index", "idx_dc_posts_stamp")]
      )
    ).not.toThrow();
  });

  it("refuses an element recorded for a plugin that no longer contributes it", () => {
    expect(() =>
      assertNoContributedOwnerChange(
        [shared("b")],
        [row("a", "index", "idx_dc_posts_stamp")]
      )
    ).toThrow(/recorded as belonging to "a"/);
  });
});
