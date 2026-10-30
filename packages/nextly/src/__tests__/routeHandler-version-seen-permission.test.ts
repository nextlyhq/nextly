/**
 * Which permission marking a version seen takes at the route gate.
 *
 * The collection gate the route delegates to is where a collection's
 * code-defined read rule and the caller's grants are judged. It is replaced by
 * a fake that admits a caller holding the named permission and refuses
 * everyone else, so each case asserts the OUTCOME for a caller with a given
 * set of grants: a person the document's read gate refuses is refused here,
 * before any version method runs, so no marker can move.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const granted = vi.hoisted(() => new Set<string>());

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return {
    ...actual,
    requireCollectionAccess: vi.fn(
      async (_req: Request, action: string, slug: string) =>
        granted.has(`${action}-${slug}`)
          ? { userId: "ana", userEmail: "ana@x.test", authMethod: "session" }
          : { statusCode: 403, error: "Forbidden" }
    ),
  };
});

import { parseRestRoute } from "../route-handler/route-parser";
import { _resolveAuthorizationForTest as resolveAuthorization } from "../routeHandler";

/** Whether a caller holding exactly `grants` may mark a version seen. */
async function admits(segments: string[], grants: string[]): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const route = parseRestRoute(segments, "PUT");
  expect(route.method).toBeDefined();
  const result = await resolveAuthorization(
    new Request(`http://localhost/api/${segments.join("/")}`, {
      method: "PUT",
    }),
    route.service as string,
    route.method as string,
    route.operation as string,
    route.routeParams,
    "PUT"
  );
  // `null` is a visitor admitted, which a signed-in request never is.
  return result !== null && !("statusCode" in result);
}

const ENTRY = [
  "collections",
  "posts",
  "entries",
  "e1",
  "versions",
  "3",
  "seen",
];
const SINGLE = ["singles", "masthead", "versions", "3", "seen"];

describe("marking a version seen at the route gate", () => {
  beforeEach(() => granted.clear());

  it.each([
    ["an entry", ENTRY, "posts"],
    ["a Single", SINGLE, "masthead"],
  ])(
    "admits a reader of %s, who needs no update grant",
    async (_, segments, slug) => {
      expect(await admits(segments, [`read-${slug}`])).toBe(true);
    }
  );

  it.each([
    ["an entry", ENTRY, "posts"],
    ["a Single", SINGLE, "masthead"],
  ])(
    "refuses a person the read gate refuses on %s, even holding update",
    async (_, segments, slug) => {
      expect(await admits(segments, [])).toBe(false);
      expect(await admits(segments, [`update-${slug}`])).toBe(false);
    }
  );
});
