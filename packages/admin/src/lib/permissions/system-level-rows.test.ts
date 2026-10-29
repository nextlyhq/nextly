/**
 * The roles screen's rows for the built-in resources: media, settings and the
 * Email hub's providers and templates. Each is read and set at a level as a
 * collection is, without Can publish. A role still holding a retired
 * `manage-<resource>` permission reads Can edit there and keeps it until the
 * row is changed, which then saves the plain permissions; Settings says what
 * changing the schema needs.
 */
import { describe, expect, it } from "vitest";

import type { Permission } from "../../types/ui/form";

import {
  rowLevel,
  roleScreenRows,
  rowNotes,
  systemLevelRows,
  withLevel,
  type LevelRow,
} from "./level-rows";

function permission(resource: string, action: string) {
  return {
    id: `${action}-${resource}`,
    name: `${action} ${resource}`,
    resource,
    action,
  } satisfies Permission;
}

const PLAIN = ["read", "create", "update", "delete"];

const PERMISSIONS: Permission[] = [
  ...[...PLAIN, "manage"].map(action => permission("settings", action)),
  ...PLAIN.map(action => permission("email-providers", action)),
  ...PLAIN.map(action => permission("email-templates", action)),
  ...PLAIN.map(action => permission("media", action)),
  // `manage` here is a permission of its own, not a retired one.
  permission("background-jobs", "manage"),
  permission("api-keys", "read"),
];

const { rows, rest } = systemLevelRows(PERMISSIONS);
const row = (slug: string): LevelRow => {
  const found = rows.find(candidate => candidate.slug === slug);
  if (!found) throw new Error(`no row for ${slug}`);
  return found;
};

describe("systemLevelRows", () => {
  it("makes a row for each built-in resource, in a fixed order, named for people", () => {
    expect(rows.map(r => [r.slug, r.kind, r.label])).toEqual([
      ["media", "system", "Media"],
      ["settings", "system", "Settings"],
      ["email-providers", "system", "Email providers"],
      ["email-templates", "system", "Email templates"],
    ]);
  });

  it("gives each row every permission on its resource, and leaves the rest outside", () => {
    expect(row("settings").permissions.map(p => p.action)).toEqual([
      ...PLAIN,
      "manage",
    ]);
    expect(rest.map(p => p.id)).toEqual([
      "manage-background-jobs",
      "read-api-keys",
    ]);
  });

  it("makes no row for a resource with no permission listed", () => {
    const only = systemLevelRows([permission("media", "read")]);
    expect(only.rows.map(r => r.slug)).toEqual(["media"]);
  });
});

describe("a built-in resource's level", () => {
  it("saves the four plain permissions for Can edit on email providers", () => {
    expect(withLevel([], row("email-providers"), "edit").sort()).toEqual(
      PLAIN.map(action => `${action}-email-providers`).sort()
    );
  });

  it("offers no Can publish", () => {
    expect(() => withLevel([], row("media"), "publish")).toThrow();
  });

  it("reads read and update on settings as Custom, and keeps both when another row changes", () => {
    const held = ["read-settings", "update-settings"];
    expect(rowLevel(row("settings"), held)).toBe("custom");
    const next = withLevel(held, row("media"), "view");
    expect(next).toEqual(expect.arrayContaining(held));
    expect(rowLevel(row("settings"), next)).toBe("custom");
  });
});

describe("a role still holding a retired manage permission", () => {
  const legacy = ["manage-settings"];

  it("reads Can edit on that row", () => {
    expect(rowLevel(row("settings"), legacy)).toBe("edit");
  });

  it("keeps the grant when the row is not changed", () => {
    const next = withLevel(legacy, row("media"), "view");
    expect(next).toContain("manage-settings");
    expect(rowLevel(row("settings"), next)).toBe("edit");
  });

  it("saves the plain permissions once the row is changed", () => {
    expect(withLevel(legacy, row("settings"), "view")).toEqual([
      "read-settings",
    ]);
    expect(withLevel(legacy, row("settings"), "edit").sort()).toEqual(
      PLAIN.map(action => `${action}-settings`).sort()
    );
  });
});

describe("rowNotes", () => {
  const SCHEMA_HELP =
    "Changing collections and Singles needs Can edit on Settings (create, update and delete).";
  const NOT_SCHEMA = "Can change settings, but not collections or Singles.";

  it("names a retired manage permission still held, with the command that converts it", () => {
    const notes = rowNotes(
      row("settings"),
      ["manage-settings"],
      ["manage-settings"]
    );
    expect(notes[0]).toContain("manage-settings");
    expect(notes[0]).toContain("nextly upgrade");
    expect(notes[0]).toContain("saving this role converts it");
  });

  it("does not promise that saving converts a retired manage permission a base role gives", () => {
    const notes = rowNotes(row("settings"), ["manage-settings"], []);
    expect(notes[0]).toContain("from a base role");
    expect(notes[0]).toContain("nextly upgrade");
    expect(notes[0]).not.toContain("saving this role converts it");
  });

  it("says on Settings what changing collections and Singles needs", () => {
    expect(rowNotes(row("settings"), [], [])).toEqual([SCHEMA_HELP]);
    expect(rowNotes(row("media"), [], [])).toEqual([]);
  });

  it("tells a role that may update settings without the other two that it cannot change the schema", () => {
    expect(rowNotes(row("settings"), ["update-settings"], [])).toEqual([
      SCHEMA_HELP,
      NOT_SCHEMA,
    ]);
    expect(
      rowNotes(
        row("settings"),
        PLAIN.map(action => `${action}-settings`),
        []
      )
    ).toEqual([SCHEMA_HELP]);
    expect(rowNotes(row("settings"), ["manage-settings"], [])).not.toContain(
      NOT_SCHEMA
    );
  });
});

describe("roleScreenRows", () => {
  // A collection created before `settings` was reserved keeps the name, and
  // the permissions on `settings` are the built-in resource's.
  const entities = [
    {
      slug: "settings",
      kind: "collection" as const,
      labels: { singular: "Setting", plural: "Settings" },
      plugin: null,
      declaredRules: [],
    },
    {
      slug: "posts",
      kind: "collection" as const,
      labels: { singular: "Post", plural: "Posts" },
      plugin: null,
      declaredRules: [],
    },
  ];
  const screen = roleScreenRows(entities, [
    ...PERMISSIONS,
    permission("settings", "publish"),
    permission("posts", "read"),
  ]);

  it("shows a collection named for a built-in resource as the built-in row", () => {
    const settings = screen.appRows.filter(r => r.slug === "settings");
    expect(settings.map(r => r.kind)).toEqual(["system"]);
    expect(settings[0]?.permissions.map(p => p.action)).toEqual([
      ...PLAIN,
      "manage",
      "publish",
    ]);
    // POPULATION CONTROL: another collection still gets its own row.
    expect(
      screen.appRows.filter(r => r.slug === "posts").map(r => r.kind)
    ).toEqual(["collection"]);
  });
});
