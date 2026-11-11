/**
 * The content types the SEO settings screen lists, through the plugin's own
 * route as a signed-in person, on every configured dialect: each type the
 * plugin adds SEO to, the variables its pattern may use, the newest page to
 * preview it with, and whether the type has a public address yet. Only a
 * reader of the SEO settings is answered, and only a reader of a type is
 * shown its page.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, textarea } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import type { SeoContentType } from "../contract";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const POSTS = "seoc_posts";
const CASES = "seoc_cases";
const NOTES = "seoc_notes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "the content types the SEO settings list (%s)",
  (dialect: TestDialect) => {
    async function boot(withNotes = false) {
      const notes = defineCollection({
        slug: NOTES,
        labels: { singular: "Note", plural: "Notes" },
        // Everyone who may read notes reads the open team's only.
        access: { read: () => ({ team: { equals: "open" } }) },
        fields: [text({ name: "title" }), text({ name: "team" })],
      });
      const t = await createTestNextly({
        dialect,
        collections: [
          ...(withNotes ? [notes] : []),
          defineCollection({
            slug: POSTS,
            labels: { singular: "Blog post", plural: "Blog posts" },
            publicAddress: "/blog/{slug}",
            fields: [
              text({ name: "title" }),
              text({ name: "slug" }),
              text({ name: "category", label: "Category" }),
              textarea({ name: "excerpt" }),
            ],
          }),
          defineCollection({
            slug: CASES,
            labels: { singular: "Case study", plural: "Case studies" },
            fields: [text({ name: "name" })],
          }),
        ],
        plugins: [
          seoPlugin({
            collections: withNotes ? [NOTES] : [POSTS, CASES],
          }),
        ],
      });
      current = t;
      return t;
    }

    /** A new account holding a role with exactly `permissions`, or none. */
    async function personWith(
      t: TestNextly,
      name: string,
      permissions: readonly string[]
    ): Promise<string> {
      const stored = await t.nextly.permissions.find({ limit: 1000 });
      const ids = permissions.map(slug => {
        const found = stored.items.find(p => p.slug === slug);
        if (found === undefined) throw new Error(`no permission ${slug}`);
        return String(found.id);
      });
      const roles =
        ids.length === 0
          ? []
          : [
              String(
                (
                  await t.nextly.roles.create({
                    data: { name, slug: `seoc-${name}`, permissionIds: ids },
                  })
                ).item.id
              ),
            ];
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true, roles },
      });
      return String(created.item.id);
    }

    /** The route's answer to `userId`: its status and, when it answers, its list. */
    async function listFor(t: TestNextly, userId: string) {
      const person = await t.nextly.users.findByID({ id: userId });
      const token = await signAccessToken(
        buildClaims({
          userId: person.id,
          email: person.email,
          name: person.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const segments = [
        "plugins",
        "@nextlyhq",
        "plugin-seo",
        "settings",
        "content-types",
      ];
      const res = await createDynamicHandlers().GET(
        new Request(`http://localhost/api/${segments.join("/")}`, {
          headers: { cookie: `nextly_session=${token}` },
        }),
        { params: Promise.resolve({ params: segments }) }
      );
      if (!res.ok) return { status: res.status, items: undefined };
      const body = (await res.json()) as { items: SeoContentType[] };
      return { status: res.status, items: body.items };
    }

    it("lists each type with its variables, a page to preview with and whether it is public", async () => {
      const t = await boot();
      // The first account holds super-admin.
      const owner = await personWith(t, "owner", []);
      await t.nextly.create({
        collection: POSTS,
        data: {
          title: "Surfer SEO vs Rext AI",
          slug: "surfer-seo-vs-rext-ai",
          category: "Comparisons",
          excerpt: "Two tools, two points in a workflow.",
        },
      });

      const { status, items } = await listFor(t, owner);

      expect(status).toBe(200);
      expect(items).toEqual([
        {
          key: POSTS,
          label: "Blog posts",
          fields: [
            { name: "slug", token: "Slug" },
            { name: "category", token: "Category" },
            { name: "excerpt", token: "Excerpt" },
          ],
          example: {
            title: "Surfer SEO vs Rext AI",
            values: {
              slug: "surfer-seo-vs-rext-ai",
              category: "Comparisons",
              excerpt: "Two tools, two points in a workflow.",
            },
            address: "/blog/surfer-seo-vs-rext-ai",
          },
          public: true,
        },
        // No address declared, and no page yet. `name` is what `{Title}`
        // reads on this type, so it is not offered again.
        {
          key: CASES,
          label: "Case studies",
          fields: [{ name: "slug", token: "Slug" }],
          public: false,
        },
      ]);
    });

    it("shows a page only to a reader of its type, and refuses anyone who may not read the SEO settings", async () => {
      const t = await boot();
      await personWith(t, "owner", []);
      await t.nextly.create({
        collection: POSTS,
        data: { title: "A post", slug: "a-post" },
      });
      const settingsOnly = await personWith(t, "settings-only", [
        "read-seo-settings",
      ]);
      const nobody = await personWith(t, "nobody", []);

      const answered = await listFor(t, settingsOnly);
      expect(answered.status).toBe(200);
      expect(answered.items?.map(type => type.example)).toEqual([
        undefined,
        undefined,
      ]);

      expect((await listFor(t, nobody)).status).toBe(403);
    });

    it("shows a reader only a page their own read rules let them see", async () => {
      const t = await boot(true);
      await personWith(t, "owner", []);
      await t.nextly.create({
        collection: NOTES,
        data: { title: "Open note", team: "open" },
      });
      await t.nextly.create({
        collection: NOTES,
        data: { title: "Closed note", team: "closed" },
      });
      const reader = await personWith(t, "note-reader", [
        "read-seo-settings",
        `read-${NOTES}`,
      ]);

      const { status, items } = await listFor(t, reader);

      expect(status).toBe(200);
      expect(items?.[0]?.example?.title).toBe("Open note");
    });
  }
);
