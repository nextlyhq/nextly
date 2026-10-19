/**
 * Which kind of thing a guarded route opens, so a refusal can name it.
 *
 * Asked of `resolveRoute` with real paths, as a click asks it: a table that
 * names the subject but is keyed by a pattern the resolver never reaches would
 * pass a test of the table and still leave every refusal saying "this page".
 *
 * @module lib/__tests__/route-access-subject.test
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { resolveRoute } from "@admin/lib/routing";

describe("the subject a guarded route names", () => {
  it.each([
    ["/admin/collections/posts", "read-posts"],
    ["/admin/collections/posts/create", "create-posts"],
    ["/admin/collections/posts/api", "read-posts"],
    ["/admin/collections/posts/entry-1", "update-posts"],
    ["/admin/collections/posts/entry-1/versions", "read-posts"],
  ])("names a collection for %s", (path, permission) => {
    const resolved = resolveRoute(path, "");
    expect(resolved.accessSubject).toBe("collection");
    // The permission is asserted beside the subject because both come from
    // one table: a subject attached to the wrong row would still read
    // "collection" here while gating on another action.
    expect(resolved.requiredPermission).toBe(permission);
  });

  it.each([
    ["/admin/singles/site-settings", "update-site-settings"],
    ["/admin/singles/site-settings/api", "read-site-settings"],
    ["/admin/singles/site-settings/versions", "read-site-settings"],
  ])("names a Single for %s", (path, permission) => {
    const resolved = resolveRoute(path, "");
    expect(resolved.accessSubject).toBe("single");
    expect(resolved.requiredPermission).toBe(permission);
  });

  it("names nothing for a route that is neither", () => {
    // The users list is guarded too, by a static permission; it must fall back
    // to the generic wording rather than borrow a collection's.
    const resolved = resolveRoute(ROUTES.USERS, "");
    expect(resolved.requiredPermission).toBeDefined();
    expect(resolved.accessSubject).toBeUndefined();
  });
});
