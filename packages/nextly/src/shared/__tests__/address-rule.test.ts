import { describe, expect, it } from "vitest";

import { MAX_FIELD_GROUP_SLUG_LENGTH } from "../../domains/field-groups/services/field-group-schema-service";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import {
  type AddressKind,
  addressSnakeForm,
  findSameSnakeCaseAddress,
  judgeAddress,
  judgeAddresses,
  judgeConfiguredAddress,
} from "../address-rule";

const KINDS: AddressKind[] = ["collection", "single", "fieldGroup"];

const name = (length: number): string => "a".repeat(length);

describe("judgeAddress", () => {
  // The five names the three validators on main disagreed about, and the
  // verdict the one rule gives each, for every kind.
  it.each(KINDS)("gives one verdict for main's disputed names (%s)", kind => {
    expect(judgeAddress(kind, "admin")?.code).toBe("SLUG_RESERVED");
    expect(judgeAddress(kind, "team-updates")).toBeNull();
    expect(judgeAddress(kind, "select")?.code).toBe("SLUG_SQL_KEYWORD");
    expect(judgeAddress(kind, "accounts")?.code).toBe("SLUG_RESERVED");
    expect(judgeAddress(kind, name(51))?.code).toBe("SLUG_TOO_LONG");
  });

  it.each(KINDS)("names the address and the reason (%s)", kind => {
    const refusal = judgeAddress(kind, "admin");
    expect(refusal?.message).toContain("'admin'");
    expect(refusal?.message).toMatch(/route or a system table/);
    expect(judgeAddress(kind, "select")?.message).toMatch(
      /'select'.*reserved SQL word/
    );
  });

  it.each(KINDS)("refuses a malformed address (%s)", kind => {
    for (const bad of ["", "Team", "2fast", "team updates", "a/b", "_x"]) {
      expect(judgeAddress(kind, bad), bad).not.toBeNull();
    }
    expect(judgeAddress(kind, "Team")?.code).toBe("SLUG_INVALID_FORMAT");
    expect(judgeAddress(kind, "")?.code).toBe("SLUG_REQUIRED");
    expect(judgeAddress(kind, 7)?.code).toBe("SLUG_INVALID_TYPE");
  });

  it.each(KINDS)("refuses the localization table suffix (%s)", kind => {
    expect(judgeAddress(kind, "posts_locales")?.code).toBe("SLUG_RESERVED");
    expect(judgeAddress(kind, "posts-locales")?.code).toBe("SLUG_RESERVED");
  });

  it("refuses a system resource for the kinds that seed its permissions", () => {
    expect(judgeAddress("collection", "settings")?.message).toMatch(
      /system resource/
    );
    expect(judgeAddress("single", "settings")?.message).toMatch(
      /system resource/
    );
    // A field group seeds no permission under its address.
    expect(judgeAddress("fieldGroup", "settings")).toBeNull();
  });

  it("refuses the field-group API segment for field groups only", () => {
    expect(judgeAddress("fieldGroup", "field-groups")?.code).toBe(
      "SLUG_RESERVED"
    );
    expect(judgeAddress("collection", "field-groups")).toBeNull();
  });

  it("bounds each kind by the longest name its tables need", () => {
    // A collection stops at the product's 50.
    expect(judgeAddress("collection", name(50))).toBeNull();
    // `single_<slug>_locales` must fit 63: 48 characters of address.
    expect(judgeAddress("single", name(48))).toBeNull();
    expect(judgeAddress("single", name(49))?.code).toBe("SLUG_TOO_LONG");
    expect(judgeAddress("single", name(49))?.message).toContain(
      `single_${name(49)}_locales`
    );
    // `idx_comp_<slug>_parent` must fit 63: the bound the field-group
    // generator states for itself.
    expect(judgeAddress("fieldGroup", name(MAX_FIELD_GROUP_SLUG_LENGTH))).toBe(
      null
    );
    expect(
      judgeAddress("fieldGroup", name(MAX_FIELD_GROUP_SLUG_LENGTH + 1))?.code
    ).toBe("SLUG_TOO_LONG");
  });
});

describe("judgeConfiguredAddress", () => {
  // Configuration is judged at import, before anything can say whether an
  // entity already exists under the address, so it holds back exactly the
  // refusals configuration did not make before the one rule.
  it.each([
    ["collection", "cascade"],
    ["collection", "some"],
    ["collection", "dynamic_collections"],
    ["single", name(49)],
    ["fieldGroup", name(MAX_FIELD_GROUP_SLUG_LENGTH + 1)],
    ["fieldGroup", "cascade"],
  ] as const)("defers %s '%s' to the roads that know", (kind, address) => {
    expect(judgeAddress(kind, address)).not.toBeNull();
    expect(judgeAddress(kind, address)?.mayAlreadyExist).toBe(true);
    expect(judgeConfiguredAddress(kind, address)).toBeNull();
  });

  it.each(KINDS)(
    "refuses what configuration already refused, with the rule's reason (%s)",
    kind => {
      for (const address of ["admin", "select", "accounts", name(51), "Team"]) {
        expect(judgeConfiguredAddress(kind, address)).toEqual(
          judgeAddress(kind, address)
        );
        expect(judgeAddress(kind, address)?.mayAlreadyExist).toBe(false);
      }
    }
  );
});

