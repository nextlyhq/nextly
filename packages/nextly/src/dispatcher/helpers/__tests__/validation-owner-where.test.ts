/**
 * The system owner column (`created_by`) is stripped from responses, so a REST
 * client must not be able to filter by it either. parseWhereParam drops any
 * owner-column condition from a client `where` (recursing through and/or) while
 * leaving other conditions intact.
 */
import { describe, expect, it } from "vitest";

import { parseWhereParam, stripOwnerColumnsFromWhere } from "../validation";

describe("parseWhereParam strips owner-column filters", () => {
  it("drops a top-level created_by / createdBy condition", () => {
    const where = parseWhereParam(
      JSON.stringify({
        created_by: { equals: "u1" },
        createdBy: { equals: "u1" },
        status: { equals: "published" },
      })
    );
    expect(where).toEqual({ status: { equals: "published" } });
  });

  it("drops a dotted owner key (created_by.any) that keys on the first segment", () => {
    // The query builder keys on `column.split(".")[0]`, so `created_by.any`
    // still targets the owner column and must be stripped like the bare key.
    const where = parseWhereParam(
      JSON.stringify({
        "created_by.any": { equals: "u1" },
        "createdBy.somethingElse": { equals: "u1" },
        title: { contains: "hi" },
      })
    );
    expect(where).toEqual({ title: { contains: "hi" } });
  });

  it("drops owner conditions nested inside and/or and prunes empties", () => {
    const where = parseWhereParam(
      JSON.stringify({
        and: [{ created_by: { equals: "u1" } }, { title: { contains: "hi" } }],
        or: [{ createdBy: { equals: "u2" } }],
      })
    );
    // The `and` keeps only the title condition; the `or` becomes empty and is
    // pruned entirely.
    expect(where).toEqual({ and: [{ title: { contains: "hi" } }] });
  });

  it("leaves owner-free filters untouched", () => {
    const where = parseWhereParam(
      JSON.stringify({ price: { greater_than: 100 } })
    );
    expect(where).toEqual({ price: { greater_than: 100 } });
  });
});

describe("stripOwnerColumnsFromWhere sanitizes body filters", () => {
  it("strips owner columns (incl. dotted + nested) from an object where", () => {
    const where = stripOwnerColumnsFromWhere({
      "created_by.any": { equals: "u1" },
      and: [{ createdBy: { equals: "u1" } }, { status: { equals: "draft" } }],
    });
    expect(where).toEqual({ and: [{ status: { equals: "draft" } }] });
  });

  it("passes undefined through unchanged", () => {
    expect(stripOwnerColumnsFromWhere(undefined)).toBeUndefined();
  });
});
