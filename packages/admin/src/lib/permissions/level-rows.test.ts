/**
 * The roles screen's rows: which permissions each collection and Single row
 * takes, the level a role's permissions give it, and what setting a level
 * changes in the role's whole permission list.
 *
 * The level mapping itself is tested in `levels.test.ts`; these test the row
 * around it: that a row reads and changes only its own ids, and that setting
 * a level keeps what the level does not decide.
 */
import { describe, expect, it } from "vitest";

import type { Permission } from "../../types/ui/form";

import {
  groupLevel,
  levelRows,
  offeredLevels,
  ownWithLevel,
  pluginGroups,
  rowLevel,
  screenEntitiesFrom,
  withLevel,
  type LevelRow,
  type ScreenEntity,
} from "./level-rows";

function permission(resource: string, action: string, owner?: string) {
  return {
    id: `${action}-${resource}`,
    name: `${action} ${resource}`,
    resource,
    action,
    ...(owner ? { owner } : {}),
  } satisfies Permission;
}

const POSTS = ["read", "create", "update", "delete", "publish", "unpublish"];

const PERMISSIONS: Permission[] = [
  ...POSTS.map(action => permission("posts", action)),
  // An action outside every level: it sits under the row's switch.
  permission("posts", "export"),
  ...["read", "update", "publish", "unpublish"].map(action =>
    permission("homepage", action)
  ),
  permission("settings", "read"),
  permission("form-exports", "read", "@nextlyhq/plugin-form-builder"),
];

const ENTITIES: ScreenEntity[] = [
  {
    slug: "posts",
    kind: "collection",
    labels: { singular: "Post", plural: "Posts" },
    plugin: null,
    declaredRules: ["read"],
  },
  {
    slug: "homepage",
    kind: "single",
    labels: { singular: "Home page" },
    plugin: null,
    declaredRules: [],
  },
];

function rows(): { posts: LevelRow; homepage: LevelRow; rest: Permission[] } {
  const built = levelRows(ENTITIES, PERMISSIONS);
  const [posts, homepage] = built.rows;
  return { posts, homepage, rest: built.rest };
}

describe("levelRows", () => {
  it("names each row by its plural as well, or its singular where it has none", () => {
    const { rows: built } = levelRows(ENTITIES, PERMISSIONS);
    expect(built.map(row => row.plural)).toEqual(["Posts", "Home page"]);
  });

  it("makes one row per entity, in the server's order, labelled by its singular", () => {
    const { rows: built } = levelRows(ENTITIES, PERMISSIONS);
    expect(
      built.map(({ slug, kind, label, plugin, declaredRules }) => ({
        slug,
        kind,
        label,
        plugin,
        declaredRules,
      }))
    ).toEqual([
      {
        slug: "posts",
        kind: "collection",
        label: "Post",
        plugin: null,
        declaredRules: ["read"],
      },
      {
        slug: "homepage",
        kind: "single",
        label: "Home page",
        plugin: null,
        declaredRules: [],
      },
    ]);
  });

  it("gives each row every permission on its slug, and leaves the rest outside", () => {
    const { posts, homepage, rest } = rows();
    expect(posts.permissions.map(p => p.action)).toEqual([...POSTS, "export"]);
    expect(homepage.permissions.map(p => p.action)).toEqual([
      "read",
      "update",
      "publish",
      "unpublish",
    ]);
    expect(rest.map(p => p.id)).toEqual(["read-settings", "read-form-exports"]);
  });

  it("makes a row for an entity that has no permissions yet", () => {
    const built = levelRows(ENTITIES, []);
    expect(built.rows.map(row => row.permissions)).toEqual([[], []]);
  });
});

describe("rowLevel", () => {
  it("reads the level from the row's own ids only", () => {
    const { posts, homepage } = rows();
    // Homepage ids that, counted on posts, would make it Can publish.
    const value = [
      "read-posts",
      "read-homepage",
      "update-homepage",
      "publish-homepage",
      "unpublish-homepage",
    ];
    expect(rowLevel(posts, value)).toBe("view");
    expect(rowLevel(homepage, value)).toBe("publish");
  });

  it("does not count an action under the switch", () => {
    const { posts } = rows();
    expect(rowLevel(posts, ["read-posts", "export-posts"])).toBe("view");
  });

  it("reads custom where the actions match no level", () => {
    const { posts } = rows();
    expect(rowLevel(posts, ["read-posts", "update-posts"])).toBe("custom");
  });
});