describe("findSameSnakeCaseAddress", () => {
  it("writes each hyphen as an underscore", () => {
    expect(addressSnakeForm("team-updates")).toBe("team_updates");
    // The table each kind derives from the address carries that form.
    expect(resolveCollectionTableName("team-updates")).toBe("dc_team_updates");
    expect(resolveSingleTableName({ slug: "team-updates" })).toBe(
      "single_team_updates"
    );
    expect(resolveComponentTableName("team-updates")).toBe("comp_team_updates");
  });

  it.each(KINDS)(
    "refuses either spelling beside the other within a kind (%s)",
    kind => {
      const both = findSameSnakeCaseAddress(kind, "team_updates", [
        { kind, address: "team-updates" },
      ]);
      expect(both?.code).toBe("SLUG_SAME_SNAKE_CASE");
      expect(both?.message).toContain("'team_updates'");
      expect(both?.message).toContain("'team-updates'");
      expect(both?.message).toMatch(/snake_case form 'team_updates'/);
      expect(
        findSameSnakeCaseAddress(kind, "team-updates", [
          { kind, address: "team_updates" },
        ])?.code
      ).toBe("SLUG_SAME_SNAKE_CASE");
    }
  );

  it("counts collections and Singles as one namespace", () => {
    expect(
      findSameSnakeCaseAddress("single", "team_updates", [
        { kind: "collection", address: "team-updates" },
      ])?.code
    ).toBe("SLUG_SAME_SNAKE_CASE");
    expect(
      findSameSnakeCaseAddress("collection", "team_updates", [
        { kind: "single", address: "team-updates" },
      ])?.code
    ).toBe("SLUG_SAME_SNAKE_CASE");
  });

  it("judges a field group among field groups only", () => {
    expect(
      findSameSnakeCaseAddress("fieldGroup", "team_updates", [
        { kind: "collection", address: "team-updates" },
        { kind: "single", address: "team-updates" },
      ])
    ).toBeNull();
    expect(
      findSameSnakeCaseAddress("collection", "team_updates", [
        { kind: "fieldGroup", address: "team-updates" },
      ])
    ).toBeNull();
  });

  it("leaves the exact same address to the check that it is taken", () => {
    expect(
      findSameSnakeCaseAddress("collection", "team-updates", [
        { kind: "collection", address: "team-updates" },
      ])
    ).toBeNull();
    expect(
      findSameSnakeCaseAddress("collection", "posts", [
        { kind: "collection", address: "pages" },
      ])
    ).toBeNull();
  });
});

describe("judgeAddresses", () => {
  it("refuses a new address the rule refuses, and only warns for an existing one", () => {
    const { refused, existing } = judgeAddresses([
      { kind: "collection", address: "cascade", isNew: true },
      { kind: "collection", address: "some", isNew: false },
      { kind: "collection", address: "posts", isNew: true },
    ]);
    expect(refused.map(r => r.entity.address)).toEqual(["cascade"]);
    expect(refused[0]?.refusal).toEqual(judgeAddress("collection", "cascade"));
    expect(existing.map(r => r.entity.address)).toEqual(["some"]);
    expect(existing[0]?.refusal).toEqual(judgeAddress("collection", "some"));
  });

  it("refuses a new address beside a used one of the same snake_case form", () => {
    const { refused } = judgeAddresses(
      [
        { kind: "single", address: "team_updates", isNew: true },
        { kind: "fieldGroup", address: "team_updates", isNew: true },
      ],
      [{ kind: "collection", address: "team-updates" }]
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.entity.kind).toBe("single");
    expect(refused[0]?.refusal.code).toBe("SLUG_SAME_SNAKE_CASE");
  });

  it("judges new addresses against each other, and leaves two existing ones be", () => {
    expect(
      judgeAddresses([
        { kind: "collection", address: "team-updates", isNew: true },
        { kind: "single", address: "team_updates", isNew: true },
      ]).refused
    ).toHaveLength(2);
    expect(
      judgeAddresses([
        { kind: "collection", address: "team-updates", isNew: false },
        { kind: "single", address: "team_updates", isNew: false },
      ])
    ).toEqual({ refused: [], existing: [] });
  });
});
