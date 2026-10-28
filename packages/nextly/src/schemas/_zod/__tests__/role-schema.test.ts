/**
 * The published role schema keeps whether a role may be given to someone:
 * a role parsed through it says so as the roles API sent it.
 */
import { describe, expect, it } from "vitest";

import { RoleListResponseSchema, RoleSchema } from "../rbac";

const publicRole = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Public",
  slug: "public",
  level: 0,
  isSystem: true,
  assignable: false,
};

describe("RoleSchema", () => {
  it("keeps a role's assignable mark", () => {
    expect(RoleSchema.parse(publicRole).assignable).toBe(false);
    expect(RoleListResponseSchema.parse([publicRole])[0].assignable).toBe(
      false
    );
  });

  it("parses a role sent without the mark, and does not invent one", () => {
    const { assignable: _left, ...older } = publicRole;
    expect(RoleSchema.parse(older).assignable).toBeUndefined();
  });
});
