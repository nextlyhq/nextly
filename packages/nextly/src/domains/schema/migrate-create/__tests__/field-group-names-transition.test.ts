/**
 * Which field-group names a migration history is on, and the one step that moves it: every run
 * stays on the newest snapshot's naming, and the transition renames each field-group table and its
 * type column in the snapshot, as the storage migration renames them in the database.
 */
import { describe, expect, it } from "vitest";

import {
  contributionsUnderCurrentNames,
  currentNamesOf,
  historyFieldGroupNaming,
  refuseChangesToTransition,
  refuseNamingAgainstHistory,
  snapshotUnderCurrentNames,
  transitionNeeded,
} from "../field-group-names-transition";

const LEGACY = {};
const CURRENT = { fieldGroupStorage: "current" as const };

describe("the history's field-group naming", () => {
  it("is the newest snapshot's, whatever the caller resolved", () => {
    expect(historyFieldGroupNaming(LEGACY, undefined)).toBe("legacy");
    expect(historyFieldGroupNaming(CURRENT, undefined)).toBe("current");
    expect(historyFieldGroupNaming(LEGACY, "current")).toBe("legacy");
  });

  it("is the caller's, else legacy, for a project with no history yet", () => {
    expect(historyFieldGroupNaming(null, undefined)).toBe("legacy");
    expect(historyFieldGroupNaming(null, "current")).toBe("current");
  });

  // A diff across two namings plans to drop every comp_ table and create its fg_ twin.
  it("refuses a run whose field groups were named under the other naming, naming the way across", () => {
    expect(() => refuseNamingAgainstHistory(LEGACY, "current")).toThrow(
      /nextly migrate:create --field-group-names=current/
    );
    expect(() => refuseNamingAgainstHistory(CURRENT, "legacy")).toThrow(
      /nextly migrate:field-groups --apply --backup-confirmed/
    );
  });

  it("lets a run on the history's own naming, or one that named none, through", () => {
    expect(() => refuseNamingAgainstHistory(LEGACY, "legacy")).not.toThrow();
    expect(() => refuseNamingAgainstHistory(CURRENT, "current")).not.toThrow();
    expect(() => refuseNamingAgainstHistory(LEGACY, undefined)).not.toThrow();
    expect(() => refuseNamingAgainstHistory(null, "current")).not.toThrow();
  });
});

describe("the transition to the current names", () => {
  it("is needed for a legacy history, and nothing to do for a current one", () => {
    expect(transitionNeeded(LEGACY)).toBe(true);
    expect(transitionNeeded(CURRENT)).toBe(false);
  });

  it("is refused for a project with no migration yet", () => {
    expect(() => transitionNeeded(null)).toThrow(/no migration yet/);
  });

  it("is refused while the config has another change to migrate, naming it", () => {
    expect(() =>
      refuseChangesToTransition({ tables: ["dc_posts"], beyondTables: false })
    ).toThrow(/changes to "dc_posts" to migrate/);
    expect(() =>
      refuseChangesToTransition({ tables: [], beyondTables: true })
    ).toThrow(/changes to settings or permissions to migrate/);
    expect(() =>
      refuseChangesToTransition({ tables: [], beyondTables: false })
    ).not.toThrow();
  });

  it("renames each field-group table and its type column, and leaves every other table alone", () => {
    const index = { name: "comp_card_heading_idx", columns: ["heading"] };
    const moved = snapshotUnderCurrentNames(
      {
        tables: [
          {
            name: "comp_card",
            columns: [
              { name: "_component_type", type: "varchar", nullable: true },
              { name: "heading", type: "text", nullable: true },
            ],
            indexes: [index as never],
          },
          {
            name: "dc_posts",
            columns: [
              { name: "_component_type", type: "varchar", nullable: true },
            ],
          },
        ],
      },
      currentNamesOf(["comp_card"])
    );

    expect(moved.tables.map(t => t.name)).toEqual(["fg_card", "dc_posts"]);
    expect(moved.tables[0].columns.map(c => c.name)).toEqual([
      "_field_group_type",
      "heading",
    ]);
    // A rename keeps a table's indexes under their names, as the storage migration's does.
    expect(moved.tables[0].indexes).toEqual([index]);
    expect(moved.tables[1].columns.map(c => c.name)).toEqual([
      "_component_type",
    ]);
  });

  // The rename carries every index and key on the type column with it, so the snapshot names it
  // under its current name there too, or the next migrate:check reads a spurious index change.
  it("renames the type column inside each index and foreign key of a field-group table", () => {
    const moved = snapshotUnderCurrentNames(
      {
        tables: [
          {
            name: "comp_card",
            columns: [
              { name: "_component_type", type: "varchar", nullable: true },
            ],
            indexes: [
              { name: "card_type_idx", columns: ["_component_type"] } as never,
            ],
            foreignKeys: [
              {
                name: "card_type_fk",
                columns: ["_component_type"],
                referencedTable: "kinds",
                referencedColumns: ["id"],
              } as never,
            ],
          },
        ],
      },
      currentNamesOf(["comp_card"])
    );

    const [card] = moved.tables;
    expect(card?.indexes?.[0]?.columns).toEqual(["_field_group_type"]);
    expect(card?.foreignKeys?.[0]?.columns).toEqual(["_field_group_type"]);
  });

  // A foreign key on any table that points at a field-group table, or at its type column, follows
  // the rename, or the next migrate:check reads a dropped and an added key.
  it("moves every table's foreign keys that point at a field-group table", () => {
    const moved = snapshotUnderCurrentNames(
      {
        tables: [
          { name: "comp_card", columns: [] },
          {
            name: "dc_posts",
            columns: [],
            foreignKeys: [
              {
                name: "posts_card_fk",
                columns: ["card_type"],
                referencesTable: "comp_card",
                referencesColumns: ["_component_type"],
                onDelete: "cascade",
                onUpdate: "no action",
              } as never,
            ],
          },
        ],
      },
      currentNamesOf(["comp_card"])
    );

    expect(moved.tables[1]?.foreignKeys?.[0]).toMatchObject({
      columns: ["card_type"],
      referencesTable: "fg_card",
      referencesColumns: ["_field_group_type"],
    });
  });

  it("keeps a field-group table under a name of its own, and moves its type column", () => {
    const moved = snapshotUnderCurrentNames(
      {
        tables: [
          {
            name: "my_seo_block",
            columns: [
              { name: "_component_type", type: "varchar", nullable: true },
            ],
          },
        ],
      },
      currentNamesOf(["my_seo_block"])
    );
    expect(moved.tables[0]?.name).toBe("my_seo_block");
    expect(moved.tables[0]?.columns.map(c => c.name)).toEqual([
      "_field_group_type",
    ]);
  });

  it("keys the app's contributions to a field-group table by its current name", () => {
    const elements = {
      columns: ["badge"],
      indexes: [],
      foreignKeys: [],
      checks: [],
    };
    expect(
      contributionsUnderCurrentNames(
        { comp_card: elements, dc_posts: elements },
        currentNamesOf(["comp_card"])
      )
    ).toEqual({ fg_card: elements, dc_posts: elements });
  });
});
