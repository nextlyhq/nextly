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

  it("only reports, and refuses nothing, when there is no snapshot to tell new from existing", () => {
    const { refused, existing } = judgeMigrationAddresses(
      { collections: [collection("cascade")], singles: [], components: [] },
      null
    );
    expect(refused).toEqual([]);
    expect(existing.map(e => e.entity.address)).toEqual(["cascade"]);
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
