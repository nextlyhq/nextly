/**
 * The account-link endpoints are gone.
 *
 * They read and unlinked rows in an `accounts` table nothing has written since
 * the auth rewrite, so they could only ever answer with an empty list or a
 * not-found. Keeping a route that cannot return data invites a client to build
 * against it. This pins their absence: an unmatched route is the empty object,
 * which the caller turns into a 404.
 */
import { describe, it, expect } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("user account-link routes", () => {
  it("does not route listing a user's linked accounts", () => {
    expect(parseRestRoute(["users", "u1", "accounts"], "GET")).toEqual({});
  });

  it("does not route unlinking an account", () => {
    expect(
      parseRestRoute(["users", "u1", "accounts", "github", "123456"], "DELETE")
    ).toEqual({});
  });

  it("still routes the user endpoints that remain", () => {
    // The positive control: the parser is reachable and the users prefix works,
    // so the two refusals above are the routes being absent rather than the
    // whole suite asking the wrong question.
    expect(parseRestRoute(["users", "u1"], "GET")).toMatchObject({
      service: "users",
      method: "getUserById",
    });
    expect(parseRestRoute(["users", "u1", "roles"], "POST")).toMatchObject({
      service: "rbac",
    });
  });
});
