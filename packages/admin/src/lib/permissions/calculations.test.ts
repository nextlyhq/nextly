/**
 * `organizePermissions` and the matrix's selection helpers.
 *
 * The cases that used to be marked DEFECT are the interesting ones: each named
 * a permission the editor could grant but not display, and each is now an
 * assertion that it displays. They are kept in place, flipped, rather than
 * deleted, so the behaviour they pin stays pinned.
 *
 * Fixtures mirror what `useRoleForm` emits, which is what the component
 * actually receives: `resource` and `action` as fields, a `category` the hook
 * already resolved, and `owner` set for a plugin's permission.
 */
import { describe, expect, it } from "vitest";

import {
  actionLabel,
  actionsForContentTypes,
} from "../../constants/permissions";
import type { Permission } from "../../types/ui/form";

import {
  filterContentTypes,
  isAllSelected,
  isAllSelectedForAction,
  isEveryPermissionLocked,
  isPartiallySelected,
  isPartiallySelectedForAction,
  organizePermissions,
} from "./calculations";

/** A permission shaped the way useRoleForm emits them. */
function perm(
  resource: string,
  action: string,
  category = "collection-types",
  owner?: string
): Permission {
  return {
    id: `${action}-${resource}`,
    name: `${resource} ${action}`,
    resource,
    action,
    slug: `${resource}.${action}`,
    category,
    owner,
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
      perm("settings", "manage", "settings"),
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

  it("keys each permission by the action it actually has", () => {
    const result = organizePermissions(POSTS_CRUD);
    const posts = result["collection-types"][0];

    expect(Object.keys(posts.permissions).sort()).toEqual([
      "create",
      "delete",
      "read",
      "update",
    ]);
  });

  it("omits an action the resource does not have", () => {
    const result = organizePermissions([perm("posts", "read")]);
    const posts = result["collection-types"][0];

    expect(posts.permissions.read).toBeDefined();
    expect(posts.permissions.create).toBeUndefined();
  });

  it("ignores a permission with no resource or action", () => {
    const bare = { ...perm("posts", "read"), resource: "", action: "" };

    expect(() => organizePermissions([bare])).not.toThrow();
    expect(organizePermissions([bare])["collection-types"]).toEqual([]);
  });

  it("falls back to collection types for an unrecognised category", () => {
    const result = organizePermissions([perm("posts", "read", "nonsense")]);

    expect(result["collection-types"].map(c => c.name)).toEqual(["posts"]);
  });

  // Was: DEFECT — dropped, because the type had four named slots.
  it("keeps publish, so a page's publish permission has a column", () => {
    const result = organizePermissions([
      perm("pages", "read"),
      perm("pages", "publish"),
    ]);
    const pages = result["collection-types"][0];

    expect(pages.permissions.publish).toBeDefined();
    expect(pages.permissions.publish.action).toBe("publish");
  });

  // Was: DEFECT — dropped, leaving submissions a row of four dashes whose
  // select-all checkbox selected nothing.
  it("keeps export, so submissions is a row with something in it", () => {
    const result = organizePermissions([
      perm("submissions", "export", "plugins", "@nextlyhq/plugin-form-builder"),
    ]);
    const submissions = result["plugins"][0];

    expect(submissions.name).toBe("submissions");
    expect(submissions.permissions.export).toBeDefined();
  });

  // Was: DEFECT — filed under the slot the header labelled "Update", so
  // ticking Update on Settings granted manage-settings.
  it("keeps manage as itself rather than filing it under update", () => {
    const result = organizePermissions([
      perm("settings", "manage", "settings"),
    ]);
    const settings = result["settings"][0];

    expect(settings.permissions.manage).toBeDefined();
    expect(settings.permissions.update).toBeUndefined();
  });

  // Was: DEFECT — an unexplained special case hid it while Select All kept
  // granting it.
  it("shows the api-keys delete permission", () => {
    const result = organizePermissions([
      perm("api-keys", "read", "settings"),
      perm("api-keys", "delete", "settings"),
    ]);
    const apiKeys = result["settings"][0];

    expect(apiKeys.permissions.delete).toBeDefined();
  });

  // Was: DEFECT — discarded outright, in a repo shipping two plugins.
  it("files a plugin's permission under Plugins", () => {
    const result = organizePermissions([
      perm("posts", "read"),
      perm("submissions", "export", "plugins", "@nextlyhq/plugin-form-builder"),
    ]);

    expect(result["plugins"].map(c => c.name)).toEqual(["submissions"]);
    expect(result["collection-types"].map(c => c.name)).toEqual(["posts"]);
  });
});