describe("withLevel", () => {
  it("sets the row's standard actions to exactly the level's", () => {
    const { posts } = rows();
    const value = withLevel(["read-posts", "delete-posts"], posts, "edit");
    expect([...value].sort()).toEqual(
      ["read-posts", "create-posts", "update-posts", "delete-posts"].sort()
    );
    expect(rowLevel(posts, value)).toBe("edit");
  });

  it("takes the row's standard actions away at No access", () => {
    const { posts } = rows();
    expect(withLevel(["read-posts", "publish-posts"], posts, "none")).toEqual(
      []
    );
  });

  it("gives a Single's Can edit without create or delete", () => {
    const { homepage } = rows();
    expect(withLevel([], homepage, "edit").sort()).toEqual(
      ["read-homepage", "update-homepage"].sort()
    );
  });

  it("keeps every other row's ids and the permissions no row takes", () => {
    const { posts } = rows();
    const others = ["publish-homepage", "read-settings", "read-form-exports"];
    const value = withLevel(
      [...others, "read-posts", "update-posts"],
      posts,
      "none"
    );
    expect(value).toEqual(others);
  });

  it("keeps the row's actions under the switch", () => {
    const { posts } = rows();
    const value = withLevel(["export-posts", "read-posts"], posts, "none");
    expect(value).toEqual(["export-posts"]);
  });

  it("keeps the ids a base role gives, whatever the level", () => {
    const { posts } = rows();
    const value = withLevel(
      ["read-posts", "update-posts", "delete-posts"],
      posts,
      "none",
      ["read-posts"]
    );
    expect(value).toEqual(["read-posts"]);
  });

  it("names an id once when a level gives one already held", () => {
    const { posts } = rows();
    const value = withLevel(["read-posts"], posts, "edit", ["read-posts"]);
    expect(value.filter(id => id === "read-posts")).toHaveLength(1);
  });

  it("leaves a custom row untouched when another row's level changes", () => {
    const { posts, homepage } = rows();
    const custom = ["read-posts", "update-posts", "export-posts"];
    const value = withLevel(custom, homepage, "view");
    expect(value.filter(id => id.endsWith("-posts"))).toEqual(custom);
    expect(rowLevel(posts, value)).toBe("custom");
  });
});

describe("ownWithLevel", () => {
  it("saves the level's ids the base does not give, and none it does", () => {
    const { posts } = rows();
    const value = ownWithLevel(["pages-read"], posts, "edit", ["read-posts"]);
    expect([...value].sort()).toEqual(
      ["pages-read", "create-posts", "update-posts", "delete-posts"].sort()
    );
  });

  it("reads the base's ids with the role's own, so a level they make is kept", () => {
    const { posts } = rows();
    // Can view comes from the base alone: the role adds nothing of its own.
    expect(ownWithLevel([], posts, "view", ["read-posts"])).toEqual([]);
  });

  it("drops the role's own copy of a row's id the base gives, as the level then rests on the base", () => {
    const { posts } = rows();
    expect(ownWithLevel(["read-posts"], posts, "view", ["read-posts"])).toEqual(
      []
    );
  });

  it("keeps the role's own copy of a base-given id outside what the level decides", () => {
    const { posts } = rows();
    // An action under the row's switch, and another row's grant.
    expect(
      ownWithLevel(["export-posts", "read-settings"], posts, "view", [
        "export-posts",
        "read-settings",
      ])
    ).toEqual(["export-posts", "read-settings", "read-posts"]);
  });

  it("takes away the role's own ids above the level", () => {
    const { posts } = rows();
    expect(
      ownWithLevel(["update-posts", "export-posts"], posts, "view", [
        "read-posts",
      ])
    ).toEqual(["export-posts"]);
  });
});

describe("offeredLevels", () => {
  it("offers every level of the row's kind when nothing is inherited", () => {
    const { posts, homepage } = rows();
    expect(offeredLevels(posts)).toEqual(["none", "view", "edit", "publish"]);
    expect(offeredLevels(homepage)).toEqual([
      "none",
      "view",
      "edit",
      "publish",
    ]);
  });

  it("offers nothing below the level a base role gives", () => {
    const { posts } = rows();
    expect(offeredLevels(posts, ["read-posts"])).toEqual([
      "view",
      "edit",
      "publish",
    ]);
  });

  it("offers only the levels holding a base's actions that are no level", () => {
    const { posts } = rows();
    // Read and update give no level on a collection, and Can view would
    // still hold update: only Can edit and Can publish hold both.
    expect(offeredLevels(posts, ["read-posts", "update-posts"])).toEqual([
      "edit",
      "publish",
    ]);
  });

  it("is not narrowed by an inherited action under the switch", () => {
    const { posts } = rows();
    expect(offeredLevels(posts, ["export-posts"])).toEqual([
      "none",
      "view",
      "edit",
      "publish",
    ]);
  });
});

const FORMS = "@nextlyhq/plugin-form-builder";

