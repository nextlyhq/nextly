/**
 * The brand settings routes, as the mounted admin reaches them through the
 * catch-all: `GET` and `PATCH /email-templates/brand`.
 *
 * The permission comes from the HTTP method (a read for GET, an update for
 * PATCH, each or the permission to manage templates), so what this holds is
 * that `brand` is read as the route and not as a template id, and that only
 * those two methods reach it.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("the brand settings routes", () => {
  it("parses GET /email-templates/brand as a read of the settings", () => {
    expect(parseRestRoute(["email-templates", "brand"], "GET")).toMatchObject({
      service: "emailTemplates",
      operation: "single",
      method: "getBrand",
    });
  });

  it("parses PATCH /email-templates/brand as an update of the settings", () => {
    expect(parseRestRoute(["email-templates", "brand"], "PATCH")).toMatchObject(
      {
        service: "emailTemplates",
        operation: "update",
        method: "updateBrand",
      }
    );
  });

  it("does not read `brand` as a template id", () => {
    for (const method of ["GET", "PATCH"]) {
      expect(
        parseRestRoute(["email-templates", "brand"], method)?.routeParams
          ?.templateId
      ).toBeUndefined();
    }
  });

  it.each(["POST", "DELETE", "PUT"])("offers no %s on the settings", method => {
    expect(
      parseRestRoute(["email-templates", "brand"], method).method
    ).toBeUndefined();
  });

  it("still parses a template's own routes", () => {
    expect(parseRestRoute(["email-templates", "abc-123"], "GET")).toMatchObject(
      { method: "getTemplate", routeParams: { templateId: "abc-123" } }
    );
    expect(
      parseRestRoute(["email-templates", "brand", "preview"], "POST")
    ).toMatchObject({
      method: "previewTemplate",
      routeParams: { templateId: "brand" },
    });
  });
});
