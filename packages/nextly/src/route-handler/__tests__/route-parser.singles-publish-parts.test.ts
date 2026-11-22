// `POST /api/singles/{slug}/publish` and `/unpublish`: the chosen parts of a Single, named in the
// body, as a collection entry's are. Admitted as an update, since the service asks each chosen
// part's own rule. The route ends at the action, and is a POST only.

import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("Single publish and unpublish of chosen parts", () => {
  it.each([
    ["publish", "publishSingleParts"],
    ["unpublish", "unpublishSingleParts"],
  ])("parses POST /singles/{slug}/%s as %s", (action, method) => {
    expect(
      parseRestRoute(["singles", "homepage", action], "POST")
    ).toMatchObject({
      service: "singles",
      operation: "update",
      method,
      routeParams: { slug: "homepage" },
    });
  });

  it.each(["publish", "unpublish"])("claims nothing past /%s", action => {
    expect(
      parseRestRoute(["singles", "homepage", action, "extra"], "POST").method ??
        ""
    ).not.toMatch(/^(publish|unpublish)SingleParts$/);
  });

  it.each(["GET", "PATCH", "DELETE"])("is no route for %s", verb => {
    expect(
      parseRestRoute(["singles", "homepage", "publish"], verb).method ?? ""
    ).not.toMatch(/^(publish|unpublish)SingleParts$/);
  });
});
