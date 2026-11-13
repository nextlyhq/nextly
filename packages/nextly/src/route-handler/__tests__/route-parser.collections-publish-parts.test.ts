// `POST /api/collections/{slug}/entries/{id}/publish` and `.../unpublish`: the chosen parts of an
// entry, named in the body. The route ends at the action; a path that goes on past it names no
// route here, so a mistyped address is refused rather than read as a publish.

import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

const ENTRY = ["collections", "posts", "entries", "p1"];

describe("collection publish and unpublish of chosen parts", () => {
  it.each([
    ["publish", "publishParts"],
    ["unpublish", "unpublishParts"],
  ])("parses POST .../%s as %s", (action, method) => {
    expect(parseRestRoute([...ENTRY, action], "POST")).toMatchObject({
      service: "collections",
      method,
      routeParams: { collectionName: "posts", entryId: "p1" },
    });
  });

  it.each(["publish", "unpublish", "publish-all", "unpublish-all"])(
    "claims nothing past .../%s",
    action => {
      // No route at all, or another one: never a publish or unpublish.
      expect(
        parseRestRoute([...ENTRY, action, "extra"], "POST").method ?? ""
      ).not.toMatch(/^(publish|unpublish)(Parts|AllLocales)$/);
    }
  );
});
