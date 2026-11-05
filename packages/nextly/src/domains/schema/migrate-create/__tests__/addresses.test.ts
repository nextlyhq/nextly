import { describe, expect, it } from "vitest";

import { judgeAddress } from "../../../../shared/address-rule";
import { ADDRESS_CASES } from "../../../../shared/__tests__/helpers/address-cases";
import { resolveCollectionTableName } from "../../../schema/utils/resolve-table-name";
import { judgeMigrationAddresses } from "../addresses";

/** A latest snapshot written before entities were recorded: only its tables say what exists. */
const older = (tables: string[]) => ({
  data: { snapshot: { tables: tables.map(name => ({ name })) } },
});

const collection = (slug: string) => ({
  slug,
  tableName: resolveCollectionTableName(slug),
});

describe("judgeMigrationAddresses", () => {
  it.each(ADDRESS_CASES)(
    "gives a new address '%s' the rule's verdict",
    address => {
      const { refused } = judgeMigrationAddresses(
        { collections: [collection(address)], singles: [], components: [] },
        older(["dc_posts"])
      );
      expect(refused[0]?.refusal.message ?? null).toBe(
        judgeAddress("collection", address)?.message ?? null
      );
    }
  );

  it("keeps an address whose table the latest snapshot records, and reports it", () => {
    const { refused, existing } = judgeMigrationAddresses(
      {
        collections: [collection("admin"), collection("team-updates")],
        singles: [],
        components: [],
      },
      older(["dc_admin", "dc_team_updates"])
    );
    expect(refused).toEqual([]);
    expect(existing.map(e => e.entity.address)).toEqual(["admin"]);
  });

  it("refuses a new address with the same snake_case form as another's", () => {
    const { refused } = judgeMigrationAddresses(
      {
        collections: [collection("team-updates")],
        singles: [{ slug: "team_updates", tableName: "single_team_updates" }],
        components: [],
      },
      older(["dc_team_updates"])
    );
    expect(refused.map(r => [r.entity.kind, r.refusal.code])).toEqual([
      ["single", "SLUG_SAME_SNAKE_CASE"],
    ]);
  });

  it("treats everything as new when there is no snapshot, as on a fresh project", () => {
    const { refused, existing } = judgeMigrationAddresses(
      { collections: [collection("cascade")], singles: [], components: [] },
      null
    );
    expect(refused.map(e => e.entity.address)).toEqual(["cascade"]);
    expect(existing).toEqual([]);
  });

  it("decides by the recorded entities when the snapshot has them, not by the table", async () => {
    // A Single renamed while it keeps its `dbName`: its table is in the snapshot, but the snapshot
    // records the Single under its old address, so the new address is new.
    const renamed = "a".repeat(49);
    const { refused } = judgeMigrationAddresses(
      {
        collections: [],
        singles: [{ slug: renamed, tableName: "single_custom" }],
        components: [],
      },
      {
        data: {
          snapshot: { tables: [{ name: "single_custom" }] },
          entities: {
            collections: {},
            singles: { "old-address": {} },
            fieldGroups: {},
          },
        },
      }
    );
    expect(refused.map(r => r.refusal.code)).toEqual(["SLUG_TOO_LONG"]);
  });
});

/**
 * The migrate commands' one answer to "is this address new", for every kind of snapshot they can
 * find and every way an address can change. They read files only, never the database: with no
 * snapshot nothing is known to exist, so everything is new. An address the latest snapshot records
 * but the configuration no longer declares still holds its registry row at the next start, so it
 * still counts as used, as the start counts it.
 */
describe("the migrate commands' decision table", () => {
  type Snapshot = "with entities" | "older, tables only" | "none";
  const snapshotOf = (
    kind: Snapshot,
    slugs: string[]
  ): Parameters<typeof judgeMigrationAddresses>[1] => {
    if (kind === "none") return null;
    const tables = slugs.map(slug => ({
      name: resolveCollectionTableName(slug),
    }));
    if (kind === "older, tables only")
      return { data: { snapshot: { tables } } };
    return {
      data: {
        snapshot: { tables },
        entities: {
          collections: Object.fromEntries(slugs.map(slug => [slug, {}])),
          singles: {},
          fieldGroups: {},
        },
      },
    };
  };
  const judge = (kind: Snapshot, recorded: string[], declared: string[]) => {
    const { refused, existing } = judgeMigrationAddresses(
      { collections: declared.map(collection), singles: [], components: [] },
      snapshotOf(kind, recorded)
    );
    return {
      refused: refused.map(r => r.entity.address),
      warned: existing.map(e => e.entity.address),
    };
  };

  it.each([
    // The same address the snapshot records: kept, and warned about since the rule refuses it.
    ["with entities", ["cascade"], ["cascade"], [], ["cascade"]],
    ["older, tables only", ["cascade"], ["cascade"], [], ["cascade"]],
    ["none", [], ["cascade"], ["cascade"], []],
    // A new address the rule refuses: refused whatever the snapshot.
    ["with entities", ["posts"], ["posts", "cascade"], ["cascade"], []],
    ["older, tables only", ["posts"], ["posts", "cascade"], ["cascade"], []],
    ["none", [], ["posts", "cascade"], ["cascade"], []],
    // Renamed across separators: the old address is still used, so the new one is refused. An
    // older snapshot records no addresses, only the table both share, so it cannot tell.
    ["with entities", ["team-updates"], ["team_updates"], ["team_updates"], []],
    ["older, tables only", ["team-updates"], ["team_updates"], [], []],
    ["none", [], ["team_updates"], [], []],
    // Removed from the configuration: nothing to judge or warn about.
    ["with entities", ["cascade"], [], [], []],
    ["older, tables only", ["cascade"], [], [], []],
  ] as const)(
    "%s snapshot recording %j, declaring %j: refuses %j, warns %j",
    (kind, recorded, declared, refused, warned) => {
      expect(judge(kind, [...recorded], [...declared])).toEqual({
        refused: [...refused],
        warned: [...warned],
      });
    }
  );
});
