/**
 * Where an entry is served, as the site declares it: one answer for every
 * reader that needs a page's public address.
 *
 * A type declared in code states its address in its configuration. A type
 * made in the Schema Builder has none of its own: a plugin supplies it
 * through the `publicAddress.template` seam (the SEO plugin, from its
 * settings). A type with neither is not public yet, and is answered as having
 * no address, never a guessed one; it is listed so a screen can say so.
 *
 * The rows below run against a booted instance, so the answer is read
 * through the configuration and the registry as a running site holds them.
 * Each case boots its own, so one row's seam cannot answer for another's.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import { resetFilterRegistry } from "../../../filters";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineSingle } from "../../../singles/config/define-single";
import { publicAddressOf, typesWithoutAddress } from "../public-address";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

/** What the fixture plugin's seam answers, set by each case before it boots. */
type Source = (
  value: string | undefined,
  context: { kind: string; slug: string; locale?: string }
) => string | undefined;

/** The slugs and contexts the seam was asked about, in order. */
let asked: { kind: string; slug: string; locale?: string }[] = [];

/** A plugin standing in for the SEO plugin's settings, with a collection of its own. */
function addressSource(source: Source | undefined) {
  return definePlugin({
    name: "@test/address-source",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({
          slug: "addr_orders",
          fields: [text({ name: "reference" })],
        }),
      ],
    },
    init(ctx) {
      if (!source) return;
      ctx.filters.add(
        "publicAddress.template",
        (
          value: string | undefined,
          context: { kind: string; slug: string; locale?: string }
        ) => {
          asked.push(context);
          return source(value, context);
        }
      );
    },
  });
}

async function boot(
  dialect: TestDialect,
  source?: Source
): Promise<TestNextly> {
  asked = [];
  current = await createTestNextly({
    dialect,
    plugins: [addressSource(source)],
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
      defineCollection({
        slug: "docs",
        db: { slugPaths: true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "notes",
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        fields: [text({ name: "headline" })],
        publicAddress: "/",
      }),
      defineSingle({
        slug: "footer",
        fields: [text({ name: "copyright" })],
      }),
    ],
  });
  return current;
}

/** A collection made in the Schema Builder, as the admin makes one. */
async function builderCollection(t: TestNextly): Promise<void> {
  const handler = t.getService("collectionsHandler") as unknown as {
    createCollection(
      data: Record<string, unknown>
    ): Promise<{ success: boolean }>;
  };
  const created = await handler.createCollection({
    name: "recipes",
    label: "Recipe",
    fields: [
      { name: "title", type: "text" },
      { name: "handle", type: "text" },
    ],
  });
  expect(created.success, JSON.stringify(created)).toBe(true);
}

