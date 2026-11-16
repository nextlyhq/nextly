/**
 * What a key authentication is resolved to: the bound on its maker's
 * super-admin authority.
 *
 * A scope made from the answer may be kept past its request, so the
 * authority it carries must end when the maker's role does. The answer
 * therefore carries the maker's soonest role expiry, read before the role
 * itself as a session's is, so a role lapsing between the two reads leaves
 * the authority bounded rather than unbounded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSuperAdmin,
  resolveUserRoles,
} from "../../../../services/lib/permissions";
import { resolveKeyCaller } from "../api-key-service";

vi.mock("../../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(),
  resolveUserRoles: vi.fn(),
}));

const service = {
  resolveApiKeyGrants: vi.fn().mockResolvedValue([]),
  resolveApiKeyRoles: vi.fn().mockResolvedValue([]),
};

function key(tokenType: "full-access" | "read-only") {
  return { id: "key-1", userId: "maker", tokenType, roleId: null };
}

const EXPIRES = 1_900_000_000_000;

describe("resolveKeyCaller", () => {
  beforeEach(() => {
    vi.mocked(isSuperAdmin).mockReset();
    vi.mocked(resolveUserRoles).mockReset();
  });

  it("carries the maker's soonest role expiry with the authority", async () => {
    vi.mocked(resolveUserRoles).mockResolvedValue({
      roleIds: new Set(["super-admin"]),
      validUntil: EXPIRES,
    });
    vi.mocked(isSuperAdmin).mockResolvedValue(true);

    const resolved = await resolveKeyCaller(service, key("full-access"));

    expect(resolved.keyHoldsSuperAdmin).toBe(true);
    expect(resolved.keyHoldsSuperAdminUntil).toBe(EXPIRES);
  });

  it("carries when the maker's standing was asked, for the scope's bound to count from", async () => {
    vi.mocked(resolveUserRoles).mockResolvedValue({
      roleIds: new Set(["super-admin"]),
      validUntil: undefined,
    });
    vi.mocked(isSuperAdmin).mockResolvedValue(true);

    const resolved = await resolveKeyCaller(service, {
      ...key("full-access"),
      standingAskedAt: 1234,
    });

    expect(resolved.keyStandingAskedAt).toBe(1234);
  });

  it("ends the authority at the key's own expiry where that comes before the role's", async () => {
    vi.mocked(resolveUserRoles).mockResolvedValue({
      roleIds: new Set(["super-admin"]),
      validUntil: EXPIRES,
    });
    vi.mocked(isSuperAdmin).mockResolvedValue(true);

    const resolved = await resolveKeyCaller(service, {
      ...key("full-access"),
      expiresAt: EXPIRES - 1_000,
    });

    expect(resolved.keyHoldsSuperAdminUntil).toBe(EXPIRES - 1_000);
  });

  it("reads the expiry before it asks whether the maker is a super-admin", async () => {
    const order: string[] = [];
    vi.mocked(resolveUserRoles).mockImplementation(async () => {
      order.push("expiry");
      return { roleIds: new Set<string>(), validUntil: EXPIRES };
    });
    vi.mocked(isSuperAdmin).mockImplementation(async () => {
      order.push("super-admin");
      return true;
    });

    await resolveKeyCaller(service, key("full-access"));

    expect(order).toEqual(["expiry", "super-admin"]);
  });

  it("carries no authority, and so no expiry, for a key that is not full-access", async () => {
    vi.mocked(isSuperAdmin).mockResolvedValue(true);

    const resolved = await resolveKeyCaller(service, key("read-only"));

    expect(resolved.keyHoldsSuperAdmin).toBe(false);
    expect(resolved.keyHoldsSuperAdminUntil).toBeUndefined();
    expect(isSuperAdmin).not.toHaveBeenCalled();
  });

  it("carries no authority where the maker's roles cannot be read", async () => {
    vi.mocked(resolveUserRoles).mockRejectedValue(new Error("down"));
    vi.mocked(isSuperAdmin).mockResolvedValue(true);

    const resolved = await resolveKeyCaller(service, key("full-access"));

    expect(resolved.keyHoldsSuperAdmin).toBe(false);
  });
});
