/**
 * The template form's collection choices: exactly the collections the caller
 * may read that the guard's own rule lets a template draw, by name; and a
 * caller who may neither create nor change templates refused before
 * anything is read.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  readTemplateCollectionChoices,
  templateCollectionChoicesRoute,
  type TemplateCollectionChoicesReads,
} from "./template-collection-choices-route";
import type {
  CollectionRecordRead,
  TemplateGuardSetup,
} from "./template-guard";

const SLUG_TEXT = { name: "slug", type: "text" };

/**
 * The registry, as the listing and the guard's record read both answer it.
 * `issues` declares a `slug` that holds a number: its type is known only to
 * the registry, since the public may not read the field.
 */
const RECORDS: Record<string, Record<string, unknown>> = {
  posts: {
    slug: "posts",
    label: "Post",
    labels: { plural: "Posts" },
    fields: [SLUG_TEXT],
  },
  events: { slug: "events", label: "Events", fields: [SLUG_TEXT] },
  // Same name as `events`, so the slug orders the two.
  agenda: { slug: "agenda", label: "Events", fields: [SLUG_TEXT] },
  issues: {
    slug: "issues",
    label: "Issues",
    fields: [{ name: "slug", type: "number" }],
  },
  notes: { slug: "notes", label: "Notes", fields: [{ name: "title" }] },
  // The page builder's own: refused by the guard, Pages among them.
  pages: { slug: "pages", label: "Pages", fields: [SLUG_TEXT] },
  hidden: {
    slug: "hidden",
    label: "Hidden",
    admin: { hidden: true },
    fields: [SLUG_TEXT],
  },
  // Eligible, but the caller may not read it.
  secret: { slug: "secret", label: "Secret", fields: [SLUG_TEXT] },
};

/** The guard's own collections, as the plugin resolves them. */
const OWN = new Set(["pages", "templates"]);

/** The guard's record read over the registry above, and its own collections. */
function guardOf() {
  return {
    readCollection: vi.fn<CollectionRecordRead>(
      async slug => RECORDS[slug] ?? null
    ),
    ownCollections: (): ReadonlySet<string> => OWN,
  };
}

/** Reads over the registry above, recording what was asked, in order. */
function readsWith(
  options: { mayWrite?: boolean; unreadable?: readonly string[] } = {}
) {
  const order: string[] = [];
  const guard = guardOf();
  const reads: TemplateCollectionChoicesReads = {
    mayWriteTemplates: async () => {
      order.push("rights");
      return options.mayWrite ?? true;
    },
    collections: async () => {
      order.push("registry");
      // One listed twice, as a paged listing can.
      return [...Object.values(RECORDS), RECORDS.posts, null, { slug: "" }];
    },
    mayRead: async slug => {
      order.push(`may read ${slug}`);
      return !(options.unreadable ?? ["secret"]).includes(slug);
    },
    guard,
  };
  return { reads, order, guard };
}

describe("readTemplateCollectionChoices", () => {
  it("offers exactly what the guard lets a template draw, of what the caller may read, by name", async () => {
    const { reads } = readsWith();
    // Not `issues`, whose slug is no text; not `notes`, with no slug; not
    // Pages or a hidden collection; not `secret`, which the caller may not
    // read. Each once, by plural name, then slug.
    expect(await readTemplateCollectionChoices(reads)).toEqual([
      { slug: "agenda", label: "Events" },
      { slug: "events", label: "Events" },
      { slug: "posts", label: "Posts" },
    ]);
  });

  it("judges a collection with the guard's own record read, never one the caller may not read", async () => {
    const { reads, guard } = readsWith();
    await readTemplateCollectionChoices(reads);
    const judged = guard.readCollection.mock.calls.map(([slug]) => slug);
    expect(judged).toContain("issues");
    expect(judged).not.toContain("secret");
    // The guard refuses its own collections before reading them.
    expect(judged).not.toContain("pages");
  });

  it("leaves out whatever the caller may not read, eligible or not", async () => {
    const { reads } = readsWith({ unreadable: ["posts", "agenda"] });
    expect(await readTemplateCollectionChoices(reads)).toEqual([
      { slug: "events", label: "Events" },
    ]);
  });

  it("refuses a caller who may write no template before anything is read", async () => {
    const { reads, order, guard } = readsWith({ mayWrite: false });
    await expect(readTemplateCollectionChoices(reads)).rejects.toSatisfy(
      error => NextlyError.isForbidden(error)
    );
    expect(order).toEqual(["rights"]);
    expect(guard.readCollection).not.toHaveBeenCalled();
  });
});

