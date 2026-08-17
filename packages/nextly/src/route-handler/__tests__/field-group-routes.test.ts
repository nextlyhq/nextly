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

  it("separates the reconcile preview from the repair by VERB, on one path", () => {
    // The two share a path and differ only in method, so the risk is one branch swallowing the
    // other: a GET falling through to the repair would apply a change nobody asked for, and a POST
    // caught by the preview would report a repair it never performed. Both directions are pinned
    // here because each reads as working from the other's side.
    const preview = parseRestRoute(
      ["field-groups", "schema", "seo", "reconcile"],
      "GET"
    );
    expect(preview.service).toBe("field-groups");
    expect(preview.method).toBe("previewComponentReconcile");
    expect(preview.routeParams?.slug).toBe("seo");

    const apply = parseRestRoute(
      ["field-groups", "schema", "seo", "reconcile"],
      "POST"
    );
    expect(apply.service).toBe("field-groups");
    expect(apply.method).toBe("reconcileComponent");
    expect(apply.routeParams?.slug).toBe("seo");
  });

  it("no longer answers on the pre-rename segment", () => {
    // Removed rather than aliased, so it must resolve to nothing at all — not
    // merely to something other than `field-groups`, which would still pass if
    // the segment had been picked up by an unrelated service. Checked across
    // the list, detail and schema shapes, since each is parsed separately.
    expect(parseRestRoute(["components"], "GET")).toEqual({});
    expect(parseRestRoute(["components", "seo"], "GET")).toEqual({});
    expect(
      parseRestRoute(["components", "schema", "seo", "preview"], "POST")
    ).toEqual({});
  });
});
