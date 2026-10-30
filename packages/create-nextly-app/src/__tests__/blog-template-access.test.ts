/**
 * The blog template's access rules decide by permission, never by role name.
 *
 * The collections are loaded as the template ships them (vitest.config.ts
 * aliases `nextly` to a stub whose builders pass the config through), and each
 * rule is called with the context Nextly gives a rule: the caller's role slugs,
 * and their permissions as the Roles screen spells them (`update-posts`).
 *
 * The case that separates the two is a role named for nothing in particular
 * that holds the permission: a rule reading role names refuses it, and so does
 * an API key whose roles carry no such names. The mirror is a role NAMED
 * `author` or `editor` that holds nothing, which a role-name rule admits.
 *
 * Posts' update and delete rules answer a filter: a caller holding
 * `publish-posts` changes every post, anyone else only the posts whose
 * `author` is them. The case that separates that from a role-name rule is a
 * role named `editor` without `publish-posts`, which gets the filter.
 */
import { describe, expect, it } from "vitest";

import { Categories } from "../../../../templates/blog/src/collections/Categories";
import { Posts } from "../../../../templates/blog/src/collections/Posts/index";
import { Tags } from "../../../../templates/blog/src/collections/Tags";
import visualConfig from "../../../../templates/blog/configs/visual.config";
import {
  pickPermissionIdsForRoles,
  postsLimitDeletesToTheirAuthor,
} from "../../../../templates/blog/src/endpoints/seed/index";

type Operation = "create" | "read" | "update" | "delete";
type Rule = (ctx: Record<string, unknown>) => unknown;

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

/** The writes whose rule answers a filter rather than `true`. */
const OWN_POSTS: Operation[] = ["update", "delete"];
const answersOwnPosts = (slug: string, operation: Operation) =>
  slug === "posts" && OWN_POSTS.includes(operation);

