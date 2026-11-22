/**
 * Which permission publishing or unpublishing a Single's chosen parts takes at the route gate.
 *
 * Each is admitted on the grant of its own action on the Single, as publishing every language of
 * it is: an editor who may publish the Single, and holds no schema permission, may publish its
 * parts. The plausible broken implementation leaves the routes out of the Single document's
 * methods, so they fall through to the Single definition's branch and ask for the permissions that
 * manage schemas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => new Set<string>());

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  const answer = (allowed: boolean) =>
    allowed
      ? { userId: "ana", userEmail: "ana@x.test", authMethod: "session" }
      : { statusCode: 403, error: "Forbidden" };
  return {
    ...actual,
    requireLifecycleAccess: vi.fn(
      async (_req: Request, action: string, slug: string) =>
        answer(granted.has(`${action}-${slug}`))
    ),
    requireCollectionAccess: vi.fn(
      async (_req: Request, action: string, slug: string) =>
        answer(granted.has(`${action}-${slug}`))
    ),
    // The permissions that manage schemas: never held here.
    requireAllPermissions: vi.fn(async () => answer(false)),
  };
});

import { parseRestRoute } from "../route-handler/route-parser";
import { _resolveAuthorizationForTest as resolveAuthorization } from "../routeHandler";

/** Whether a caller holding exactly `grants` is admitted to POST `segments`. */
async function admits(segments: string[], grants: string[]): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const route = parseRestRoute(segments, "POST");
  expect(route.method).toBeDefined();
  const result = await resolveAuthorization(
    new Request(`http://localhost/api/${segments.join("/")}`, {
      method: "POST",
    }),
    route.service as string,
    route.method as string,
    route.operation as string,
    route.routeParams,
    "POST"
  );
  return result !== null && !("statusCode" in result);
}

describe("publishing a Single's chosen parts at the route gate", () => {
  beforeEach(() => granted.clear());

  it.each([
    ["publish", "publish-masthead"],
    ["unpublish", "unpublish-masthead"],
  ])("admits a caller holding its own grant for %s", async (action, grant) => {
    expect(await admits(["singles", "masthead", action], [grant])).toBe(true);
  });

  it.each(["publish", "unpublish"])(
    "refuses a caller without that grant for %s",
    async action => {
      expect(
        await admits(["singles", "masthead", action], ["read-masthead"])
      ).toBe(false);
    }
  );
});
