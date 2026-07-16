/**
 * Role presets.
 *
 * The predicates are the part worth testing hardest: they decide what a role
 * called "Editor" means in every project that ever boots, against a permission
 * list this file never sees. Pure, so they test without a database.
 *
 * The escalation cases matter most. A preset that hands out `update-roles` has
 * handed out everything, since whoever holds it can grant themselves the rest.
 */
import { describe, expect, it } from "vitest";

import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetPermission,
} from "./role-presets";

const preset = (slug: string) => {
  const found = ROLE_PRESETS.find(p => p.slug === slug);
  if (!found) throw new Error(`no preset "${slug}"`);
  return found;
};

const perm = (
  action: string,
  resource: string,
  owner: string | null = null
): PresetPermission => ({ action, resource, owner });

/** A permission list shaped like a real project's. */
const PERMISSIONS: PresetPermission[] = [
  // a collection
  perm("create", "posts"),
  perm("read", "posts"),
  perm("update", "posts"),
  perm("delete", "posts"),
  // a collection with drafts
  perm("read", "pages"),
  perm("publish", "pages"),
  // system resources
  perm("create", "users"),
  perm("read", "users"),
  perm("update", "users"),
  perm("delete", "users"),
  perm("read", "roles"),
  perm("update", "roles"),
  perm("manage", "settings"),
  perm("read", "settings"),
  perm("manage", "media"),
  perm("read", "media"),
  perm("create", "media"),
  perm("delete", "media"),
  // a plugin's
  perm("export", "submissions", "@nextlyhq/plugin-form-builder"),
];

const slugs = (p: PresetPermission[]) =>
  p.map(x => `${x.action}-${x.resource}`).sort();

describe("every preset", () => {
  it("has a distinct slug", () => {
    const seen = ROLE_PRESETS.map(p => p.slug);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("has a distinct level", () => {
    const seen = ROLE_PRESETS.map(p => p.level);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("sits below super admin, which is level 100", () => {
    for (const p of ROLE_PRESETS) {
      expect(p.level).toBeLessThan(100);
    }
  });

  it("resolves to something on a real permission list", () => {
    for (const p of ROLE_PRESETS) {
      expect(resolvePreset(p, PERMISSIONS).length).toBeGreaterThan(0);
    }
  });

  // The point of a predicate. A preset written today has to cover a
  // collection added a year from now without anyone editing this file.
  it("covers a collection it has never heard of", () => {
    const later = [...PERMISSIONS, perm("read", "invented-later")];

    for (const slug of ["admin", "editor", "author", "viewer"]) {
      const granted = slugs(resolvePreset(preset(slug), later));
      expect(granted).toContain("read-invented-later");
    }
  });
});

describe("admin", () => {
  const granted = slugs(resolvePreset(preset("admin"), PERMISSIONS));

  it("does not grant the power to hand out access", () => {
    expect(granted).not.toContain("update-roles");
    expect(granted).not.toContain("create-users");
    expect(granted).not.toContain("update-users");
    expect(granted).not.toContain("delete-users");
  });

  it("can still see roles and users", () => {
    expect(granted).toContain("read-roles");
    expect(granted).toContain("read-users");
  });

  it("gets everything else, including settings and plugins", () => {
    expect(granted).toContain("manage-settings");
    expect(granted).toContain("delete-posts");
    expect(granted).toContain("publish-pages");
    expect(granted).toContain("export-submissions");
  });
});

describe("editor", () => {
  const granted = slugs(resolvePreset(preset("editor"), PERMISSIONS));

  it("gets full control of content", () => {
    expect(granted).toEqual(
      expect.arrayContaining([
        "create-posts",
        "read-posts",
        "update-posts",
        "delete-posts",
        "publish-pages",
      ])
    );
  });

  it("gets media, because content needs images", () => {
    expect(granted).toContain("manage-media");
  });

  it("does not get the framework's own furniture", () => {
    expect(granted).not.toContain("manage-settings");
    expect(granted).not.toContain("read-users");
    expect(granted).not.toContain("read-roles");
  });
});

describe("author", () => {
  const granted = slugs(resolvePreset(preset("author"), PERMISSIONS));

  it("can write content", () => {
    expect(granted).toEqual(
      expect.arrayContaining(["create-posts", "read-posts", "update-posts"])
    );
  });

  it("cannot delete or publish it", () => {
    expect(granted).not.toContain("delete-posts");
    expect(granted).not.toContain("publish-pages");
  });

  // `manage` is a superset we cannot see inside, so an author does not hold
  // one — otherwise manage-media would quietly return the delete this preset
  // just withheld.
  it("does not get a manage anywhere", () => {
    expect(granted.filter(s => s.startsWith("manage-"))).toEqual([]);
  });

  it("does not get the framework's own furniture", () => {
    expect(granted).not.toContain("read-users");
  });
});

describe("viewer", () => {
  const granted = slugs(resolvePreset(preset("viewer"), PERMISSIONS));

  it("reads everything that can be read", () => {
    expect(granted).toEqual(
      expect.arrayContaining(["read-posts", "read-pages", "read-settings"])
    );
  });

  it("changes nothing", () => {
    for (const slug of granted) {
      expect(slug.startsWith("read-")).toBe(true);
    }
  });
});

describe("the presets against each other", () => {
  const of = (slug: string) =>
    new Set(slugs(resolvePreset(preset(slug), PERMISSIONS)));

  // Not a rule the code enforces, but the names promise it, and a viewer who
  // could do something an author could not would make the ladder a lie.
  it("gives an author everything a viewer has", () => {
    const author = of("author");
    for (const slug of of("viewer")) {
      // Except the furniture an author is deliberately kept out of.
      if (slug.endsWith("-users") || slug.endsWith("-roles")) continue;
      if (slug === "read-settings") continue;
      expect(author.has(slug)).toBe(true);
    }
  });

  it("gives an editor everything an author has", () => {
    const editor = of("editor");
    for (const slug of of("author")) {
      expect(editor.has(slug)).toBe(true);
    }
  });

  it("gives an admin everything an editor has", () => {
    const admin = of("admin");
    for (const slug of of("editor")) {
      expect(admin.has(slug)).toBe(true);
    }
  });
});
