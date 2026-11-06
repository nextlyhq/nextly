/**
 * How an API key caller sees other keys' owners.
 *
 * An owner is a person, shown only to a caller who may read users. A key
 * carrying its maker's super-admin authority holds every permission, as every
 * other way in treats it, so it sees owners even where its grant list lacks
 * `read-users`.
 */
import { describe, expect, it } from "vitest";

import { apiKeyViewer, type ApiKeyMeta } from "../api-key-service";

const KEY = {
  id: "key-2",
  name: "Another key",
  owner: { id: "owner-1", name: "Owner", email: "owner@example.test" },
} as unknown as ApiKeyMeta;

describe("apiKeyViewer, for an API key caller", () => {
  it("shows owners to a key carrying its maker's super-admin authority", async () => {
    const see = await apiKeyViewer({
      userId: "admin-1",
      authMethod: "api-key",
      permissions: [],
      keyHoldsSuperAdmin: true,
      keyStandingAskedAt: performance.now(),
    });

    expect(see(KEY).owner).toEqual(KEY.owner);
  });

  it("hides owners from a key whose scope may not read users", async () => {
    // POPULATION CONTROL: the same key without the authority.
    const see = await apiKeyViewer({
      userId: "admin-1",
      authMethod: "api-key",
      permissions: [],
    });

    expect(see(KEY).owner).toBeNull();
  });
});
