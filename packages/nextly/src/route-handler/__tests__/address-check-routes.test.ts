/**
 * The address check has one route per kind, under that kind's own service, so each is gated by
 * the permission that kind's create asks: a collection's and a Single's by the schema-change
 * grants, a field group's by `create` on settings. None is public or open to any signed-in user.
 *
 * The routes sit under `schema/`, where the Builder's other dry runs are, beside the reads of
 * one entity's schema, which they must not take over.
 */
import { describe, expect, it } from "vitest";

import { isPublicEndpoint, parseRestRoute, requiresAuthOnly } from "../route-parser";

const route = (httpMethod: string, path: string) =>
  parseRestRoute(path.split("/").filter(Boolean), httpMethod);

describe("the address check routes", () => {
  it.each([
    ["/collections/schema/address-check", "collections", "checkCollectionAddress"],
    ["/singles/schema/address-check", "singles", "checkSingleAddress"],
    ["/field-groups/schema/address-check", "field-groups", "checkComponentAddress"],
  ])("POST %s is the %s service's %s", (path, service, method) => {
    const parsed = route("POST", path);
    expect(parsed.service).toBe(service);
    expect(parsed.method).toBe(method);
    expect(isPublicEndpoint(service, method)).toBe(false);
    expect(requiresAuthOnly(service, method)).toBe(false);
  });

  it("leaves the read of a collection's schema as it was", () => {
    expect(route("GET", "/collections/schema/posts").method).toBe(
      "getCollection"
    );
  });
});
