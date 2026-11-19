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

describe("the caller's own identity routes", () => {
  it("routes listing the caller's own identities, naming no user from the path", () => {
    const route = parseRestRoute(["me", "identities"], "GET");
    expect(route).toMatchObject({
      service: "identities",
      operation: "list",
      method: "listUserIdentities",
    });
    // The request handler names the account from the session, as for
    // every /api/me route; the path gives no user id to trust.
    expect(route.routeParams?.userId).toBeUndefined();
  });

  it("routes unlinking one of the caller's own identities", () => {
    const route = parseRestRoute(["me", "identities", "i1"], "DELETE");
    expect(route).toMatchObject({
      service: "identities",
      operation: "delete",
      method: "unlinkUserIdentity",
      routeParams: { identityId: "i1" },
    });
    expect(route.routeParams?.userId).toBeUndefined();
  });

  it("does not route what the two routes do not name", () => {
    expect(parseRestRoute(["me", "identities"], "DELETE")).toEqual({});
    expect(parseRestRoute(["me", "identities", "i1"], "GET")).toEqual({});
    // A longer path is another route, not this one with its tail ignored.
    expect(
      parseRestRoute(["me", "identities", "i1", "extra"], "DELETE")
    ).toEqual({});
  });
});