/** The app's posts, the form builder's forms, and its declared export. */
function withPlugin() {
  const entities: ScreenEntity[] = [
    ...ENTITIES,
    {
      slug: "forms",
      kind: "collection",
      labels: { singular: "Form", plural: "Forms" },
      plugin: FORMS,
      declaredRules: [],
    },
  ];
  const permissions: Permission[] = [
    ...PERMISSIONS,
    ...["read", "create", "update", "delete"].map(action =>
      permission("forms", action)
    ),
  ];
  return levelRows(entities, permissions);
}

describe("pluginGroups", () => {
  it("keeps the app's own rows apart and gathers each plugin's rows and declared permissions", () => {
    const { rows, rest } = withPlugin();
    const grouped = pluginGroups(rows, rest);

    expect(grouped.appRows.map(row => row.slug)).toEqual(["posts", "homepage"]);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0].plugin).toBe(FORMS);
    expect(grouped.groups[0].rows.map(row => row.slug)).toEqual(["forms"]);
    expect(grouped.groups[0].permissions.map(p => p.id)).toEqual([
      "read-form-exports",
    ]);
    // POPULATION CONTROL: a permission no plugin declared stays outside.
    expect(grouped.rest.map(p => p.id)).toEqual(["read-settings"]);
  });

  it("makes a group for a plugin that declares permissions but contributes no collection", () => {
    const { rows, rest } = levelRows(ENTITIES, PERMISSIONS);
    const grouped = pluginGroups(rows, rest);

    expect(grouped.groups.map(group => group.plugin)).toEqual([FORMS]);
    expect(grouped.groups[0].rows).toEqual([]);
  });
});

describe("pluginGroups, for the app's own declared permissions", () => {
  it('keeps a permission the app declares (owner "app") out of every plugin group', () => {
    const { rows, rest } = levelRows(ENTITIES, [
      ...PERMISSIONS,
      permission("reports", "export", "app"),
    ]);
    const grouped = pluginGroups(rows, rest);

    expect(grouped.groups.map(group => group.plugin)).toEqual([FORMS]);
    expect(grouped.rest.map(p => p.id)).toContain("export-reports");
  });
});

describe("groupLevel", () => {
  it("does not count another plugin's action on this plugin's collection", () => {
    const entities: ScreenEntity[] = [
      {
        slug: "forms",
        kind: "collection",
        labels: { singular: "Form", plural: "Forms" },
        plugin: FORMS,
        declaredRules: [],
      },
    ];
    const { rows, rest } = levelRows(entities, [
      permission("forms", "read"),
      permission("forms", "audit", "@acme/plugin-audit"),
    ]);
    const [group] = pluginGroups(rows, rest).groups;

    expect(groupLevel(group, ["read-forms", "audit-forms"])).toBe("view");
  });

  it("reads custom where a plugin's own action on one of its collections is held", () => {
    // A plugin may declare an action of its own on a collection it
    // contributes; the row takes it, under its switch.
    const entities: ScreenEntity[] = [
      {
        slug: "forms",
        kind: "collection",
        labels: { singular: "Form", plural: "Forms" },
        plugin: FORMS,
        declaredRules: [],
      },
    ];
    const { rows, rest } = levelRows(entities, [
      permission("forms", "read"),
      permission("forms", "manage", FORMS),
    ]);
    const [group] = pluginGroups(rows, rest).groups;

    expect(groupLevel(group, ["read-forms"])).toBe("view");
    expect(groupLevel(group, ["read-forms", "manage-forms"])).toBe("custom");
  });

  it("reads the level every row of the group reads", () => {
    const { rows, rest } = withPlugin();
    const [group] = pluginGroups(rows, rest).groups;

    expect(groupLevel(group, ["read-forms"])).toBe("view");
    expect(groupLevel(group, [])).toBe("none");
  });

  it("reads custom where a row reads custom or the plugin's own permission is held beside a level", () => {
    const { rows, rest } = withPlugin();
    const [group] = pluginGroups(rows, rest).groups;

    expect(groupLevel(group, ["read-forms", "create-forms"])).toBe("custom");
    expect(groupLevel(group, ["read-forms", "read-form-exports"])).toBe(
      "custom"
    );
  });
});

describe("screenEntitiesFrom", () => {
  it("reads the entities of a roles screen response", () => {
    expect(screenEntitiesFrom({ items: ENTITIES, meta: {} })).toEqual(ENTITIES);
  });

  it("refuses an entity of a kind the screen has no levels for", () => {
    expect(() =>
      screenEntitiesFrom({ items: [{ ...ENTITIES[0], kind: "component" }] })
    ).toThrow();
  });

  it("refuses a body that is not a list", () => {
    expect(() => screenEntitiesFrom({ item: ENTITIES[0] })).toThrow();
  });
});
