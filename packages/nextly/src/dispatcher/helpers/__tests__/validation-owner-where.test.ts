/**
 * The system owner column (`created_by`) is stripped from responses, so a REST
 * client must not be able to filter by it either. parseWhereParam drops any
 * owner-column condition from a client `where` (recursing through and/or) while
 * leaving other conditions intact.
 */
import { describe, expect, it } from "vitest";

import { parseWhereParam } from "../validation";

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
