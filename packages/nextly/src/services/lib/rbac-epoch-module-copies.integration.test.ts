/**
 * A role change made through one copy of the permission modules retires what
 * every other copy in the process keeps, at once.
 *
 * A production build of a Next.js app loads this package's modules more than
 * once in one server process: each route and rendering layer gets its own
 * copy, while the service container is shared on `globalThis`. So a role
 * edited through the admin API's copy, and a check asked through a service
 * another copy registered, such as a release's readiness asking the
 * collections handler, meet two copies of the role version. The copy that
 * made the change saw it at once; every other copy kept serving the grant it
 * had cached until its next read of the shared row, as another instance does.
 * A release then read Ready for a document its author had just lost the right
 * to publish.
 *
 * Time is held still, so the read interval never passes and only a role
 * version every copy shares can retire the cached grant.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../config";
import { seedPlainAuthor } from "../../domains/releases/__tests__/helpers/live-author";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

import { hasPermission } from "./permissions";
import { resetEpochForTests } from "./rbac-epoch";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

interface RolesApi {
  roles: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
    setPermissions(a: {
      roleId: string;
      permissionIds: string[];
    }): Promise<unknown>;
  };
}

/** Another copy of the permission modules, as a second bundle loads them. */
async function anotherCopy(): Promise<typeof import("./permissions")> {
  vi.resetModules();
  return import("./permissions");
}

describe("a role change and the other copies of the permission modules", () => {
  it("retires a grant another copy had cached, without waiting for the read interval", async () => {
    // The epoch module is not rebuilt with the database, so its stamp is reset
    // with it (see super-admin-cache-invalidation).
    resetEpochForTests();
    const t = (current = await createTestNextly({
      dialect: "sqlite",
      collections: [
        defineCollection({
          slug: "notes",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    }));
    const author = await seedPlainAuthor(t);
    await grantTo(t, author, "publish", ["notes"]);
    const api = t.nextly as unknown as RolesApi;
    const role = (await api.roles.find({ limit: 1000 })).items.find(found =>
      found.slug.startsWith("may-publish-")
    );
    if (role === undefined) throw new Error("no publish role");

    const other = await anotherCopy();
    // Held still from here: the cached grant can be retired only by the role
    // version the change moves, never by the interval running out.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await other.hasPermission(author, "publish", "notes")).toBe(true);

    // Through this copy, as the admin API's copy makes the change.
    await api.roles.setPermissions({ roleId: role.id, permissionIds: [] });

    expect(await hasPermission(author, "publish", "notes")).toBe(false);
    expect(await other.hasPermission(author, "publish", "notes")).toBe(false);
  });
});
