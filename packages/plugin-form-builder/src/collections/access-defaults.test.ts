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

  it("requires a signed-in user for update by default", () => {
    const access = accessWithDefaults(undefined);
    expect(call(access.update, { user: { id: "u1" } })).toBe(true);
    expect(call(access.update, { user: undefined })).toBe(false);
  });

  it("requires an administrative role to delete", () => {
    const access = accessWithDefaults(undefined);
    expect(call(access.delete, { roles: ["admin"] })).toBe(true);
    expect(call(access.delete, { roles: ["super-admin"] })).toBe(true);
    expect(call(access.delete, { roles: ["editor"] })).toBe(false);
    expect(call(access.delete, { roles: [] })).toBe(false);
  });

  it("takes the per-collection read and create defaults", () => {
    // Forms are publicly readable; submissions are publicly creatable. Those
    // are the only two axes the collections differ on.
    expect(accessWithDefaults(undefined, { read: true }).read).toBe(true);
    expect(accessWithDefaults(undefined, { create: true }).create).toBe(true);
  });

  it("defaults the axis a caller does not name to authenticated", () => {
    const access = accessWithDefaults(undefined, { create: true });
    expect(call(access.read, { user: { id: "u1" } })).toBe(true);
    expect(call(access.read, { user: undefined })).toBe(false);
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
