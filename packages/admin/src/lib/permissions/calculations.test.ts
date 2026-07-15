/**
 * `organizePermissions` and the matrix's selection helpers.
 *
 * These pin what the matrix does **today**, which in several places is wrong.
 * The tests that describe a defect say so and name it; they are here so the
 * change that fixes them has to flip them on purpose rather than silently.
 * Read a `// DEFECT` test as "this is the behaviour, not the intent".
 *
 * Fixtures mirror what `useRoleForm` builds, which is what the component
 * actually receives: a `slug` of `${resource}.${action}` (its own dot form,
 * not the database's `${action}-${resource}`) and a `category` already
 * resolved by the hook.
 */
import { describe, expect, it } from "vitest";

import type { Permission } from "../../types/ui/form";

import {
  filterContentTypes,
  isAllSelected,
  isAllSelectedForAction,
  isPartiallySelected,
  isPartiallySelectedForAction,
  organizePermissions,
} from "./calculations";

/** A permission shaped the way useRoleForm emits them. */
function perm(
  resource: string,
  action: string,
  category = "collection-types",
  id = `${action}-${resource}`
): Permission {
  return {
    id,
    name: `${resource} ${action}`,
    resource,
    action,
    slug: `${resource}.${action}`,
    category,
  };
}

const POSTS_CRUD = [
  perm("posts", "create"),
  perm("posts", "read"),
  perm("posts", "update"),
  perm("posts", "delete"),
];

describe("organizePermissions", () => {
  it("groups a resource's permissions into one row", () => {
    const result = organizePermissions(POSTS_CRUD);

    expect(result["collection-types"]).toHaveLength(1);
    expect(result["collection-types"][0].name).toBe("posts");
  });

  it("files a row under the category the permission carries", () => {
    const result = organizePermissions([
      perm("posts", "read", "collection-types"),
      perm("homepage", "read", "single-types"),
      perm("settings", "read", "settings"),
    ]);

    expect(result["collection-types"].map(c => c.name)).toEqual(["posts"]);
    expect(result["single-types"].map(c => c.name)).toEqual(["homepage"]);
    expect(result["settings"].map(c => c.name)).toEqual(["settings"]);
  });

  it("sorts rows within a category by name", () => {
    const result = organizePermissions([
      perm("tags", "read"),
      perm("categories", "read"),
      perm("posts", "read"),
    ]);

    expect(result["collection-types"].map(c => c.name)).toEqual([
      "categories",
      "posts",
      "tags",
    ]);
  });

  it("renames read to view and update to edit for the four columns", () => {
    const result = organizePermissions(POSTS_CRUD);
    const posts = result["collection-types"][0];

    expect(posts.permissions.view?.action).toBe("read");
    expect(posts.permissions.edit?.action).toBe("update");
    expect(posts.permissions.create?.action).toBe("create");
    expect(posts.permissions.delete?.action).toBe("delete");
  });

  it("leaves a slot null when the resource has no such permission", () => {
    const result = organizePermissions([perm("posts", "read")]);
    const posts = result["collection-types"][0];

    expect(posts.permissions.view).not.toBeNull();
    expect(posts.permissions.create).toBeNull();
    expect(posts.permissions.edit).toBeNull();
    expect(posts.permissions.delete).toBeNull();
  });

  it("survives a permission with no slug", () => {
    const bare = { ...perm("posts", "read"), slug: undefined };

    expect(() => organizePermissions([bare])).not.toThrow();
  });

  // DEFECT (A2). The type has four named slots, so an action outside
  // create/read/update/delete has nowhere to go and is dropped. Both of these
  // exist in the database and both are grantable through Select All, which
  // reads the raw permission list — so the editor grants what it cannot show.
  it("DEFECT: drops publish, leaving a row that cannot show it", () => {
    const result = organizePermissions([
      perm("pages", "read"),
      perm("pages", "publish"),
    ]);
    const pages = result["collection-types"][0];

    expect(Object.values(pages.permissions).filter(Boolean)).toHaveLength(1);
    expect(
      Object.values(pages.permissions).some(p => p?.action === "publish")
    ).toBe(false);
  });

  // DEFECT (B2). export is the form-builder's declared permission. Dropping it
  // leaves `submissions` as a row of four dashes and a select-all checkbox
  // that selects nothing.
  it("DEFECT: drops export, leaving submissions an empty row", () => {
    const result = organizePermissions([perm("submissions", "export")]);
    const submissions = result["collection-types"][0];

    expect(submissions.name).toBe("submissions");
    expect(Object.values(submissions.permissions).filter(Boolean)).toHaveLength(
      0
    );
  });

  // DEFECT (A3). `manage` is a distinct action — a role holding manage-media
  // is not granted read-media — but it is filed under the slot the header
  // labels "Update". Ticking Update on Settings grants manage-settings.
  it("DEFECT: files manage under the slot labelled Update", () => {
    const result = organizePermissions([
      perm("settings", "manage", "settings"),
    ]);
    const settings = result["settings"][0];

    expect(settings.permissions.edit?.action).toBe("manage");
  });

  // DEFECT. An unexplained special case. delete-api-keys is seeded and
  // grantable through Select All, and has no checkbox to revoke it with.
  it("DEFECT: hides the api-keys delete permission", () => {
    const result = organizePermissions([
      perm("api-keys", "read", "settings"),
      perm("api-keys", "delete", "settings"),
    ]);
    const apiKeys = result["settings"][0];

    expect(apiKeys.permissions.delete).toBeNull();
  });

  // DEFECT. Three call sites skip the plugins category outright, in a repo
  // that ships two plugins and a documented API for their permissions.
  it("DEFECT: discards a permission categorised as a plugin's", () => {
    const result = organizePermissions([
      perm("posts", "read"),
      perm("submissions", "export", "plugins"),
    ]);

    expect(result["plugins"]).toBeUndefined();
    expect(result["collection-types"]).toHaveLength(1);
    expect(
      Object.values(result)
        .flat()
        .some(c => c.name === "submissions")
    ).toBe(false);
  });
});

