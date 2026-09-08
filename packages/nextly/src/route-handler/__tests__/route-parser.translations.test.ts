/**
 * The translation worklist route.
 *
 * The language is a QUERY parameter rather than a path segment, so the route is
 * bare. That is the thing worth pinning: an unmatched sub-path must not fall
 * through to the list, or `/api/translations/es` would quietly serve the whole
 * worklist while looking like it asked for one language — the same failure the
 * webhook reveal-secret route guards against.
 */
import { describe, it, expect } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("translation worklist route", () => {
  it("parses the worklist read", () => {
    expect(parseRestRoute(["translations"], "GET")).toMatchObject({
      service: "translations",
      operation: "list",
      method: "getTranslationWorklist",
    });
  });

  it("does not serve the worklist from a sub-path", () => {
    // `/api/translations/es` reads as "the Spanish worklist" and is not a route
    // this endpoint offers. Falling through would answer a question nobody
    // asked, for every language.
    expect(parseRestRoute(["translations", "es"], "GET")).not.toMatchObject({
      method: "getTranslationWorklist",
    });
  });

  it("is read-only", () => {
    // Nothing here writes. A POST that parsed would reach a handler with no
    // mutation behind it and answer 400 from the wrong layer.
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(parseRestRoute(["translations"], method)).not.toMatchObject({
        method: "getTranslationWorklist",
      });
    }
  });
});
