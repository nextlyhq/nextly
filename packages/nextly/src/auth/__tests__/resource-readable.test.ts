/**
 * Reading a system resource as an API key or a signed-in user, through
 * `canReadSystemResource`.
 *
 * The properties that separate the reader from a plausible broken one:
 *
 * - a key is judged on its stored slug, `read-<resource>`, so a grant stored
 *   under a slug of its own that names the same action and resource does not
 *   widen a key into the read;
 * - each lookup of a user that fails counts as holding nothing of its kind and
 *   refuses only what it would have given: a failed role lookup keeps the
 *   grants that were read, a failed grant lookup keeps a super-admin's role,
 *   and the read is refused rather than failed;
 * - a `manage-` permission does not count as the read, as it never has here;
 * - the answer is the one decision's, asked about the resource.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasSpy, roleSlugsSpy, grantsSpy, decidePermissionSpy } = vi.hoisted(
  () => ({
    hasSpy: vi.fn(),
    roleSlugsSpy: vi.fn(),
    grantsSpy: vi.fn(),
    decidePermissionSpy: vi.fn(),
  })
);

vi.mock("../../di/container", () => ({
  container: { has: hasSpy, get: () => ({}) },
}));

// The two lookups a signed-in user is resolved from, so each case names what
// each one answers, or that it fails.
vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  listRoleSlugsForUser: roleSlugsSpy,
  listEffectiveGrants: grantsSpy,
}));

// The one decision, observed rather than replaced: every call is recorded and
// answered by the real decision.
vi.mock("../access/decide", async importOriginal => {
  const real = await importOriginal<typeof import("../access/decide")>();
  decidePermissionSpy.mockImplementation(real.decidePermission);
  return { ...real, decidePermission: decidePermissionSpy };
});

import { recordingDeviations } from "../access/deviations";
import { apiKeyScope, apiKeyScopeFrom } from "../authenticated-scope";
import { canReadSystemResource } from "../resource-readable";

/** A grant of `action` on `resource`, under its stored slug. */
const grant = (action: string, resource: string) => ({
  slug: `${action}-${resource}`,
  action,
  resource,
});

beforeEach(() => {
  vi.clearAllMocks();
  hasSpy.mockReturnValue(true);
  roleSlugsSpy.mockResolvedValue(["editor"]);
  grantsSpy.mockResolvedValue([]);
});

describe("canReadSystemResource — API keys", () => {
  it("refuses a key whose grant for the read is stored under a slug of its own", async () => {
    const scope = apiKeyScope([
      { slug: "view-users", action: "read", resource: "users" },
    ]);

    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(false);
  });

  it("admits a key holding the read under its stored slug", async () => {
    // The control: the same key with the slug the read is stored under.
    const scope = apiKeyScope([grant("read", "users")]);

    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(true);
  });

  it("counts a key's stored manage slug as its read, where its scope carries no rows", async () => {
    // A scope of slugs alone is judged by its stored slugs, and
    // `manage-media` still counts as read on media there as at every gate.
    const scope = apiKeyScopeFrom({ permissions: ["manage-media"] });

    await expect(
      canReadSystemResource("media", "owner-1", scope)
    ).resolves.toBe(true);
    // The control: it counts on media alone.
    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(false);
  });
});

describe("canReadSystemResource — the decision", () => {
  it("asks the one decision about the resource for a key's read", async () => {
    // A read no deviation keeps today's answer for, so its answer is the
    // decision's own: the decision must have been asked, about this resource.
    const scope = apiKeyScope([grant("read", "users")]);

    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(true);
    expect(decidePermissionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "key" }),
      "read",
      "users"
    );
  });

  it("counts a manage permission on the resource as its read, as the decision does", async () => {
    // `manage-media` still counts as read on media, so the reader answers as
    // the decision does, and nothing deviates.
    grantsSpy.mockResolvedValue([grant("manage", "media")]);

    const { result, deviations } = await recordingDeviations(() =>
      canReadSystemResource("media", "u1", undefined)
    );

    expect(result).toBe(true);
    expect(deviations).toEqual([]);
  });

  it("does not count a manage permission on another resource", async () => {
    // The control: `manage-settings` counts on settings alone, so a read of
    // media is still refused.
    grantsSpy.mockResolvedValue([grant("manage", "settings")]);

    await expect(
      canReadSystemResource("media", "u1", undefined)
    ).resolves.toBe(false);
  });
});

describe("canReadSystemResource — signed-in users", () => {
  it("admits a user whose grants hold the read", async () => {
    // The control: both lookups answer, and the grant decides.
    grantsSpy.mockResolvedValue([grant("read", "media")]);

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      true
    );
  });

  it("keeps the grants that were read when the role lookup fails", async () => {
    roleSlugsSpy.mockRejectedValue(new Error("roles unreadable"));
    grantsSpy.mockResolvedValue([grant("read", "media")]);

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      true
    );
  });

  it("admits a super-admin whose grants cannot be read, as no grant is needed", async () => {
    roleSlugsSpy.mockResolvedValue(["super-admin"]);
    grantsSpy.mockRejectedValue(new Error("grants unreadable"));

    await expect(canReadSystemResource("users", "u1", undefined)).resolves.toBe(
      true
    );
  });

  it("refuses a user who is no super-admin when their grants cannot be read", async () => {
    // The control: a failed grant lookup gives nothing but a super-admin pass.
    grantsSpy.mockRejectedValue(new Error("grants unreadable"));

    await expect(canReadSystemResource("users", "u1", undefined)).resolves.toBe(
      false
    );
  });

  it("refuses, rather than fails, when every lookup fails", async () => {
    roleSlugsSpy.mockRejectedValue(new Error("database busy"));
    grantsSpy.mockRejectedValue(new Error("database busy"));

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      false
    );
  });

  it("refuses a user without the service, and looks nothing up to say so", async () => {
    // Without the access-control service a signed-in user is refused whatever
    // they hold, so resolving their roles and grants would only cost reads.
    hasSpy.mockReturnValue(false);

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      false
    );
    expect(roleSlugsSpy).not.toHaveBeenCalled();
    expect(grantsSpy).not.toHaveBeenCalled();
  });
});
