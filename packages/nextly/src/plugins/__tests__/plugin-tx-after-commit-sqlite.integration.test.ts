/**
 * What a core service does after its write, when it is called inside a
 * plugin's `ctx.db.transaction` on SQLite.
 *
 * The service's own transaction nests there as a savepoint, so its change is
 * durable only once the plugin's transaction commits. Its after-hooks, events,
 * cache revalidation and write-path maintenance wait for that commit: they run
 * once, after it, and never for a change it rolls back. A savepoint that rolls
 * back inside a committing transaction drops only its own. Outside any
 * transaction they run as the service returns, as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineCollection, defineSingle, text } from "../../config";
import { generateSqliteCoreTableStatements } from "../../database/sqlite-core-tables";
import { container } from "../../di/container";
import { deriveCompanionSpec } from "../../domains/i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../domains/i18n/migration/generate-up";
import { registerHook, unregisterHook } from "../../hooks";
import type { HookHandler } from "../../hooks/types";
import type { CacheRevalidator } from "../../revalidation/types";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import type { CollectionService } from "../../services/collections/collection-service";
import type { MediaService } from "../../services/media/media-service";
import type { UserService } from "../../services/users/user-service";
import { getMediaStorage } from "../../storage/storage";
import {
  definePlugin,
  type PluginDatabase,
  type PluginSettingsApi,
} from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

const SLUG = "notes";
const PDF = pdfDocument("after-commit");

let current: TestNextly | undefined;
const unregister: Array<() => void> = [];

afterEach(async () => {
  for (const undo of unregister.splice(0)) undo();
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

interface Captured {
  db: PluginDatabase;
  users: UserService;
  collections: CollectionService;
  media: MediaService;
  settings: PluginSettingsApi;
}

/** Everything a test observes, in the order it happened. */
interface Seen {
  log: string[];
  revalidated: string[];
}

