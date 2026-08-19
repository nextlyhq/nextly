// `POST /api/singles/{slug}/publish-all` — the Single equivalent of the
// collection entry's publish-all.
//
// The route is a named sub-resource on a Single, so the risks are that it
// shadows a neighbouring one or is shadowed by it, and that the verb gate is
// real. Each test below therefore carries the case that would pass if the
// branch matched too widely.

import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("singles publish-all route", () => {
  it("parses as a write on the document", () => {
    expect(
      parseRestRoute(["singles", "homepage", "publish-all"], "POST")
    ).toMatchObject({
      service: "singles",
      // Authorized as an `update`: no route-level gate can express `publish`,
      // so the service checks `publish-{slug}` for itself on top of this.
      operation: "update",
      method: "publishAllSingleLocales",
      routeParams: { slug: "homepage" },
    });
  });

  it("claims only POST", () => {
    // A branch that ignored the verb would answer here too, turning a read of
    // the Single into a publish of every language.
    for (const verb of ["GET", "PATCH", "DELETE", "PUT"]) {
      expect(
        parseRestRoute(["singles", "homepage", "publish-all"], verb).method
      ).not.toBe("publishAllSingleLocales");
    }
  });

  it("claims nothing deeper than the sub-resource", () => {
    expect(
      parseRestRoute(["singles", "homepage", "publish-all", "de"], "POST")
        .method
    ).not.toBe("publishAllSingleLocales");
  });

  it("leaves the neighbouring Single routes matching", () => {
    // The branch sits above the schema routes and below the version ones, so
    // both sides are asserted rather than assumed.
    expect(parseRestRoute(["singles", "homepage"], "GET").method).toBe(
      "getSingleDocument"
    );
    expect(parseRestRoute(["singles", "homepage"], "PATCH").method).toBe(
      "updateSingleDocument"
    );
    expect(
      parseRestRoute(["singles", "homepage", "schema"], "GET").method
    ).toBe("getSingleSchema");
    expect(
      parseRestRoute(["singles", "homepage", "versions"], "GET").method
    ).toBe("listSingleVersions");
  });

  it("does not answer for a collection of the same shape", () => {
    // `publish-all` on a collection nests under an entry; a Single has no entry
    // id, so the two paths must not be confusable.
    expect(
      parseRestRoute(["collections", "posts", "publish-all"], "POST").method
    ).not.toBe("publishAllSingleLocales");
  });
});
