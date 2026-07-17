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
