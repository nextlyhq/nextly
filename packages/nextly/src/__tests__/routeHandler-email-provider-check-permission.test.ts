/**
 * Which permission checking a provider's settings takes at the route gate.
 *
 * New settings are checked as an addition is; a saved provider's settings,
 * which use its stored secrets, as an edit is. The permission checks the gate
 * delegates to are replaced by a fake that admits a caller holding any of the
 * named grants, so each case asserts the OUTCOME for a caller with a given set
 * of grants.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => new Set<string>());

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  const answer = (holds: boolean) =>
    holds
      ? { userId: "ana", userEmail: "ana@x.test", authMethod: "session" }
      : { statusCode: 403, error: "Forbidden" };
  return {
    ...actual,
    requirePermission: vi.fn(
      async (_req: Request, action: string, resource: string) =>
        answer(granted.has(`${action}-${resource}`))
    ),
    requireAnyPermission: vi.fn(
      async (
        _req: Request,
        list: Array<{ action: string; resource: string }>
      ) =>
        answer(
          list.some(({ action, resource }) =>
            granted.has(`${action}-${resource}`)
          )
        )
    ),
  };
});

import { parseRestRoute } from "../route-handler/route-parser";
import { _resolveAuthorizationForTest as resolveAuthorization } from "../routeHandler";

/** Whether a caller holding exactly `grants` may make this request. */
async function admits(
  segments: string[],
  httpMethod: string,
  grants: string[]
): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const route = parseRestRoute(segments, httpMethod);
  expect(route.method).toBeDefined();
  const result = await resolveAuthorization(
    new Request(`http://localhost/api/${segments.join("/")}`, {
      method: httpMethod,
    }),
    route.service as string,
    route.method as string,
    route.operation as string,
    route.routeParams,
    httpMethod
  );
  return !("statusCode" in result);
}

const CHECK = ["email-providers", "check"];
const CHECK_SAVED = ["email-providers", "p1", "check"];

describe("checking a provider's settings at the route gate", () => {
  beforeEach(() => granted.clear());

  it.each([
    ["adds providers", "create-email-providers"],
    ["manages providers", "manage-email-providers"],
  ])("admits a person who %s to check new settings", async (_, grant) => {
    expect(await admits(CHECK, "POST", [grant])).toBe(true);
  });

  it.each([
    ["edits providers", "update-email-providers"],
    ["manages providers", "manage-email-providers"],
  ])(
    "admits a person who %s to check a saved provider's settings",
    async (_, grant) => {
      expect(await admits(CHECK_SAVED, "POST", [grant])).toBe(true);
    }
  );

  it("refuses a person who may only add providers a check of a saved one", async () => {
    // A saved provider's check tries its stored secrets, so only someone who
    // may change the provider may point them at another server. The new
    // settings' route refuses an id in its body; the dispatcher's tests hold
    // that.
    expect(await admits(CHECK_SAVED, "POST", ["create-email-providers"])).toBe(
      false
    );
  });

  it("refuses a person who may only read or delete providers", async () => {
    for (const route of [CHECK, CHECK_SAVED]) {
      expect(await admits(route, "POST", [])).toBe(false);
      expect(await admits(route, "POST", ["read-email-providers"])).toBe(false);
      expect(await admits(route, "POST", ["delete-email-providers"])).toBe(
        false
      );
    }
  });

  it("leaves adding a provider to the create grant", async () => {
    const ADD = ["email-providers"];
    expect(await admits(ADD, "POST", ["update-email-providers"])).toBe(false);
    expect(await admits(ADD, "POST", ["create-email-providers"])).toBe(true);
  });
});
