import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

/**
 * The URL segment, the dispatcher service key, and the admin client that calls
 * them are three separate spellings of one route. Nothing type-checks the pair,
 * so a rename that moves only some of them produces a 404 at runtime rather
 * than a build error. These cases pin the segment and the key it resolves to.
 */
describe("field group REST routes", () => {
  it("routes the collection endpoint to the field-groups service", () => {
    const parsed = parseRestRoute(["field-groups"], "GET");
    expect(parsed.service).toBe("field-groups");
    expect(parsed.operation).toBe("list");
  });

  it("routes the detail endpoint with the slug as a route param", () => {
    const parsed = parseRestRoute(["field-groups", "seo"], "GET");
    expect(parsed.service).toBe("field-groups");
    expect(parsed.routeParams?.slug).toBe("seo");
  });

  it("routes the schema preview and apply endpoints", () => {
    const preview = parseRestRoute(
      ["field-groups", "schema", "seo", "preview"],
      "POST"
    );
    expect(preview.service).toBe("field-groups");
    expect(preview.method).toBe("previewComponentSchemaChanges");

    const apply = parseRestRoute(
      ["field-groups", "schema", "seo", "apply"],
      "POST"
    );
    expect(apply.service).toBe("field-groups");
  });

  it("no longer answers on the pre-rename segment", () => {
    // The old segment was removed rather than aliased, so it must not resolve
    // to the field-groups service by any path.
    const parsed = parseRestRoute(["components"], "GET");
    expect(parsed.service).not.toBe("field-groups");
  });
});