async function boot(): Promise<{ ctx: Captured; seen: Seen }> {
  let captured: Captured | undefined;
  const seen: Seen = { log: [], revalidated: [] };
  const afterChange = (args: { value?: unknown }) => {
    seen.log.push(`field.afterChange:${String(args.value)}`);
  };
  const plugin = definePlugin({
    name: "@test/after-commit",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      settings: z.object({ port: z.number().default(443) }),
    },
    init(ctx) {
      captured = {
        db: ctx.db,
        users: ctx.services.users,
        collections: ctx.services.collections as unknown as CollectionService,
        media: ctx.services.media,
        settings: ctx.settings as PluginSettingsApi,
      };
    },
  });
  current = await createTestNextly({
    plugins: [plugin],
    collections: [
      defineCollection({
        slug: SLUG,
        access: { create: () => true, update: () => true, delete: () => true },
        fields: [
          text({ name: "title", hooks: { afterChange: [afterChange] } }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "site",
        fields: [
          text({ name: "siteName", hooks: { afterChange: [afterChange] } }),
        ],
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  // The SQLite runtime auto-sync does not create the core auth tables.
  for (const statement of generateSqliteCoreTableStatements()) {
    await current.adapter.executeQuery(statement);
  }
  // An install's first account is super-admin, which a plugin may not create;
  // core makes it, before anything below is listening.
  await (current.getService("userService") as UserService).create(
    {
      email: "founder@example.com",
      name: "Founder",
      password: "Passw0rd!long",
    },
    {}
  );
  await current.events.settle();

  for (const event of [
    "user.created",
    "user.deleted",
    `collection.${SLUG}.created`,
    `collection.${SLUG}.updated`,
    `collection.${SLUG}.deleted`,
    "media.uploaded",
    "plugin.settings.changed",
  ]) {
    current.events.on(event, () => {
      seen.log.push(event);
    });
  }
  for (const phase of ["afterCreate", "afterUpdate", "afterDelete"] as const) {
    const hook: HookHandler = () => {
      seen.log.push(`hook.${phase}`);
    };
    registerHook(phase, SLUG, hook);
    unregister.push(() => unregisterHook(phase, SLUG, hook));
  }
  const revalidator = container.get<CacheRevalidator>("cacheRevalidator");
  vi.spyOn(revalidator, "flush").mockImplementation(intents => {
    seen.revalidated.push(...intents.flatMap(intent => intent.tags));
  });
  vi.spyOn(getMediaStorage(), "upload").mockResolvedValue({
    url: "/uploads/after-commit.pdf",
    path: "after-commit.pdf",
  });
  return { ctx: captured, seen };
}

/** The writes each test makes, each through a different core service. */
async function writeEverything(ctx: Captured, tag: string): Promise<void> {
  await ctx.users.create(
    { email: `${tag}@example.com`, name: tag, password: "Passw0rd!long" },
    {}
  );
  await ctx.collections.createEntry(SLUG, { title: tag }, {});
  await ctx.media.upload(
    {
      buffer: PDF,
      filename: `${tag}.pdf`,
      mimeType: "application/pdf",
      size: PDF.length,
    },
    {}
  );
  await ctx.settings.set({ port: 8443 });
}

const EVERY_EFFECT = [
  "user.created",
  "hook.afterCreate",
  `collection.${SLUG}.created`,
  "field.afterChange:",
  "media.uploaded",
  "plugin.settings.changed",
];

/** Order-free comparison, with the field hook's value stripped. */
function kinds(log: string[]): string[] {
  return log
    .map(entry => entry.replace(/afterChange:.*/, "afterChange:"))
    .sort();
}

describe("a core write inside ctx.db.transaction on sqlite", () => {
  it("announces nothing when the transaction rolls back", async () => {
    const { ctx, seen } = await boot();

    await expect(
      ctx.db.transaction(async () => {
        await writeEverything(ctx, "rolled-back");
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    await current!.events.settle();

    expect(seen.log).toEqual([]);
    expect(seen.revalidated).toEqual([]);
    // The control: the writes really were undone, so silence is correct.
    expect(
      await ctx.users.findByEmail("rolled-back@example.com", {})
    ).toBeNull();
  });

  it("announces each change once, after the transaction commits", async () => {
    const { ctx, seen } = await boot();
    let seenInside: string[] = [];
    let revalidatedInside: string[] = [];

    await ctx.db.transaction(async () => {
      await writeEverything(ctx, "committed");
      seenInside = [...seen.log];
      revalidatedInside = [...seen.revalidated];
    });
    await current!.events.settle();

    expect(seenInside).toEqual([]);
    expect(revalidatedInside).toEqual([]);
    expect(kinds(seen.log)).toEqual([...EVERY_EFFECT].sort());
    expect(seen.revalidated).toContain(`nextly:${SLUG}`);
    expect(seen.revalidated).toContain("nextly:media");
  });

  it("drops only what a rolled-back savepoint announced", async () => {
    const { ctx, seen } = await boot();

    await ctx.db.transaction(async () => {
      await ctx.collections.createEntry(SLUG, { title: "kept" }, {});
      // A service's own transaction nests as a savepoint; this one fails
      // after the entry inside it was written, so the entry and its effects
      // go with it.
      await ctx.collections
        .withTransaction(async () => {
          await ctx.collections.createEntry(SLUG, { title: "undone" }, {});
          throw new Error("savepoint failed");
        })
        .catch(() => undefined);
      await ctx.users.create(
        { email: "sibling@example.com", name: "s", password: "Passw0rd!long" },
        {}
      );
    });
    await current!.events.settle();

    expect(seen.log).not.toContain("field.afterChange:undone");
    expect(seen.log.filter(e => e === "hook.afterCreate")).toHaveLength(1);
    expect(seen.log).toContain("field.afterChange:kept");
    expect(seen.log).toContain("user.created");
  });

  it("announces as the service returns outside any transaction", async () => {
    const { ctx, seen } = await boot();

    await ctx.collections.createEntry(SLUG, { title: "alone" }, {});
    const afterCreate = [...seen.log];
    await ctx.settings.set({ port: 8443 });

    expect(afterCreate).toEqual(
      expect.arrayContaining([
        "hook.afterCreate",
        `collection.${SLUG}.created`,
        "field.afterChange:alone",
      ])
    );
    expect(seen.log).toContain("plugin.settings.changed");
    expect(seen.revalidated).toContain(`nextly:${SLUG}`);
  });

  it("drops a deleted user's event and a Single's effects on rollback", async () => {
    const { ctx, seen } = await boot();
    const doomed = await ctx.users.create(
      { email: "doomed@example.com", name: "d", password: "Passw0rd!long" },
      {}
    );
    await current!.events.settle();
    seen.log.length = 0;
    seen.revalidated.length = 0;

    await expect(
      ctx.db.transaction(async () => {
        await ctx.users.delete(doomed.id, {});
        await current!.nextly.updateSingle({
          slug: "site",
          data: { siteName: "rolled-back" },
        });
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    await current!.events.settle();

    expect(seen.log).toEqual([]);
    expect(seen.revalidated).toEqual([]);
    // The control: the account is still there, so silence is correct.
    expect(
      await ctx.users.findByEmail("doomed@example.com", {})
    ).not.toBeNull();

    await ctx.db.transaction(async () => {
      await ctx.users.delete(doomed.id, {});
      await current!.nextly.updateSingle({
        slug: "site",
        data: { siteName: "committed" },
      });
    });
    await current!.events.settle();

    expect(seen.log).toEqual(
      expect.arrayContaining(["user.deleted", "field.afterChange:committed"])
    );
    expect(seen.revalidated.length).toBeGreaterThan(0);
  });

  it("holds a collection transaction's cache flush for the outer commit", async () => {
    const { ctx, seen } = await boot();

    await expect(
      ctx.db.transaction(async () => {
        await ctx.collections.withTransaction(tx =>
          ctx.collections.createEntryInTransaction(
            tx,
            SLUG,
            { title: "in-tx" },
            {}
          )
        );
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");

    expect(seen.revalidated).toEqual([]);

    await ctx.db.transaction(() =>
      ctx.collections.withTransaction(tx =>
        ctx.collections.createEntryInTransaction(
          tx,
          SLUG,
          { title: "in-tx" },
          {}
        )
      )
    );

    expect(seen.revalidated).toContain(`nextly:${SLUG}`);
  });

  it("announces an entry's update and deletion only once they commit", async () => {
    const { ctx, seen } = await boot();
    const created = (await ctx.collections.createEntry(
      SLUG,
      { title: "before" },
      {}
    )) as unknown as { item: { id: string } };
    const id = created.item.id;
    await current!.events.settle();
    seen.log.length = 0;
    seen.revalidated.length = 0;
    const updateThenDelete = async () => {
      await ctx.collections.updateEntry(SLUG, id, { title: "after" }, {});
      await ctx.collections.deleteEntry(SLUG, id, {});
    };

    await expect(
      ctx.db.transaction(async () => {
        await updateThenDelete();
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    await current!.events.settle();

    expect(seen.log).toEqual([]);
    expect(seen.revalidated).toEqual([]);
    // The control: the entry is still there as it was, so silence is correct.
    expect((await ctx.collections.findEntryById(SLUG, id, {})).title).toBe(
      "before"
    );

    await ctx.db.transaction(updateThenDelete);
    await current!.events.settle();

    expect(kinds(seen.log)).toEqual(
      [
        "hook.afterUpdate",
        `collection.${SLUG}.updated`,
        "field.afterChange:",
        "hook.afterDelete",
        `collection.${SLUG}.deleted`,
      ].sort()
    );
    expect(seen.revalidated).toContain(`nextly:${SLUG}`);
  });
});

describe("a publish inside ctx.db.transaction on sqlite", () => {
  const STATUS_EVENTS = [
    "document.published",
    "document.statusChanged",
    "document.statusTransition",
  ];

  /** A localized collection with drafts, its companion table, and a draft entry. */
  async function bootWithDraft() {
    let db: PluginDatabase | undefined;
    current = await createTestNextly({
      plugins: [
        definePlugin({
          name: "@test/after-commit-publish",
          version: "1.0.0",
          nextly: ">=0.0.0",
          init(ctx) {
            db = ctx.db;
          },
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    if (!db) throw new Error("the plugin's init did not run");
    const spec = deriveCompanionSpec({
      slug: "pages",
      fields: [{ name: "title", type: "text", localized: true }],
      dialect: current.adapter.dialect,
      defaultLocale: "en",
      collectionLocalized: true,
      builtBy: "codeFirst",
      status: true,
    });
    if (!spec) throw new Error("no companion spec for pages");
    if (!(await current.adapter.tableExists(spec.companionTable))) {
      await current.adapter.executeQuery(buildCompanionCreateOnlySql(spec));
    }
    const handler = current.getService(
      "collectionsHandler"
    ) as CollectionsHandler;
    const created = await handler.createEntry(
      { collectionName: "pages", locale: "en", overrideAccess: true },
      { title: "en", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    const seen: string[] = [];
    for (const name of STATUS_EVENTS) {
      current.events.on(name, () => {
        seen.push(name);
      });
    }
    const entries = handler.getEntryService() as CollectionEntryService;
    const publish = async () => {
      const result = await entries.publishAllLocales({
        collectionName: "pages",
        entryId: id,
        overrideAccess: true,
      });
      expect(result.success).toBe(true);
    };
    return { db, seen, publish };
  }

  it("announces a publish only once it commits", async () => {
    const { db, seen, publish } = await bootWithDraft();

    await expect(
      db.transaction(async () => {
        await publish();
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    await current!.events.settle();

    expect(seen).toEqual([]);

    await db.transaction(publish);
    await current!.events.settle();

    expect(seen).toContain("document.published");
    expect(seen).toContain("document.statusTransition");
  });
});