describe("actionsForContentTypes", () => {
  it("returns every action any row has, deduplicated", () => {
    const rows = organizePermissions([
      perm("posts", "read"),
      perm("posts", "create"),
      perm("pages", "read"),
      perm("pages", "publish"),
    ])["collection-types"];

    expect(actionsForContentTypes(rows)).toEqual(["create", "read", "publish"]);
  });

  it("orders the seeded verbs the way people read them, not alphabetically", () => {
    const rows = organizePermissions([
      perm("posts", "delete"),
      perm("posts", "read"),
      perm("posts", "create"),
      perm("posts", "update"),
    ])["collection-types"];

    expect(actionsForContentTypes(rows)).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);
  });

  // A plugin's verb is not in the order list, so it sorts after the ones that
  // are. Nothing here needs to know the verb exists.
  it("puts an unknown verb after the seeded ones", () => {
    const rows = organizePermissions([
      perm("x", "export"),
      perm("x", "read"),
      perm("x", "archive"),
    ])["collection-types"];

    expect(actionsForContentTypes(rows)).toEqual(["read", "archive", "export"]);
  });

  it("returns nothing for no rows", () => {
    expect(actionsForContentTypes([])).toEqual([]);
  });
});

describe("actionLabel", () => {
  it("capitalises the action itself", () => {
    expect(actionLabel("read")).toBe("Read");
    expect(actionLabel("manage")).toBe("Manage");
  });

  it("renders a verb it has never heard of", () => {
    expect(actionLabel("export")).toBe("Export");
    expect(actionLabel("archive")).toBe("Archive");
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
  const allIds = Object.values(posts.permissions).map(p => p.id);

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

  // Was: DEFECT — the row's only action had no column, so it held no ids and
  // its checkbox could never select anything.
  it("selects a row whose only action is a plugin's verb", () => {
    const submissions = organizePermissions([
      perm("submissions", "export", "plugins", "@nextlyhq/plugin-form-builder"),
    ])["plugins"][0];

    expect(isAllSelected(submissions, ["export-submissions"])).toBe(true);
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
      isAllSelectedForAction(rows, "read", ["read-posts", "read-categories"])
    ).toBe(true);
  });

  it("ignores rows that do not have the action", () => {
    // Only posts has create, so holding it alone satisfies the column.
    expect(isAllSelectedForAction(rows, "create", ["create-posts"])).toBe(true);
  });

  it("is partial when only some rows holding the action are held", () => {
    expect(isPartiallySelectedForAction(rows, "read", ["read-posts"])).toBe(
      true
    );
  });

  it("is not all-selected for a column no row has", () => {
    expect(isAllSelectedForAction(rows, "delete", [])).toBe(false);
  });
});

describe("isEveryPermissionLocked", () => {
  it("is not locked when nothing is inherited", () => {
    expect(isEveryPermissionLocked(["a", "b"], [])).toBe(false);
  });

  it("is not locked when only some are inherited", () => {
    // The bug this pins: one inherited permission used to disable the whole
    // select-all, so the free ones alongside it could not be granted in bulk.
    // The toggle handlers keep locked ids when clearing, so the group is safe
    // to operate and the control stays live.
    expect(isEveryPermissionLocked(["a", "b", "c"], ["b"])).toBe(false);
  });

  it("is locked when every one is inherited", () => {
    expect(isEveryPermissionLocked(["a", "b"], ["a", "b", "z"])).toBe(true);
  });

  it("treats an empty group as locked, having nothing to toggle", () => {
    expect(isEveryPermissionLocked([], [])).toBe(true);
  });
});
