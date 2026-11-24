/**
 * Who uses a field group, read from the stored field lists: every collection, Single and field
 * group placing it, directly or through another field group (`fieldGroupUsesAmong`), and the one
 * clause the server's refusal and the Schema Builder's both name them in (`fieldGroupUsersClause`).
 */
import { describe, expect, it } from "vitest";

import { fieldGroupUsesAmong } from "../../../collections/services/collection-dependents";
import { fieldGroupUsersClause } from "../../../field-groups/storage/field-group-users-clause";
import { fieldGroupUsersOf } from "../field-group-users";

const placing = (name: string, slug: string) => ({
  name,
  type: "component",
  component: slug,
});

const owner = (
  entityType: "collection" | "single" | "fieldGroup",
  entitySlug: string,
  fields: unknown[]
) => ({ entityType, entitySlug, fields });

describe("fieldGroupUsesAmong", () => {
  it("lists the direct uses first, then each holder through other field groups with its chain", () => {
    // s → c → b → a: the Single places c, which places b, which places a.
    const uses = fieldGroupUsesAmong(
      [
        owner("collection", "posts", [
          { name: "meta", type: "group", fields: [placing("a", "a")] },
        ]),
        owner("fieldGroup", "b", [placing("a", "a")]),
        owner("fieldGroup", "c", [placing("b", "b")]),
        owner("single", "s", [
          { name: "rows", type: "repeater", fields: [placing("c", "c")] },
        ]),
      ],
      "a"
    );
    expect(uses).toEqual([
      { entityType: "collection", entitySlug: "posts", fieldPath: "meta.a" },
      { entityType: "fieldGroup", entitySlug: "b", fieldPath: "a" },
      {
        entityType: "fieldGroup",
        entitySlug: "c",
        fieldPath: "b",
        via: ["b"],
      },
      {
        entityType: "single",
        entitySlug: "s",
        fieldPath: "rows.c",
        via: ["c", "b"],
      },
    ]);
  });

  it("ends a ring of field groups, and never names a field group its own user", () => {
    const uses = fieldGroupUsesAmong(
      [
        owner("fieldGroup", "a", [placing("b", "b"), placing("self", "a")]),
        owner("fieldGroup", "b", [placing("a", "a")]),
      ],
      "a"
    );
    expect(uses).toEqual([
      { entityType: "fieldGroup", entitySlug: "b", fieldPath: "a" },
    ]);
  });

  it("is what a move's refusal reads, with whether the reader saw every field list", () => {
    const usersOf = fieldGroupUsersOf(
      [owner("collection", "posts", [placing("a", "a")])],
      false
    );
    expect(usersOf("a")).toEqual({
      uses: [{ entityType: "collection", entitySlug: "posts", fieldPath: "a" }],
      complete: false,
    });
  });
});

describe("fieldGroupUsersClause", () => {
  // The fixture the Schema Builder's refusal pins too: a used by c1, c2 and field group b; Single s
  // places b.
  it("names each holder once, direct ones first, an indirect one with the field group it goes through", () => {
    const uses = fieldGroupUsesAmong(
      [
        owner("collection", "c1", [placing("a", "a")]),
        owner("collection", "c2", [placing("a", "a")]),
        owner("fieldGroup", "b", [placing("a", "a")]),
        owner("single", "s", [placing("b", "b")]),
      ],
      "a"
    );
    expect(fieldGroupUsersClause(uses, true)).toBe(
      "It is used by the collection c1, the collection c2, the field group b, the Single s (through b)."
    );
  });

  it("names a longer chain holder side first, a holder reached two ways once, and others the reader may not read", () => {
    expect(
      fieldGroupUsersClause(
        [
          { entityType: "single", entitySlug: "s", via: ["c", "b"] },
          { entityType: "single", entitySlug: "s", via: ["d"] },
        ],
        false
      )
    ).toBe(
      "It is used by the Single s (through c, then b), and others you may not read."
    );
    expect(fieldGroupUsersClause([], true)).toBe("");
    expect(fieldGroupUsersClause([], false)).toBe(
      "It is used by others you may not read."
    );
  });
});
