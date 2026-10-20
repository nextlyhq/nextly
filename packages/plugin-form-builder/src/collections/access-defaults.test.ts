import { describe, expect, it } from "vitest";

import { accessWithDefaults } from "./access-defaults";

/**
 * The access policy both contributed collections fall back to.
 *
 * Pinned directly because this is the one kind of duplication whose drift is
 * silent AND costly: two copies agree, one is tightened later, and the other
 * keeps the old rule while looking deliberate.
 */
describe("accessWithDefaults", () => {
  const call = (rule: unknown, args: unknown) =>
    typeof rule === "function" ? (rule as (a: unknown) => boolean)(args) : rule;

  /** The context a rule is given, for a caller holding `permissions`. */
  const holding = (
    permissions: string[],
    operation: string,
    collection = "form-submissions"
  ) => ({
    user: { id: "u1" },
    roles: ["admin", "editor", "super-admin"],
    permissions,
    principal: null,
    operation,
    collection,
  });

  it("admits update and delete only with the matching permission", () => {
    const access = accessWithDefaults(undefined);
    expect(
      call(access.update, holding(["update-form-submissions"], "update"))
    ).toBe(true);
    expect(
      call(access.delete, holding(["delete-form-submissions"], "delete"))
    ).toBe(true);
    // Role names are no longer read: an `admin` without the permission is refused.
    expect(
      call(access.update, holding(["read-form-submissions"], "update"))
    ).toBe(false);
    expect(call(access.delete, holding([], "delete"))).toBe(false);
  });

  it("refuses a visitor, who holds no permission", () => {
    const access = accessWithDefaults(undefined);
    const visitor = { ...holding([], "update"), user: null, roles: [] };
    expect(call(access.update, visitor)).toBe(false);
  });

  it("judges a renamed collection by its own permissions", () => {
    const access = accessWithDefaults(undefined);
    expect(
      call(
        access.update,
        holding(["update-contact-forms"], "update", "contact-forms")
      )
    ).toBe(true);
    expect(
      call(access.update, holding(["update-forms"], "update", "contact-forms"))
    ).toBe(false);
  });

  it("takes the per-collection read and create defaults", () => {
    // Forms are publicly readable; submissions are publicly creatable. Those
    // are the only two axes the collections differ on.
    expect(accessWithDefaults(undefined, { read: true }).read).toBe(true);
    expect(accessWithDefaults(undefined, { create: true }).create).toBe(true);
  });

  it("defaults the axis a caller does not name to the permission", () => {
    const access = accessWithDefaults(undefined, { create: true });
    expect(call(access.read, holding(["read-form-submissions"], "read"))).toBe(
      true
    );
    expect(call(access.read, holding([], "read"))).toBe(false);
  });

  it("lets a host CLOSE an operation, not just widen it", () => {
    // `??` rather than `||`: a host passing `false` means "nobody", and `||`
    // would have replaced it with the plugin default — quietly reopening an
    // operation the host had shut.
    const access = accessWithDefaults(
      { read: false, create: false, update: false, delete: false },
      { read: true }
    );
    expect(access.read).toBe(false);
    expect(access.create).toBe(false);
    expect(access.update).toBe(false);
    expect(access.delete).toBe(false);
  });

  it("lets a host replace a rule with its own function", () => {
    const mine = () => true;
    expect(accessWithDefaults({ delete: mine }).delete).toBe(mine);
  });
});
