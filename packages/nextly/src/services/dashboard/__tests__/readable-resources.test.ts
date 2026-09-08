import { describe, expect, it } from "vitest";

import {
  allResources,
  canRead,
  filterByResource,
  someResources,
} from "../readable-resources";

const items = [
  { slug: "posts" },
  { slug: "pages" },
  { slug: "email-providers" },
];
const bySlug = (item: { slug: string }) => item.slug;

describe("readable resources", () => {
  it("lets a super-admin read every resource", () => {
    const scope = allResources();
    expect(canRead(scope, "posts")).toBe(true);
    expect(filterByResource(scope, items, bySlug)).toEqual(items);
  });

  it("admits only the named resources", () => {
    const scope = someResources(["posts"]);
    expect(canRead(scope, "posts")).toBe(true);
    expect(canRead(scope, "pages")).toBe(false);
    expect(filterByResource(scope, items, bySlug)).toEqual([{ slug: "posts" }]);
  });

  // This is the defect. An empty scope means "this caller may read NOTHING" --
  // it must never be read as "apply no filter". `listEffectivePermissions`
  // returns [] for a user with no roles AND for any thrown error, so this path
  // is reachable from a transient database failure, not only from a misconfigured user.
  it("admits nothing when the scope is empty", () => {
    const scope = someResources([]);
    expect(canRead(scope, "posts")).toBe(false);
    expect(filterByResource(scope, items, bySlug)).toEqual([]);
  });

  it("treats the scope as read-only data, not a filter toggle", () => {
    const scope = someResources(["email-providers"]);
    // System resources share the namespace with collection slugs by construction:
    // a seeded permission `{ resource: "email-providers", action: "read" }` becomes
    // the pair `email-providers:read`, and the activity log files rows under the
    // same string. One scope therefore gates both.
    expect(filterByResource(scope, items, bySlug)).toEqual([
      { slug: "email-providers" },
    ]);
  });
});
