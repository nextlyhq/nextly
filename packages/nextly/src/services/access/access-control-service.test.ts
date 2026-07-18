import { describe, it, expect } from "vitest";

import type { RequestContext } from "@nextly/collections/fields/types/base";

import { AccessControlService } from "./access-control-service";
import type { CollectionAccessRules } from "./types";

// Role-based rules use OR logic: access is granted if the user holds ANY of the
// allowed roles. The user/role model is many-to-many, so evaluation reads the
// full `roles` set and folds in the single `role` for backward compatibility.
describe("AccessControlService role-based access (OR-membership)", () => {
  const service = new AccessControlService();
  const rules: CollectionAccessRules = {
    read: { type: "role-based", allowedRoles: ["admin", "editor"] },
  };

  function evaluate(user: RequestContext["user"]) {
    return service.evaluateAccess(rules, "read", { user });
  }

  it("grants when one of several held roles is allowed", async () => {
    const result = await evaluate({ id: "u1", roles: ["viewer", "editor"] });
    expect(result.allowed).toBe(true);
  });

  it("denies when no held role is allowed", async () => {
    const result = await evaluate({ id: "u1", roles: ["viewer", "guest"] });
    expect(result.allowed).toBe(false);
  });

  it("still honors the single `role` field (backward compatibility)", async () => {
    const result = await evaluate({ id: "u1", role: "editor" });
    expect(result.allowed).toBe(true);
  });

  it("folds `role` into the set when `roles` does not match", async () => {
    const result = await evaluate({
      id: "u1",
      role: "admin",
      roles: ["viewer"],
    });
    expect(result.allowed).toBe(true);
  });

  it("denies an authenticated user with no roles at all", async () => {
    const result = await evaluate({ id: "u1" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("User has no role assigned");
  });

  it("denies an unauthenticated request", async () => {
    const result = await evaluate(undefined);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Authentication required");
  });
});

describe("AccessControlService owner-only default field", () => {
  const service = new AccessControlService();

  // No ownerField configured → must default to the auto-stamped system owner
  // column name (snake_case), so the generated read filter and update/delete
  // comparisons target the column the create path actually writes.
  const ownerOnly: CollectionAccessRules = { read: { type: "owner-only" } };

  it("filters reads on the created_by column", async () => {
    const result = await service.evaluateAccess(ownerOnly, "read", {
      user: { id: "u1" },
    });
    expect(result.allowed).toBe(true);
    expect(result.query).toEqual({ created_by: { equals: "u1" } });
  });

  it("compares ownership against created_by on update", async () => {
    const rules: CollectionAccessRules = { update: { type: "owner-only" } };
    const mine = await service.evaluateAccess(
      rules,
      "update",
      { user: { id: "u1" } },
      "doc-1",
      { id: "doc-1", created_by: "u1" }
    );
    expect(mine.allowed).toBe(true);

    const notMine = await service.evaluateAccess(
      rules,
      "update",
      { user: { id: "u1" } },
      "doc-1",
      { id: "doc-1", created_by: "someone-else" }
    );
    expect(notMine.allowed).toBe(false);
  });
});
