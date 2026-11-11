/**
 * Where a field group is used: the route that answers it, and who may ask.
 *
 * It is a read of builder-surface metadata, of the same class as reading the
 * field group itself: any signed-in user, no specific permission, never a
 * visitor. Every name it answers with (collections, Singles, field groups and
 * their field paths) is one a signed-in user already reads through the schema
 * reads, so it reveals nothing new to them.
 */
import { describe, expect, it } from "vitest";

import {
  isPublicEndpoint,
  parseRestRoute,
  requiresAuthOnly,
} from "../route-parser";

describe("the field-group used-by route", () => {
  it("answers GET /field-groups/[slug]/used-by", () => {
    expect(
      parseRestRoute(["field-groups", "seo", "used-by"], "GET")
    ).toMatchObject({
      service: "field-groups",
      method: "getComponentUsedBy",
      routeParams: { slug: "seo" },
    });
  });

  it("leaves the field group itself to its own route", () => {
    // The bare slug route reads no subresource, so the used-by route must be
    // matched first; the field group itself still answers as before.
    expect(parseRestRoute(["field-groups", "seo"], "GET")).toMatchObject({
      method: "getComponent",
      routeParams: { slug: "seo" },
    });
  });

  it("does not claim another verb or a deeper path", () => {
    expect(
      parseRestRoute(["field-groups", "seo", "used-by"], "POST")?.method
    ).not.toBe("getComponentUsedBy");
    expect(
      parseRestRoute(["field-groups", "seo", "used-by", "x"], "GET")?.method
    ).not.toBe("getComponentUsedBy");
  });

  it("is for a signed-in user, with no specific permission, and never public", () => {
    expect(isPublicEndpoint("field-groups", "getComponentUsedBy")).toBe(false);
    expect(requiresAuthOnly("field-groups", "getComponentUsedBy")).toBe(true);
  });
});
