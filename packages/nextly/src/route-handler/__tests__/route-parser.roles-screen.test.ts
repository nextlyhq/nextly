/**
 * The roles-screen route: `GET /roles/screen` reaches its handler rather than
 * being read as a request for the role whose id is "screen", and the role
 * routes beside it keep their meaning.
 *
 * @module route-handler/__tests__/route-parser.roles-screen.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("parsing the roles-screen route", () => {
  it("routes GET /roles/screen to its handler", () => {
    expect(parseRestRoute(["roles", "screen"], "GET")).toMatchObject({
      service: "rolesScreen",
      method: "getRolesScreen",
    });
  });

  it("still reads any other id as a role", () => {
    expect(parseRestRoute(["roles", "role-123"], "GET")).toMatchObject({
      service: "rbac",
      method: "getRoleById",
      routeParams: { roleId: "role-123" },
    });
  });

  it.each([
    [["roles", "screen"], "POST"],
    [["roles", "screen"], "PATCH"],
    [["roles", "screen", "permissions"], "GET"],
  ] as const)("does not route %j %s to it", (path, verb) => {
    expect(parseRestRoute([...path], verb).method).not.toBe("getRolesScreen");
  });
});