describe.each(getConfiguredTestDialects())(
  "an entry's public address (%s)",
  dialect => {
    it("is filled from the address a collection declares in code", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "posts",
        data: { title: "Hello", slug: "hello" },
      });

      expect(
        await publicAddressOf(
          { kind: "collection", slug: "posts" },
          created.item
        )
      ).toEqual({ status: "resolved", path: "/blog/hello" });
    });

    it("keeps a slug path's segments under one placeholder", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "docs",
        data: { title: "Install", slug: "guides/install" },
      });

      expect(
        await publicAddressOf(
          { kind: "collection", slug: "docs" },
          created.item
        )
      ).toEqual({ status: "resolved", path: "/guides/install" });
    });

    it("is the fixed address a Single declares", async () => {
      await boot(dialect);

      expect(await publicAddressOf({ kind: "single", slug: "home" })).toEqual({
        status: "resolved",
        path: "/",
      });
    });

    it("is unavailable while an entry has no value to fill it", async () => {
      await boot(dialect);

      expect(
        await publicAddressOf(
          { kind: "collection", slug: "posts" },
          { title: "Untitled" }
        )
      ).toEqual({ status: "unavailable" });
      expect(
        await publicAddressOf({ kind: "collection", slug: "posts" })
      ).toEqual({ status: "unavailable" });
    });

    it("is none, never a guess, for a type that declares no address", async () => {
      const t = await boot(dialect);
      const note = await t.nextly.create({
        collection: "notes",
        data: { title: "Kept", slug: "kept" },
      });

      expect(
        await publicAddressOf({ kind: "collection", slug: "notes" }, note.item)
      ).toEqual({ status: "none" });
      expect(await publicAddressOf({ kind: "single", slug: "footer" })).toEqual(
        { status: "none" }
      );
    });

    it("is refused for a type that does not exist", async () => {
      await boot(dialect);

      await expect(
        publicAddressOf({ kind: "collection", slug: "missing" }, {})
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lists the site's types without an address, and no plugin's", async () => {
      const t = await boot(dialect);
      await builderCollection(t);

      const without = await typesWithoutAddress();

      expect(without).toEqual(
        expect.arrayContaining([
          { kind: "collection", slug: "notes" },
          { kind: "collection", slug: "recipes" },
          { kind: "single", slug: "footer" },
        ])
      );
      const slugs = without.map(type => type.slug);
      expect(slugs).not.toContain("posts");
      expect(slugs).not.toContain("docs");
      expect(slugs).not.toContain("home");
      // A plugin's own collection is not one of the site's content types.
      expect(slugs).not.toContain("addr_orders");
      // Nor is a collection the system keeps for itself.
      expect(slugs).not.toContain("users");
    });

    describe("for a type made in the Schema Builder", () => {
      it("is none while no plugin supplies one", async () => {
        const t = await boot(dialect);
        await builderCollection(t);

        expect(
          await publicAddressOf(
            { kind: "collection", slug: "recipes" },
            { handle: "soup" }
          )
        ).toEqual({ status: "none" });
      });

      it("comes from the plugin that supplies it", async () => {
        const t = await boot(dialect, (value, context) =>
          context.slug === "recipes" ? "/recipes/{handle}" : value
        );
        await builderCollection(t);

        expect(
          await publicAddressOf(
            { kind: "collection", slug: "recipes" },
            { handle: "soup" },
            "fr"
          )
        ).toEqual({ status: "resolved", path: "/recipes/soup" });
        expect(asked).toContainEqual({
          kind: "collection",
          slug: "recipes",
          locale: "fr",
        });
        expect(await typesWithoutAddress()).not.toContainEqual({
          kind: "collection",
          slug: "recipes",
        });
      });

      it("is none where the plugin's address breaks the rule", async () => {
        const t = await boot(dialect, () => "/recipes");
        await builderCollection(t);

        expect(
          await publicAddressOf(
            { kind: "collection", slug: "recipes" },
            { handle: "soup" }
          )
        ).toEqual({ status: "none" });
      });

      it("is none where the plugin fails", async () => {
        const t = await boot(dialect, () => {
          throw new Error("settings unreadable");
        });
        await builderCollection(t);

        expect(
          await publicAddressOf(
            { kind: "collection", slug: "recipes" },
            { handle: "soup" }
          )
        ).toEqual({ status: "none" });
      });
    });

    it("never asks a plugin about a type declared in code", async () => {
      const t = await boot(dialect, () => "/elsewhere/{slug}");
      const created = await t.nextly.create({
        collection: "posts",
        data: { title: "Hello", slug: "hello" },
      });

      expect(
        await publicAddressOf(
          { kind: "collection", slug: "posts" },
          created.item
        )
      ).toEqual({ status: "resolved", path: "/blog/hello" });
      expect(
        await publicAddressOf(
          { kind: "collection", slug: "notes" },
          created.item
        )
      ).toEqual({ status: "none" });
      expect(await publicAddressOf({ kind: "single", slug: "footer" })).toEqual(
        { status: "none" }
      );
      expect(asked).toEqual([]);
    });

    it("stops the boot where a plugin's Single takes a Single's address", async () => {
      await expect(
        createTestNextly({
          dialect,
          singles: [
            defineSingle({
              slug: "home",
              fields: [text({ name: "headline" })],
              publicAddress: "/",
            }),
          ],
          plugins: [
            definePlugin({
              name: "@test/second-home",
              version: "1.0.0",
              nextly: ">=0.0.0",
              contributes: {
                singles: [
                  defineSingle({
                    slug: "addr_shop_home",
                    fields: [text({ name: "headline" })],
                    publicAddress: "/",
                  }),
                ],
              },
            }),
          ],
        })
      ).rejects.toThrow(/Singles "home" and "addr_shop_home" are both at "\/"/);
    });
  }
);
