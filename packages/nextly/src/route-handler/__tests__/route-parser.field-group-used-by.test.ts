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

  it.each([
    ["POST", ["field-groups", "seo", "used-by"]],
    ["PATCH", ["field-groups", "seo", "used-by"]],
    ["PUT", ["field-groups", "seo", "used-by"]],
    ["DELETE", ["field-groups", "seo", "used-by"]],
    ["GET", ["field-groups", "seo", "used-by", "x"]],
    ["DELETE", ["field-groups", "seo", "used-by", "x"]],
    ["GET", ["field-groups", "seo", "anything"]],
    ["PATCH", ["field-groups", "seo", "anything"]],
    ["DELETE", ["field-groups", "seo", "anything"]],
  ] as const)(
    "answers %s /%s with no route, rather than another field-group route",
    (verb, segments) => {
      // No route, not a fall-through to the field group itself: a delete or
      // update aimed at a path that is not one must not reach the field group.
      // An unknown route is answered as `{}`, which the handler refuses.
      expect(parseRestRoute([...segments], verb)).toEqual({});
    }
  );

  it("is for a signed-in user, with no specific permission, and never public", () => {
    expect(isPublicEndpoint("field-groups", "getComponentUsedBy")).toBe(false);
    expect(requiresAuthOnly("field-groups", "getComponentUsedBy")).toBe(true);
  });
});
