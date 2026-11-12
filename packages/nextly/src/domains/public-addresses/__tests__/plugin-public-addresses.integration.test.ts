/**
 * `ctx.publicAddresses`: a plugin takes part in keeping every public address
 * to one page, moves addresses itself through the same question, and reads
 * what it needs to catch its record up at start.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import type { PublicAddressParticipant } from "../../../plugins/plugin-public-addresses";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

import { memoryParticipant } from "./memory-participant";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin keeping its record in memory, handing its context to the test. */
function recordPlugin(participant: PublicAddressParticipant | undefined) {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/address-record",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
      if (participant) ctx.publicAddresses.participate(participant);
    },
  });
  return { plugin, seen };
}

/** {@link memoryParticipant} as a plugin hands it over, noting each `db`. */
function asPluginParticipant(record = memoryParticipant()) {
  const dbs: unknown[] = [];
  const participant: PublicAddressParticipant = {
    holderOf: (address, asker, batch, { db }) => {
      dbs.push(db);
      return record.runner.holderOf(address, asker, batch, undefined as never);
    },
    record: (batch, { db }) => {
      dbs.push(db);
      return record.runner.record(batch, undefined as never);
    },
  };
  return { record, participant, dbs };
}

async function boot(
  dialect: TestDialect,
  participant?: PublicAddressParticipant,
  postsAddress = "/blog/{slug}",
  fallback?: boolean
) {
  const { plugin, seen } = recordPlugin(participant);
  current = await createTestNextly({
    dialect,
    plugins: [plugin],
    ...(fallback === undefined
      ? {}
      : {
          localization: {
            locales: ["en", "fr"],
            defaultLocale: "en",
            fallback,
          },
        }),
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: postsAddress,
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the plugin never started");
  return { t: current, ctx };
}

async function publish(t: TestNextly, slug: string): Promise<string> {
  const created = await t.nextly.create({
    collection: "posts",
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

describe.each(getConfiguredTestDialects())(
  "a plugin takes part through ctx.publicAddresses (%s)",
  dialect => {
    it("is asked on a save, on its own database bound to the save", async () => {
      const { record, participant, dbs } = asPluginParticipant();
      const { t } = await boot(dialect, participant);

      const post = await publish(t, "hello");

      expect(record.held()).toEqual({ "en|/blog/hello": `posts:${post}` });
      expect(dbs.length).toBeGreaterThan(0);
      expect(dbs.every(db => typeof db === "object" && db !== null)).toBe(true);
    });

    it("move returns the refused updates and records the rest", async () => {
      const { record, participant } = asPluginParticipant();
      const { t, ctx } = await boot(dialect, participant);
      const post = await publish(t, "hello");

      const { refused } = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "pages", id: "p1", label: "Taken" },
              holds: [{ locale: "en", path: "/blog/hello" }],
            },
            {
              holder: { collection: "pages", id: "p2" },
              holds: [{ locale: "en", path: "/free" }],
            },
          ],
          tx
        )
      );

      expect(refused).toEqual([
        {
          update: {
            holder: { collection: "pages", id: "p1", label: "Taken" },
            holds: [{ locale: "en", path: "/blog/hello" }],
          },
          address: { locale: "en", path: "/blog/hello" },
          heldBy: { collection: "posts", id: post, label: "hello" },
        },
      ]);
      expect(record.held()).toEqual({
        "en|/blog/hello": `posts:${post}`,
        "en|/free": "pages:p2",
      });
    });

    it("move lets two documents swap addresses in one batch", async () => {
      const { record, participant } = asPluginParticipant();
      const { ctx } = await boot(dialect, participant);
      const a = { collection: "pages", id: "a" };
      const b = { collection: "pages", id: "b" };
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: [{ locale: "en", path: "/one" }] },
            { holder: b, holds: [{ locale: "en", path: "/two" }] },
          ],
          tx
        )
      );

      const { refused } = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: [{ locale: "en", path: "/two" }] },
            { holder: b, holds: [{ locale: "en", path: "/one" }] },
          ],
          tx
        )
      );

      expect(refused).toEqual([]);
      expect(record.held()).toEqual({
        "en|/two": "pages:a",
        "en|/one": "pages:b",
      });
    });

    it("move refuses an update that relied on a refused one letting go", async () => {
      const { record, participant } = asPluginParticipant();
      const { ctx } = await boot(dialect, participant);
      const a = { collection: "pages", id: "a" };
      const b = { collection: "pages", id: "b" };
      const c = { collection: "pages", id: "c" };
      const at = (path: string) => [{ locale: "en", path }];
      await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: at("/one") },
            { holder: b, holds: at("/two") },
            { holder: c, holds: at("/three") },
          ],
          tx
        )
      );

      // A wants C's address, so A stays at /one, and B cannot move onto it.
      const { refused } = await ctx.services.collections.withTransaction(tx =>
        ctx.publicAddresses.move(
          [
            { holder: a, holds: at("/three") },
            { holder: b, holds: at("/one") },
          ],
          tx
        )
      );

      expect(refused.map(r => r.update.holder.id).sort()).toEqual(["a", "b"]);
      expect(record.held()).toEqual({
        "en|/one": "pages:a",
        "en|/two": "pages:b",
        "en|/three": "pages:c",
      });
    });

    it("move is refused once its transaction has ended", async () => {
      const { record, participant } = asPluginParticipant();
      const { ctx } = await boot(dialect, participant);
      let kept: Parameters<typeof ctx.publicAddresses.move>[1] | undefined;
      await ctx.services.collections.withTransaction(async tx => {
        kept = tx;
      });
      if (kept === undefined) throw new Error("no transaction was handed over");

      await expect(
        ctx.publicAddresses.move(
          [
            {
              holder: { collection: "pages", id: "late" },
              holds: [{ locale: "en", path: "/late" }],
            },
          ],
          kept
        )
      ).rejects.toThrow();
      expect(record.held()).toEqual({});
    });

    it("a move that fails part-way rolls its transaction back, even when caught", async () => {
      const { participant } = asPluginParticipant();
      const { ctx } = await boot(dialect, participant);
      const failing: PublicAddressParticipant = {
        holderOf: () => Promise.resolve(null),
        record: () => Promise.reject(new Error("second record failed")),
      };
      ctx.publicAddresses.participate(failing);

      const outcome = ctx.services.collections.withTransaction(async tx => {
        await ctx.publicAddresses
          .move(
            [
              {
                holder: { collection: "pages", id: "p" },
                holds: [{ locale: "en", path: "/half" }],
              },
            ],
            tx
          )
          .catch(() => undefined);
      });

      await expect(outcome).rejects.toThrow("second record failed");
    });

    it("held pages through a type in id order, each once", async () => {
      const { t, ctx } = await boot(dialect);
      const ids = [
        await publish(t, "one"),
        await publish(t, "two"),
        await publish(t, "three"),
      ];

      const page = await ctx.publicAddresses.held({
        type: { kind: "collection", slug: "posts" },
        limit: 2,
      });
      const rest = await ctx.publicAddresses.held({
        type: { kind: "collection", slug: "posts" },
        limit: 2,
        after: page.next,
      });
      const listed = [...page.items, ...rest.items];

      expect(page.items).toHaveLength(2);
      expect(rest.next).toBeUndefined();
      expect(listed.map(item => item.holder.id).sort()).toEqual(
        [...ids].sort()
      );
      // In id order, the order the cursor pages in, so a document made or
      // deleted while a caller pages never moves one not yet read behind it.
      // Ids need not follow creation order, so this is not creation order.
      const byId = await t.nextly.find({ collection: "posts", sort: "id" });
      expect(listed.map(item => item.holder.id)).toEqual(
        byId.items.map(item => String(item.id))
      );
      // Each carries when it was made, for a caller to settle claims oldest
      // first across types.
      expect(listed.every(item => typeof item.createdAt === "string")).toBe(
        true
      );
      const one = listed.find(item => item.holder.id === ids[0]);
      expect(one?.holds).toEqual([{ locale: "en", path: "/blog/one" }]);
    });

    it("fingerprint changes with a declared address, and only then", async () => {
      const before = await (
        await boot(dialect)
      ).ctx.publicAddresses.fingerprint();
      await current?.destroy();
      const same = await (
        await boot(dialect)
      ).ctx.publicAddresses.fingerprint();
      await current?.destroy();
      const moved = await (
        await boot(dialect, undefined, "/news/{slug}")
      ).ctx.publicAddresses.fingerprint();

      expect(same).toBe(before);
      expect(moved).not.toBe(before);
    });

    it("a catch-up started in onReady, not awaited, finishes once the boot has", async () => {
      const started: { done?: Promise<[string, number]> } = {};
      const plugin = definePlugin({
        name: "@test/address-catch-up",
        version: "1.0.0",
        nextly: ">=0.0.0",
        onReady(ctx) {
          started.done = Promise.all([
            ctx.publicAddresses.fingerprint(),
            ctx.publicAddresses
              .held({ type: { kind: "collection", slug: "posts" } })
              .then(page => page.items.length),
          ]);
        },
      });
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });

      const [fingerprint, count] = await (started.done ??
        Promise.reject(new Error("onReady never ran")));
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(count).toBe(0);
    });

    it("a write awaited during the boot, with a participant, does not hold the boot", async () => {
      const { record, participant } = asPluginParticipant();
      const plugin = definePlugin({
        name: "@test/address-boot-write",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          ctx.publicAddresses.participate(participant);
        },
        async onReady(ctx) {
          await ctx.services.collections.createEntry(
            "posts",
            { title: "Seeded", slug: "seeded", status: "published" },
            { overrideAccess: true } as never
          );
        },
      });
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });

      expect(Object.keys(record.held())).toEqual(["en|/blog/seeded"]);
    });

    it("fingerprint changes when the languages fall back differently", async () => {
      const on = await (
        await boot(dialect, undefined, "/blog/{slug}", true)
      ).ctx.publicAddresses.fingerprint();
      await current?.destroy();
      const off = await (
        await boot(dialect, undefined, "/blog/{slug}", false)
      ).ctx.publicAddresses.fingerprint();

      expect(off).not.toBe(on);
    });

    it("fingerprint changes when an address field becomes translated", async () => {
      const fingerprintWith = async (slugTranslated: boolean) => {
        const { plugin, seen } = recordPlugin(undefined);
        current = await createTestNextly({
          dialect,
          plugins: [plugin],
          localization: { locales: ["en", "fr"], defaultLocale: "en" },
          collections: [
            defineCollection({
              slug: "articles",
              localized: true,
              status: true,
              fields: [
                text({ name: "title", localized: false }),
                text({ name: "slug", localized: slugTranslated }),
              ],
              publicAddress: "/articles/{slug}",
            }),
          ],
        });
        const fingerprint = await seen.ctx?.publicAddresses.fingerprint();
        await current.destroy();
        current = undefined;
        return fingerprint;
      };

      const shared = await fingerprintWith(false);
      const translated = await fingerprintWith(true);

      expect(translated).not.toBe(shared);
    });

    it("fingerprint changes when a type gains or loses Draft/Published", async () => {
      const fingerprintWith = async (status: boolean) => {
        const { plugin, seen } = recordPlugin(undefined);
        current = await createTestNextly({
          dialect,
          plugins: [plugin],
          collections: [
            defineCollection({
              slug: "posts",
              status,
              fields: [text({ name: "title" }), text({ name: "slug" })],
              publicAddress: "/blog/{slug}",
            }),
          ],
        });
        const fingerprint = await seen.ctx?.publicAddresses.fingerprint();
        await current.destroy();
        current = undefined;
        return fingerprint;
      };

      const withDrafts = await fingerprintWith(true);
      const withoutDrafts = await fingerprintWith(false);

      expect(withoutDrafts).not.toBe(withDrafts);
    });

    it("fingerprint changes when a type gains or loses Draft/Published", async () => {
      const fingerprintWith = async (status: boolean) => {
        const { plugin, seen } = recordPlugin(undefined);
        current = await createTestNextly({
          dialect,
          plugins: [plugin],
          collections: [
            defineCollection({
              slug: "posts",
              status,
              fields: [text({ name: "title" }), text({ name: "slug" })],
              publicAddress: "/blog/{slug}",
            }),
          ],
        });
        const fingerprint = await seen.ctx?.publicAddresses.fingerprint();
        await current.destroy();
        current = undefined;
        return fingerprint;
      };

      expect(await fingerprintWith(false)).not.toBe(
        await fingerprintWith(true)
      );
    });

    it("a participant's own write rolls back when the save fails", async () => {
      const seen: { ctx?: PluginContext } = {};
      const writer: PublicAddressParticipant = {
        holderOf: () => Promise.resolve(null),
        record: async (batch, { transaction }) => {
          const ctx = seen.ctx;
          if (!ctx) throw new Error("no context");
          for (const update of batch) {
            await ctx.services.collections.createEntryInTransaction(
              transaction,
              "addr_log",
              { holder: `${update.holder.collection}:${update.holder.id}` }
            );
          }
        },
      };
      const failing: PublicAddressParticipant = {
        holderOf: () => Promise.resolve(null),
        record: () => Promise.reject(new Error("second record failed")),
      };
      const plugin = definePlugin({
        name: "@test/address-log-rollback",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: "addr_log",
              fields: [text({ name: "holder" })],
            }),
          ],
        },
        init(ctx) {
          seen.ctx = ctx;
          ctx.publicAddresses.participate(writer);
          ctx.publicAddresses.participate(failing);
        },
      });
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });

      await expect(publish(current, "hello")).rejects.toThrow();

      expect(
        (await current.nextly.find({ collection: "posts" })).items
      ).toEqual([]);
      expect(
        (await current.nextly.find({ collection: "addr_log" })).items
      ).toEqual([]);
    });

    it("a participant writes its own collection on the save's transaction", async () => {
      const seen: { ctx?: PluginContext } = {};
      const participant: PublicAddressParticipant = {
        holderOf: () => Promise.resolve(null),
        record: async (batch, { transaction }) => {
          const ctx = seen.ctx;
          if (!ctx) throw new Error("no context");
          for (const update of batch) {
            await ctx.services.collections.createEntryInTransaction(
              transaction,
              "addr_log",
              { holder: `${update.holder.collection}:${update.holder.id}` }
            );
          }
        },
      };
      const plugin = definePlugin({
        name: "@test/address-log",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: "addr_log",
              fields: [text({ name: "holder" })],
            }),
          ],
        },
        init(ctx) {
          seen.ctx = ctx;
          ctx.publicAddresses.participate(participant);
        },
      });
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });

      const post = await publish(current, "hello");

      const { items } = await current.nextly.find({ collection: "addr_log" });
      expect(items.map(item => item.holder)).toEqual([`posts:${post}`]);
    });

    it("types lists the site's content types, and no plugin's or system one", async () => {
      const { ctx } = await boot(dialect);

      const types = await ctx.publicAddresses.types();

      expect(types).toContainEqual({ kind: "collection", slug: "posts" });
      expect(types.map(type => type.slug)).not.toContain("users");
    });

    it("withdraw stops the asking", async () => {
      const { record, participant } = asPluginParticipant();
      const { t, ctx } = await boot(dialect, participant);

      ctx.publicAddresses.withdraw(participant);
      await publish(t, "hello");

      expect(record.held()).toEqual({});
      expect(t.hooks.hasInTransaction("posts")).toBe(false);
    });
  }
);