describe("blog template — access rules", () => {
  for (const collection of COLLECTIONS) {
    for (const operation of WRITES) {
      const rule = ruleOf(collection, operation);
      const slug = collection.slug;

      // A caller who may publish posts changes every post, so Posts' update
      // and delete admit them outright, as every other write admits a holder.
      const admitting = answersOwnPosts(slug, operation)
        ? [`${operation}-${slug}`, "publish-posts"]
        : [`${operation}-${slug}`];

      it(`${slug}.${operation}: admits a custom role holding ${admitting.join(" and ")}`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "u1" },
          roles: ["reviewer"],
          permissions: admitting,
        });
        expect(await rule(ctx)).toBe(true);
      });

      it(`${slug}.${operation}: admits an API key holding the permission, whatever its roles`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "key-owner" },
          roles: [],
          permissions: admitting,
        });
        expect(await rule(ctx)).toBe(true);
      });

      it(`${slug}.${operation}: refuses a role named for content work that lacks the permission`, async () => {
        const ctx = context(slug, operation, {
          user: { id: "u2" },
          roles: ["admin", "editor", "author"],
          permissions: [`${slug}:read`, "publish-posts"],
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

describe("blog template — authors change only their own posts", () => {
  for (const operation of OWN_POSTS) {
    const rule = ruleOf(Posts, operation);

    it(`posts.${operation}: limits a holder of ${operation}-posts without publish-posts to the posts they wrote`, async () => {
      const ctx = context("posts", operation, {
        user: { id: "u1" },
        roles: ["reviewer"],
        permissions: [`${operation}-posts`],
      });
      expect(await rule(ctx)).toEqual({ author: { equals: "u1" } });
    });

    it(`posts.${operation}: limits an API key without publish-posts to its owner's posts`, async () => {
      const ctx = context("posts", operation, {
        user: { id: "key-owner" },
        roles: [],
        permissions: [`${operation}-posts`],
      });
      expect(await rule(ctx)).toEqual({ author: { equals: "key-owner" } });
    });

    it(`posts.${operation}: limits a role named editor or admin that lacks publish-posts`, async () => {
      const ctx = context("posts", operation, {
        user: { id: "u3" },
        roles: ["admin", "editor"],
        permissions: [`${operation}-posts`],
      });
      expect(await rule(ctx)).toEqual({ author: { equals: "u3" } });
    });
  }
});

describe("blog template — who wrote a post", () => {
  type FieldRule = (ctx: Record<string, unknown>) => unknown;
  const author = (Posts.fields as Array<Record<string, unknown>>).find(
    field => field.name === "author"
  );

  function fieldRule(operation: "create" | "update"): FieldRule {
    const access = author?.access as Record<string, unknown> | undefined;
    const rule = access?.[operation];
    if (typeof rule !== "function")
      throw new Error(`posts.author declares no ${operation} rule`);
    return rule as FieldRule;
  }

  for (const operation of ["create", "update"] as const) {
    it(`posts.author.${operation}: lets a holder of publish-posts set the author`, async () => {
      const ctx = context("posts", operation, {
        user: { id: "u1" },
        roles: ["reviewer"],
        permissions: ["publish-posts"],
      });
      expect(await fieldRule(operation)(ctx)).toBe(true);
    });

    it(`posts.author.${operation}: refuses anyone else, whatever their roles are named`, async () => {
      const ctx = context("posts", operation, {
        user: { id: "u2" },
        roles: ["admin", "editor"],
        permissions: [`${operation}-posts`],
      });
      expect(await fieldRule(operation)(ctx)).toBe(false);
    });
  }

  /** Posts' beforeChange hooks, run in order as Nextly runs them. */
  async function beforeChange(
    operation: "create" | "update",
    data: Record<string, unknown>,
    user?: { id: string }
  ): Promise<Record<string, unknown>> {
    const hooks = (Posts.hooks?.beforeChange ?? []) as Array<
      (ctx: Record<string, unknown>) => unknown
    >;
    let current = data;
    for (const hook of hooks) {
      const next = await hook({
        collection: "posts",
        operation,
        data: current,
        user,
        context: {},
      });
      if (next && typeof next === "object")
        current = next as Record<string, unknown>;
    }
    return current;
  }

  it("makes a new post the caller's own when it names no author", async () => {
    const saved = await beforeChange("create", { title: "Mine" }, { id: "u1" });
    expect(saved.author).toBe("u1");
  });

  it("keeps the author a new post names", async () => {
    const saved = await beforeChange(
      "create",
      { title: "Theirs", author: "u9" },
      { id: "u1" }
    );
    expect(saved.author).toBe("u9");
  });

  it("leaves the author alone on an update", async () => {
    const saved = await beforeChange("update", { title: "Edit" }, { id: "u1" });
    expect(saved).not.toHaveProperty("author");
  });

  it("sets no author when there is no caller", async () => {
    const saved = await beforeChange("create", { title: "Server" });
    expect(saved).not.toHaveProperty("author");
  });
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

  it("gives an author delete but no publish on posts where Posts limits a delete to its author", async () => {
    const { author } = await pickPermissionIdsForRoles(nextly, {
      authorsDeleteOwnPosts: true,
    });
    expect(author.filter(id => id.endsWith("-posts")).sort()).toEqual([
      "create-posts",
      "delete-posts",
      "read-posts",
      "update-posts",
    ]);
  });

  // A visual blog's Posts carries no code rule, so the permission alone
  // decides a delete: granted, it would reach every author's posts.
  it("withholds delete from an author where nothing limits a delete to its author", async () => {
    const { author } = await pickPermissionIdsForRoles(nextly, {
      authorsDeleteOwnPosts: false,
    });
    expect(author.filter(id => id.endsWith("-posts")).sort()).toEqual([
      "create-posts",
      "read-posts",
      "update-posts",
    ]);
  });

  it("finds the own-posts delete rule in the code-first Posts, and none in the visual config", () => {
    expect(postsLimitDeletesToTheirAuthor({ collections: [Posts] })).toBe(true);
    expect(postsLimitDeletesToTheirAuthor(visualConfig)).toBe(false);
    expect(
      postsLimitDeletesToTheirAuthor({
        collections: [{ ...Posts, access: { ...Posts.access, delete: true } }],
      })
    ).toBe(false);
  });

  it("leaves an editor able to publish and delete posts", async () => {
    const { editor } = await pickPermissionIdsForRoles(nextly);
    expect(editor).toEqual(
      expect.arrayContaining(["publish-posts", "delete-posts"])
    );
  });
});
