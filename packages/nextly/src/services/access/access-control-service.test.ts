import { describe, it, expect } from "vitest";

import type { RequestContext } from "@nextly/collections/fields/types/base";

import { AccessControlService } from "./access-control-service";
import { DEFAULT_OWNER_FIELD } from "./types";
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

  const ownerOnly: CollectionAccessRules = { read: { type: "owner-only" } };

  // With no default passed, the shared service falls back to the generic
  // camelCase `createdBy` used by singles/components (which never get the
  // auto-stamped system column) and any generic caller.
  it("filters reads on the generic createdBy field by default", async () => {
    const result = await service.evaluateAccess(ownerOnly, "read", {
      user: { id: "u1" },
    });
    expect(result.allowed).toBe(true);
    expect(result.query).toEqual({ createdBy: { equals: "u1" } });
  });

  // A collection caller passes DEFAULT_OWNER_FIELD, so the read filter targets
  // the snake_case `created_by` column the create path actually stamps.
  it("filters reads on created_by when the collection default is passed", async () => {
    const result = await service.evaluateAccess(
      ownerOnly,
      "read",
      { user: { id: "u1" } },
      undefined,
      undefined,
      DEFAULT_OWNER_FIELD
    );
    expect(result.allowed).toBe(true);
    expect(result.query).toEqual({ created_by: { equals: "u1" } });
  });

  it("compares ownership against created_by on update for collections", async () => {
    const rules: CollectionAccessRules = { update: { type: "owner-only" } };
    const mine = await service.evaluateAccess(
      rules,
      "update",
      { user: { id: "u1" } },
      "doc-1",
      { id: "doc-1", created_by: "u1" },
      DEFAULT_OWNER_FIELD
    );
    expect(mine.allowed).toBe(true);

    const notMine = await service.evaluateAccess(
      rules,
      "update",
      { user: { id: "u1" } },
      "doc-1",
      { id: "doc-1", created_by: "someone-else" },
      DEFAULT_OWNER_FIELD
    );
    expect(notMine.allowed).toBe(false);
  });
});

// The publish lifecycle is a distinct access operation, evaluated against its
// own stored rule. A caller allowed to update must not be assumed able to
// publish, and vice versa — the two are keyed separately.
describe("AccessControlService publish lifecycle operations", () => {
  const service = new AccessControlService();
  const rules: CollectionAccessRules = {
    update: { type: "role-based", allowedRoles: ["author", "editor"] },
    publish: { type: "role-based", allowedRoles: ["editor"] },
    unpublish: { type: "role-based", allowedRoles: ["editor"] },
  };

  it("evaluates publish against the publish rule, not update", async () => {
    // An author may update but not publish; the two rules diverge and the
    // operation selects which one applies.
    const author = { id: "u1", roles: ["author"] };

    const canUpdate = await service.evaluateAccess(rules, "update", {
      user: author,
    });
    const canPublish = await service.evaluateAccess(rules, "publish", {
      user: author,
    });

    expect(canUpdate.allowed).toBe(true);
    expect(canPublish.allowed).toBe(false);
  });

  it("allows publish for a role the publish rule names", async () => {
    const editor = { id: "u2", roles: ["editor"] };

    const result = await service.evaluateAccess(rules, "publish", {
      user: editor,
    });

    expect(result.allowed).toBe(true);
  });

  it("evaluates unpublish against its own rule", async () => {
    const author = { id: "u3", roles: ["author"] };

    const result = await service.evaluateAccess(rules, "unpublish", {
      user: author,
    });

    expect(result.allowed).toBe(false);
  });

  it("defaults an unspecified publish rule to public access", async () => {
    // No publish rule means the stored layer does not gate it — RBAC's
    // `publish-<slug>` permission remains the only gate, exactly as a missing
    // update rule leaves update to RBAC.
    const updateOnly: CollectionAccessRules = {
      update: { type: "role-based", allowedRoles: ["editor"] },
    };

    const result = await service.evaluateAccess(updateOnly, "publish", {
      user: { id: "u4", roles: ["nobody"] },
    });

    expect(result.allowed).toBe(true);
  });
});
