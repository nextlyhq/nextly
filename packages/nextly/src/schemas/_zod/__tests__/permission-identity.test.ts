/**
 * A permission's slug is its identity, so composing and reading it must agree.
 *
 * The failure this guards is quiet in a way that makes it hard to find: a
 * producer writing `users-read` and a guard reading `read-users` do not raise
 * anything. The lookup misses, the grant authorizes nothing, and the admin
 * panel still lists the permission as assigned. It denies rather than escalates,
 * which is the safe direction and also the reason nobody notices.
 *
 * That is not hypothetical here. `addPermissionToRole` composed its fallback
 * slug as `resource-action` while every reader composed `action-resource`, and
 * it stayed invisible because the two internal callers pass an explicit slug.
 * Only the REST surface, which passes neither a name nor a slug, reached the
 * reversed branch.
 */
import { describe, expect, it } from "vitest";

import { parsePermissionSlug } from "../../../plugins/routes/permission-slug";
import { permissionName, permissionSlug } from "../rbac";

describe("permissionSlug", () => {
  it("puts the action first", () => {
    // The order IS the contract. Reversed, every lookup in the codebase misses.
    expect(permissionSlug("read", "users")).toBe("read-users");
    expect(permissionSlug("delete", "api-keys")).toBe("delete-api-keys");
  });

  it("round-trips through the parser that reads it back", () => {
    // Compose and parse are inverses maintained in different modules, so this
    // asserts they still agree — including for a hyphenated resource, where
    // splitting on the wrong hyphen would silently reassign part of the
    // resource to the action.
    for (const [action, resource] of [
      ["read", "users"],
      ["export", "form-submissions"],
      ["update", "email-templates"],
    ] as const) {
      expect(parsePermissionSlug(permissionSlug(action, resource))).toEqual({
        action,
        resource,
      });
    }
  });
});

describe("permissionName", () => {
  it("title-cases both halves in reading order", () => {
    expect(permissionName("delete", "api-keys")).toBe("Delete Api Keys");
    expect(permissionName("read", "users")).toBe("Read Users");
  });
});
