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
    ["/admin/collections/posts", "read", "read"],
    ["/admin/collections/posts/create", "create", "create"],
    ["/admin/collections/posts/api", "read", "read"],
    ["/admin/collections/posts/entry-1", "update", "update"],
    // The history is read in every language, as the server judges it: the
    // route asks that, though the permission it names is the read.
    ["/admin/collections/posts/entry-1/versions", "read", "readHistory"],
  ])("names a collection for %s", (path, permission, action) => {
    const resolved = resolveRoute(path, "");
    expect(resolved.accessSubject).toBe("collection");
    // The permission and the entity access are asserted beside the subject
    // because all three come from one table: a subject attached to the wrong
    // row would still read "collection" here while gating on another action.
    expect(resolved.requiredPermission).toBe(`${permission}-posts`);
    expect(resolved.entityAccess).toEqual({ slug: "posts", action });
  });

  it.each([
    ["/admin/singles/site-settings", "update", "update"],
    ["/admin/singles/site-settings/api", "read", "read"],
    ["/admin/singles/site-settings/versions", "read", "readHistory"],
  ])("names a Single for %s", (path, permission, action) => {
    const resolved = resolveRoute(path, "");
    expect(resolved.accessSubject).toBe("single");
    expect(resolved.requiredPermission).toBe(`${permission}-site-settings`);
    expect(resolved.entityAccess).toEqual({ slug: "site-settings", action });
  });

  it("names nothing for a route that is neither", () => {
    // The users list is guarded too, by a static permission; it must fall back
    // to the generic wording rather than borrow a collection's.
    const resolved = resolveRoute(ROUTES.USERS, "");
    expect(resolved.requiredPermission).toBeDefined();
    expect(resolved.accessSubject).toBeUndefined();
    expect(resolved.entityAccess).toBeUndefined();
  });
});