describe("the choices route", () => {
  /** A caller holding exactly `granted`, each as `<action>-<resource>`. */
  function contextFor(
    granted: readonly string[],
    user: unknown = { id: "u1" }
  ) {
    const asked: string[] = [];
    const listCollections = vi.fn(async () => ({
      data: Object.values(RECORDS),
      pagination: { hasMore: false },
    }));
    const ctx = {
      user,
      caller: {
        can: async (
          action: string,
          resource: string,
          options?: { anyEntry?: boolean }
        ) => {
          asked.push(
            `${action}-${resource}${options?.anyEntry === true ? " (any)" : ""}`
          );
          return granted.includes(`${action}-${resource}`);
        },
      },
      self: { collections: {} },
      services: { collections: { listCollections } },
    } as unknown as PluginRouteContext;
    return { ctx, asked, listCollections };
  }

  function routeWith() {
    const guard = guardOf();
    const route = templateCollectionChoicesRoute({
      guard: () =>
        ({
          ...guard,
          templatesCollection: "templates",
        }) as unknown as TemplateGuardSetup,
    });
    return { route, guard };
  }

  const get = (
    route: ReturnType<typeof routeWith>["route"],
    ctx: PluginRouteContext
  ) => route.handler(new Request(`http://nextly.test/x${route.path}`), ctx);

  const READABLE = ["posts", "events", "agenda", "issues", "notes", "pages"];

  it("is served as a GET never stored, answering the list envelope", async () => {
    const { route } = routeWith();
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/templates/collection-choices");
    expect(route).not.toHaveProperty("public");
    expect(route.noStore).toBe(true);
    const { ctx, asked } = contextFor([
      "create-templates",
      ...READABLE.map(slug => `read-${slug}`),
    ]);
    const answer = await get(route, ctx);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      items: [
        { slug: "agenda", label: "Events" },
        { slug: "events", label: "Events" },
        { slug: "posts", label: "Posts" },
      ],
      meta: expect.objectContaining({ total: 3 }),
    });
    // The template right asked of any entry, as the actions ask it.
    expect(asked[0]).toBe("create-templates (any)");
    expect(asked).toContain("read-secret");
  });

  it("answers a caller who may change templates but not create them", async () => {
    const { route } = routeWith();
    const { ctx, asked } = contextFor(["update-templates", "read-posts"]);
    const answer = await get(route, ctx);
    expect(await answer.json()).toMatchObject({
      items: [{ slug: "posts", label: "Posts" }],
    });
    expect(asked.slice(0, 2)).toEqual([
      "create-templates (any)",
      "update-templates (any)",
    ]);
  });

  it("refuses, before the registry is read, a caller with no template right or no person", async () => {
    for (const [granted, user] of [
      [READABLE.map(slug => `read-${slug}`), { id: "u1" }],
      [["create-templates", "read-posts"], null],
    ] as const) {
      const { route, guard } = routeWith();
      const { ctx, listCollections } = contextFor(granted, user);
      await expect(get(route, ctx)).rejects.toSatisfy(error =>
        NextlyError.isForbidden(error)
      );
      expect(listCollections).not.toHaveBeenCalled();
      expect(guard.readCollection).not.toHaveBeenCalled();
    }
  });
});