describe("filterContentTypes", () => {
  const organized = organizePermissions([
    perm("posts", "read"),
    perm("categories", "read"),
  ]);

  it("returns everything when no term is given", () => {
    expect(filterContentTypes(organized, "")).toEqual(organized);
  });

  it("matches on name, case-insensitively", () => {
    const result = filterContentTypes(organized, "POST");

    expect(result["collection-types"].map(c => c.name)).toEqual(["posts"]);
  });

  it("returns an empty category when nothing matches", () => {
    expect(filterContentTypes(organized, "zzz")["collection-types"]).toEqual(
      []
    );
  });
});

describe("row selection", () => {
  const posts = organizePermissions(POSTS_CRUD)["collection-types"][0];
  const allIds = Object.values(posts.permissions)
    .filter(Boolean)
    .map(p => p!.id);

  it("is all-selected when every permission the row has is held", () => {
    expect(isAllSelected(posts, allIds)).toBe(true);
  });

  it("is not all-selected when one is missing", () => {
    expect(isAllSelected(posts, allIds.slice(1))).toBe(false);
  });

  it("is partial when some but not all are held", () => {
    expect(isPartiallySelected(posts, [allIds[0]])).toBe(true);
  });

  it("is neither all nor partial when none are held", () => {
    expect(isAllSelected(posts, [])).toBe(false);
    expect(isPartiallySelected(posts, [])).toBe(false);
  });

  it("is not partial when all are held", () => {
    expect(isPartiallySelected(posts, allIds)).toBe(false);
  });

  // A row whose only action has no column has no permission ids at all, so it
  // can never be selected. This is what makes the submissions row's checkbox
  // do nothing.
  it("DEFECT: a row with no surviving permissions can never be selected", () => {
    const submissions = organizePermissions([perm("submissions", "export")])[
      "collection-types"
    ][0];

    expect(isAllSelected(submissions, ["export-submissions"])).toBe(false);
  });
});

describe("column selection", () => {
  const rows = organizePermissions([
    perm("posts", "read"),
    perm("posts", "create"),
    perm("categories", "read"),
  ])["collection-types"];

  it("is all-selected for an action when every row holding it is held", () => {
    expect(
      isAllSelectedForAction(rows, "view", ["read-posts", "read-categories"])
    ).toBe(true);
  });

  it("ignores rows that do not have the action", () => {
    // Only posts has create, so holding it alone satisfies the column.
    expect(isAllSelectedForAction(rows, "create", ["create-posts"])).toBe(true);
  });

  it("is partial when only some rows holding the action are held", () => {
    expect(isPartiallySelectedForAction(rows, "view", ["read-posts"])).toBe(
      true
    );
  });

  it("is not all-selected for a column no row has", () => {
    expect(isAllSelectedForAction(rows, "delete", [])).toBe(false);
  });
});
