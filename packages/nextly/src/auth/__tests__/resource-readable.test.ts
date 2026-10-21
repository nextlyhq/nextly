/**
 * Reading a system resource as an API key or a signed-in user, through
 * `canReadSystemResource`.
 *
 * Two properties separate the reader from a plausible broken one:
 *
 * - a key is judged on its stored slug, `read-<resource>`, so a grant stored
 *   under a slug of its own that names the same action and resource does not
 *   widen a key into the read;
 * - a lookup of the user's roles or grants that fails refuses the read rather
 *   than failing it, so a relationship withholds the row and carries on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasSpy, actorForUserSpy, roleSlugsSpy, decideSpy } = vi.hoisted(() => ({
  hasSpy: vi.fn(),
  actorForUserSpy: vi.fn(),
  roleSlugsSpy: vi.fn(),
  decideSpy: vi.fn(),
}));

vi.mock("../../di/container", () => ({
  container: { has: hasSpy, get: () => ({}) },
}));

// The roles lookup the reader falls back on when the whole actor cannot be
// resolved, since a super-admin passes without any grant.
vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  listRoleSlugsForUser: roleSlugsSpy,
}));

// The one decision, observed rather than replaced: every call is recorded and
// answered by the real decision.
vi.mock("../access/decide", async importOriginal => {
  const real = await importOriginal<typeof import("../access/decide")>();
  decideSpy.mockImplementation(real.decide);
  return { ...real, decide: decideSpy };
});

vi.mock("../access/resolve-actor", async importOriginal => ({
  ...(await importOriginal<typeof import("../access/resolve-actor")>()),
  actorForUser: actorForUserSpy,
}));

import { userActor } from "../access/actor";
import { apiKeyScope } from "../authenticated-scope";
import { canReadSystemResource } from "../resource-readable";

beforeEach(() => {
  vi.clearAllMocks();
  hasSpy.mockReturnValue(true);
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
    const scope = apiKeyScope([
      { slug: "read-users", action: "read", resource: "users" },
    ]);

    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(true);
  });
});

describe("canReadSystemResource — the decision", () => {
  it("asks the one decision about the system resource for a key's read", async () => {
    // A read no deviation keeps today's answer for, so its answer is the
    // decision's own: the decision must have been asked, about this target.
    const scope = apiKeyScope([
      { slug: "read-users", action: "read", resource: "users" },
    ]);

    await expect(
      canReadSystemResource("users", "owner-1", scope)
    ).resolves.toBe(true);
    expect(decideSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "key" }),
      "read",
      { kind: "system", slug: "users" }
    );
  });
});

describe("canReadSystemResource — signed-in users", () => {
  it("refuses, rather than fails, when the user's lookup fails", async () => {
    actorForUserSpy.mockRejectedValue(new Error("database busy"));
    roleSlugsSpy.mockRejectedValue(new Error("database busy"));

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      false
    );
  });

  it("admits a super-admin whose grants cannot be read, as no grant is needed", async () => {
    // The super-admin pass is asked before any grant, as the permission
    // check this replaced asked it first.
    actorForUserSpy.mockRejectedValue(new Error("grants unreadable"));
    roleSlugsSpy.mockResolvedValue(["super-admin"]);

    await expect(canReadSystemResource("users", "u1", undefined)).resolves.toBe(
      true
    );
  });

  it("refuses a user who is no super-admin when their grants cannot be read", async () => {
    // The control: the fallback admits on the super-admin role alone.
    actorForUserSpy.mockRejectedValue(new Error("grants unreadable"));
    roleSlugsSpy.mockResolvedValue(["editor"]);

    await expect(canReadSystemResource("users", "u1", undefined)).resolves.toBe(
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
    expect(actorForUserSpy).not.toHaveBeenCalled();
  });

  it("admits a user whose grants hold the read", async () => {
    // The control: the lookup answers, and the grant decides.
    actorForUserSpy.mockResolvedValue(
      userActor({
        userId: "u1",
        roles: ["editor"],
        permissions: [
          { slug: "read-media", action: "read", resource: "media" },
        ],
      })
    );

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      true
    );
  });
});
