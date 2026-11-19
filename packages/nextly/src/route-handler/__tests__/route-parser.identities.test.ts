/**
 * The identities routes: a user's own external identities, listed and
 * unlinked under the users resource the role-assignment routes already
 * nest in, with the params each handler reads.
 *
 * The negative controls matter as much as the mappings: another verb on
 * each path, and a longer path, are not these routes with their tail
 * ignored — an unrouted request must reach nothing.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("user identity routes", () => {
  it("routes listing a user's identities", () => {
    expect(parseRestRoute(["users", "u1", "identities"], "GET")).toMatchObject({
      service: "identities",
      operation: "list",
      method: "listUserIdentities",
      routeParams: { userId: "u1" },
    });
  });

  it("routes unlinking one identity, naming both the user and the identity", () => {
    expect(
      parseRestRoute(["users", "u1", "identities", "i1"], "DELETE")
    ).toMatchObject({
      service: "identities",
      operation: "delete",
      method: "unlinkUserIdentity",
      routeParams: { userId: "u1", identityId: "i1" },
    });
  });

  it("does not route what the two routes do not name", () => {
    // Another verb on each path: none of these is an identities route.
    expect(parseRestRoute(["users", "u1", "identities"], "DELETE")).toEqual({});
    expect(parseRestRoute(["users", "u1", "identities"], "POST")).toEqual({});
    expect(parseRestRoute(["users", "u1", "identities", "i1"], "GET")).toEqual(
      {}
    );
    expect(
      parseRestRoute(["users", "u1", "identities", "i1"], "PATCH")
    ).toEqual({});
  });
});
