// `GET /api/collections/{slug}/entries/{id}/publish-all`: what publishing
// every language of the entry would do, without doing it.
//
// The route shares its path with the publish itself, so the risks are that
// the verb gate is not real (a read answered by the publish, or a publish by
// the read) and that it shadows a neighbouring entry route or is shadowed by
// it. Each test below carries the case that would pass if the branch matched
// too widely.

import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

const PATH = ["collections", "posts", "entries", "p1", "publish-all"];

describe("collection publish-all preview route", () => {
  it("parses GET as the preview of the publish, a read of the entry", () => {
    expect(parseRestRoute(PATH, "GET")).toMatchObject({
      service: "collections",
      operation: "single",
      method: "previewPublishAllLocales",
      routeParams: { collectionName: "posts", entryId: "p1" },
    });
  });

  it("previews only on GET, and still publishes on POST", () => {
    expect(parseRestRoute(PATH, "POST").method).toBe("publishAllLocales");
    for (const verb of ["PATCH", "DELETE", "PUT"]) {
      expect(parseRestRoute(PATH, verb).method).not.toBe(
        "previewPublishAllLocales"
      );
    }
  });

  it("claims nothing deeper than the sub-resource", () => {
    expect(parseRestRoute([...PATH, "extra"], "GET").method).not.toBe(
      "previewPublishAllLocales"
    );
  });

  it("leaves the entry itself read as the entry", () => {
    expect(
      parseRestRoute(["collections", "posts", "entries", "p1"], "GET").method
    ).toBe("getEntry");
  });
});
