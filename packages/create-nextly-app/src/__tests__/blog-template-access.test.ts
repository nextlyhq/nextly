/**
 * The blog template's access rules decide by permission, never by role name.
 *
 * The collections are loaded as the template ships them (vitest.config.ts
 * aliases `nextly` to a stub whose builders pass the config through), and each
 * rule is called with the context Nextly gives a rule: the caller's role slugs,
 * and their permissions as `resource:action`.
 *
 * The case that separates the two is a role named for nothing in particular
 * that holds the permission: a rule reading role names refuses it, and so does
 * an API key whose roles carry no such names. The mirror is a role NAMED
 * `author` or `editor` that holds nothing, which a role-name rule admits.
 */
import { describe, expect, it } from "vitest";

import { Categories } from "../../../../templates/blog/src/collections/Categories";
import { Posts } from "../../../../templates/blog/src/collections/Posts/index";
import { Tags } from "../../../../templates/blog/src/collections/Tags";
import { pickPermissionIdsForRoles } from "../../../../templates/blog/src/endpoints/seed/index";

type Operation = "create" | "read" | "update" | "delete";
type Rule = (ctx: Record<string, unknown>) => boolean | Promise<boolean>;

/** The context Nextly hands a collection rule. */
function context(
  collection: string,
  operation: Operation,
  caller: {
    user: { id: string } | null;
    roles: string[];
    permissions: string[];
  }
) {
  return { ...caller, principal: null, operation, collection };
}

function ruleOf(
  collection: { slug: string; access?: Record<string, unknown> },
  operation: Operation
): Rule {
  const rule = collection.access?.[operation];
  if (typeof rule !== "function")
    throw new Error(`${collection.slug} declares no ${operation} rule`);
  return rule as Rule;
}

const COLLECTIONS = [Posts, Categories, Tags] as Array<{
  slug: string;
  access?: Record<string, unknown>;
}>;
const WRITES: Operation[] = ["create", "update", "delete"];

describe("blog template — access rules", () => {
  for (const collection of COLLECTIONS) {
    for (const operation of WRITES) {
      const rule = ruleOf(collection, operation);
      const slug = collection.slug;

      it(`${slug}.${operation}: admits a custom role holding ${operation}-${slug}`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "u1" },
          roles: ["reviewer"],
          permissions: [`${slug}:${operation}`],
        });
        expect(await rule(ctx)).toBe(true);
      });

      it(`${slug}.${operation}: admits an API key holding the permission, whatever its roles`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "key-owner" },
          roles: [],
          permissions: [`${slug}:${operation}`],
        });
        expect(await rule(ctx)).toBe(true);
      });

      it(`${slug}.${operation}: refuses a role named for content work that lacks the permission`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "u2" },
          roles: ["admin", "editor", "author"],
          permissions: [`${slug}:read`],
        });
        expect(await rule(ctx)).toBe(false);
      });

      it(`${slug}.${operation}: refuses a visitor`, async () => {
        const ctx = context(slug, operation, {
          user: null,
          roles: [],
          permissions: [],
        });
        expect(await rule(ctx)).toBe(false);
      });
    }

    it(`${collection.slug}.read: stays open to a visitor`, async () => {
      const ctx = context(collection.slug, "read", {
        user: null,
        roles: [],
        permissions: [],
      });
      expect(await ruleOf(collection, "read")(ctx)).toBe(true);
    });
  }
});

describe("blog template — seeded roles", () => {
  /** A permissions catalog of every action on the resources the seed reads. */
  const catalog = ["posts", "categories", "tags", "media"].flatMap(resource =>
    [
      "create",
      "read",
      "update",
      "delete",
      "publish",
      "unpublish",
      "manage",
    ].map(action => ({ id: `${action}-${resource}`, action, resource }))
  );
  const nextly = {
    permissions: { find: async () => ({ items: catalog }) },
  } as unknown as Parameters<typeof pickPermissionIdsForRoles>[0];

  it("gives an author no delete or publish on posts", async () => {
    const { author } = await pickPermissionIdsForRoles(nextly);
    expect(author.filter(id => id.endsWith("-posts")).sort()).toEqual([
      "create-posts",
      "read-posts",
      "update-posts",
    ]);
  });

  it("leaves an editor able to publish and delete posts", async () => {
    const { editor } = await pickPermissionIdsForRoles(nextly);
    expect(editor).toEqual(
      expect.arrayContaining(["publish-posts", "delete-posts"])
    );
  });
});
