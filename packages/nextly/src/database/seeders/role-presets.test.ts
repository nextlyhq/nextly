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

import { defineWorkflow } from "../../domains/workflows/define-workflow";
import { workflowSeededPermissions } from "../../domains/workflows/permissions";
import { reviewWorkflow } from "../../domains/workflows/preset";

import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetPermission,
  type PresetReach,
} from "./role-presets";

/**
 * A reach that lets every permission reach every preset, so each preset's
 * own rule is what these cases judge. Which collections a preset reaches at
 * all is `auth/preset-reach`'s, tested beside it.
 */
const EVERY_PRESET: PresetReach = { presetsFor: () => undefined };

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
      expect(
        resolvePreset(p, PERMISSIONS, EVERY_PRESET).length
      ).toBeGreaterThan(0);
    }
  });

  // The point of a predicate. A preset written today has to cover a
  // collection added a year from now without anyone editing this file, once
  // that collection is opened to it.
  it("covers a collection it has never heard of, where the reach lets it", () => {
    const later = [...PERMISSIONS, perm("read", "invented-later")];

    for (const slug of ["admin", "editor", "author", "viewer"]) {
      const granted = slugs(resolvePreset(preset(slug), later, EVERY_PRESET));
      expect(granted).toContain("read-invented-later");
    }
  });

  it("holds nothing the reach keeps from it, whatever its own rule says", () => {
    const closed: PresetReach = {
      presetsFor: p =>
        p.resource === "posts" ? new Set(["viewer"]) : undefined,
    };
    for (const slug of ["admin", "editor", "author"]) {
      const granted = slugs(resolvePreset(preset(slug), PERMISSIONS, closed));
      expect(granted.filter(g => g.endsWith("-posts"))).toEqual([]);
    }
    expect(
      slugs(resolvePreset(preset("viewer"), PERMISSIONS, closed)).filter(g =>
        g.endsWith("-posts")
      )
    ).toEqual(["read-posts"]);
  });
});

describe("admin", () => {
  const granted = slugs(
    resolvePreset(preset("admin"), PERMISSIONS, EVERY_PRESET)
  );

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
  const granted = slugs(
    resolvePreset(preset("editor"), PERMISSIONS, EVERY_PRESET)
  );

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
  const granted = slugs(
    resolvePreset(preset("author"), PERMISSIONS, EVERY_PRESET)
  );

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
  const granted = slugs(
    resolvePreset(preset("viewer"), PERMISSIONS, EVERY_PRESET)
  );

  it("reads everything that can be read but the staff accounts and API keys", () => {
    expect(granted).toEqual(
      expect.arrayContaining(["read-posts", "read-pages", "read-settings"])
    );
  });

  // Who can sign in, and what each key may do, is not content: a person
  // given Viewer to read the site's content is not given that.
  it("reads neither the users nor the API keys", () => {
    const withKeys = [...PERMISSIONS, perm("read", "api-keys")];
    const of = slugs(resolvePreset(preset("viewer"), withKeys, EVERY_PRESET));
    expect(of).not.toContain("read-users");
    expect(of).not.toContain("read-api-keys");
  });

  it("changes nothing", () => {
    for (const slug of granted) {
      expect(slug.startsWith("read-")).toBe(true);
    }
  });
});

describe("the presets against each other", () => {
  const of = (slug: string) =>
    new Set(slugs(resolvePreset(preset(slug), PERMISSIONS, EVERY_PRESET)));

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

// A workflow's own permissions are each project's to grant: no preset holds one, a step's custom
// action included, while each preset still holds what it held of the same collection.
describe("the permissions a workflow seeds", () => {
  const legalReview = defineWorkflow({
    slug: "legal",
    label: "Legal",
    stages: [
      { name: "drafting", label: "Drafting" },
      { name: "inLegal", label: "In legal" },
      { name: "cleared", label: "Cleared", allowsPublish: true },
    ],
    steps: [
      {
        name: "submit",
        label: "Submit",
        kind: "submit",
        from: "drafting",
        to: "inLegal",
      },
      {
        name: "signOff",
        label: "Sign off",
        kind: "approve",
        from: "inLegal",
        to: "cleared",
        permission: "legal-sign-off",
      },
    ],
    onEdit: { to: "inLegal" },
    afterPublish: "drafting",
  });
  const isWorkflow = workflowSeededPermissions([
    { workflow: reviewWorkflow(), collections: ["posts"], singles: [] },
    { workflow: legalReview, collections: [], singles: ["terms"] },
  ]);
  const SEEDED = [
    perm("approve", "posts"),
    perm("publish-without-review", "posts"),
    perm("legal-sign-off", "terms"),
    perm("publish-without-review", "terms"),
  ];
  const withWorkflows: PresetPermission[] = [
    ...PERMISSIONS,
    perm("publish", "posts"),
    perm("update", "terms"),
    ...SEEDED,
  ];

  it.each(["admin", "editor", "author"])(
    "are held by no %s preset, while it keeps the collection's own",
    slug => {
      const granted = slugs(
        resolvePreset(preset(slug), withWorkflows, EVERY_PRESET, isWorkflow)
      );
      for (const seeded of slugs(SEEDED)) {
        expect(granted).not.toContain(seeded);
      }
      // Not refused wholesale: the same collection's own permission is still granted.
      expect(granted).toContain("update-posts");
    }
  );

  it("are told apart from the permissions they sit beside", () => {
    expect(isWorkflow(perm("approve", "posts"))).toBe(true);
    expect(isWorkflow(perm("Legal-Sign-Off", "Terms"))).toBe(true);
    expect(isWorkflow(perm("approve", "pages"))).toBe(false);
    expect(isWorkflow(perm("publish", "posts"))).toBe(false);
  });
});
