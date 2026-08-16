/**
 * The preview-URL route.
 *
 * Two properties are worth pinning. The route takes no path parameters at all,
 * because what is being asked about is form state rather than a saved row — so a
 * deeper path is a mistake rather than a variant, and must not be answered. And
 * it must stay distinct from `preview-links`, which sits one segment away and
 * hands out a bearer credential rather than a URL: a parser that confused the
 * two would answer a credential request with a plain URL, or worse the reverse.
 */
import { describe, it, expect } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("preview-url routes", () => {
  it("parses the resolve request", () => {
    expect(parseRestRoute(["preview-url"], "POST")).toMatchObject({
      service: "previewUrl",
      operation: "create",
      method: "resolveEntryPreviewUrl",
    });
  });

  it("refuses a deeper path rather than ignoring the extra segments", () => {
    // An unmatched route is the empty object here, as the webhook suite pins for
    // the same shape. Left to fall through instead, a mistyped longer path would
    // be answered by the bare route and read as working.
    expect(parseRestRoute(["preview-url", "123"], "POST")).toEqual({});
    expect(parseRestRoute(["preview-url", "123", "extra"], "POST")).toEqual({});
  });

  it("refuses every method but POST", () => {
    // The entry travels in the body, so nothing else can carry a request. Left
    // matching, a GET would reach the JSON-body handler rather than being
    // answered method-not-allowed — the adjacent preview-links parser rejects
    // non-POST on its first line for the same reason.
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(parseRestRoute(["preview-url"], method)).toEqual({});
    }
    // Positive control: the same route with the right method still resolves, so
    // the assertions above are about the METHOD and not a broken route.
    expect(parseRestRoute(["preview-url"], "POST")).toMatchObject({
      service: "previewUrl",
    });
  });

  it("stays distinct from the preview-links routes", () => {
    // Same first word, different resource, and they must not answer for each
    // other: one returns a URL, the other mints a credential.
    expect(parseRestRoute(["preview-links"], "POST")).toMatchObject({
      service: "previewLinks",
      method: "mintPreviewLink",
    });
    expect(parseRestRoute(["preview-url"], "POST")).toMatchObject({
      service: "previewUrl",
    });
  });
});
