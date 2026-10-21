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

const { hasSpy, actorForUserSpy } = vi.hoisted(() => ({
  hasSpy: vi.fn(),
  actorForUserSpy: vi.fn(),
}));

vi.mock("../../di/container", () => ({
  container: { has: hasSpy, get: () => ({}) },
}));

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

describe("canReadSystemResource — signed-in users", () => {
  it("refuses, rather than fails, when the user's lookup fails", async () => {
    actorForUserSpy.mockRejectedValue(new Error("database busy"));

    await expect(canReadSystemResource("media", "u1", undefined)).resolves.toBe(
      false
    );
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
