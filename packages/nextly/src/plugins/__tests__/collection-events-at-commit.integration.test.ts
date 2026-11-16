/**
 * When a collection's `collection.<slug>.*` events are delivered, on every
 * configured dialect.
 *
 * An event describes a committed row, so it is delivered when the write's
 * transaction commits and never for a write that rolls back. A write that
 * opens its own transaction announces itself as that commits, before its
 * after-hooks run. A write made inside a caller's transaction (the
 * `*InTransaction` methods and the batch writes) is announced when the
 * caller's outermost transaction commits; its after-hooks run inline, inside
 * that transaction, so they come first there.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, json, text } from "../../config";
import { deriveCompanionSpec } from "../../domains/i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../domains/i18n/migration/generate-up";
import { registerHook, unregisterHook } from "../../hooks";
import type { HookHandler } from "../../hooks/types";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";
import type { CollectionService } from "../../services/collections/collection-service";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const SLUG = "notes";
const ACTIONS = ["created", "updated", "deleted"] as const;
const PHASES = ["afterCreate", "afterUpdate", "afterDelete"] as const;

let current: TestNextly | undefined;
const unregister: Array<() => void> = [];

afterEach(async () => {
  for (const undo of unregister.splice(0)) undo();
  await current?.destroy();
  current = undefined;
});

/** What a test observes, in the order it happened. */
interface Booted {
  collections: CollectionService;
  entries: CollectionEntryService;
  /** `event.<action>:<id>` and `hook.<phase>:<id>`, in delivery order. */
  log: string[];
}

async function boot(dialect: TestDialect): Promise<Booted> {
  let collections: CollectionService | undefined;
  const plugin = definePlugin({
    name: "@test/collection-events-at-commit",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      collections = ctx.services.collections as unknown as CollectionService;
    },
  });
  current = await createTestNextly({
    dialect,
    plugins: [plugin],
    collections: [
      defineCollection({
        slug: SLUG,
        access: { create: () => true, update: () => true, delete: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  if (!collections) throw new Error("the plugin's init did not run");
  const entries = (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;

  const log: string[] = [];
  for (const action of ACTIONS) {
    current.events.on<{ id: unknown }>(`collection.${SLUG}.${action}`, e => {
      log.push(`event.${action}:${String(e.payload.id)}`);
    });
  }
  for (const phase of PHASES) {
    const hook: HookHandler = context => {
      const id = (context.data as { id?: unknown } | undefined)?.id;
      log.push(`hook.${phase}:${String(id)}`);
    };
    registerHook(phase, SLUG, hook);
    unregister.push(() => unregisterHook(phase, SLUG, hook));
  }
  return { collections, entries, log };
}

/** The collection events in `log`, without the hooks. */
function eventsIn(log: readonly string[]): string[] {
  return log.filter(line => line.startsWith("event."));
}

/** Every entry of the collection, read outside any transaction. */
async function storedTitles(): Promise<string[]> {
  const found = await current!.nextly.find({ collection: SLUG, limit: 50 });
  return (found.items as Array<{ title: string }>).map(item => item.title);
}

const DIALECTS = getConfiguredTestDialects();
/** SQLite and PostgreSQL nest a transaction as a savepoint; MySQL joins flat. */
const SAVEPOINT_DIALECTS = DIALECTS.filter(dialect => dialect !== "mysql");

describe.each(DIALECTS)("collection events on %s", dialect => {
  it("announces a write that opens its own transaction before its after-hooks", async () => {
    const { collections, log } = await boot(dialect);

    const created = await collections.createEntry(SLUG, { title: "a" }, {});
    const id = String((created as unknown as { item: { id: string } }).item.id);
    await collections.updateEntry(
      SLUG,
      id,
      { title: "b", _overwrite: true },
      {}
    );
    await collections.deleteEntry(SLUG, id, {});
    await current!.events.settle();

    expect(log).toEqual([
      `event.created:${id}`,
      `hook.afterCreate:${id}`,
      `event.updated:${id}`,
      `hook.afterUpdate:${id}`,
      `event.deleted:${id}`,
      `hook.afterDelete:${id}`,
    ]);
  });

  it("announces writes inside a caller's transaction once it commits", async () => {
    const { collections, log } = await boot(dialect);
    let id = "";
    let inside: string[] = [];

    await collections.withTransaction(async tx => {
      const created = await collections.createEntryInTransaction(
        tx,
        SLUG,
        { title: "a" },
        {}
      );
      id = String(created.id);
      await collections.updateEntryInTransaction(
        tx,
        SLUG,
        id,
        { title: "b", _overwrite: true },
        {}
      );
      inside = [...log];
    });
    await current!.events.settle();

    // The after-hooks of this path run inline, inside the transaction; the
    // events wait for it to commit.
    expect(inside).toEqual([
      `hook.afterCreate:${id}`,
      `hook.afterUpdate:${id}`,
    ]);
    expect(eventsIn(log)).toEqual([
      `event.created:${id}`,
      `event.updated:${id}`,
    ]);

    log.length = 0;
    await collections.withTransaction(tx =>
      collections.deleteEntryInTransaction(tx, SLUG, id, {})
    );
    await current!.events.settle();

    expect(log).toEqual([`hook.afterDelete:${id}`, `event.deleted:${id}`]);
  });

  it("announces nothing for writes a caller's transaction rolls back", async () => {
    const { collections, log } = await boot(dialect);
    const kept = await collections.createEntry(SLUG, { title: "kept" }, {});
    const keptId = String(
      (kept as unknown as { item: { id: string } }).item.id
    );
    await current!.events.settle();
    log.length = 0;

    await expect(
      collections.withTransaction(async tx => {
        await collections.createEntryInTransaction(
          tx,
          SLUG,
          { title: "undone" },
          {}
        );
        await collections.updateEntryInTransaction(
          tx,
          SLUG,
          keptId,
          { title: "changed", _overwrite: true },
          {}
        );
        await collections.deleteEntryInTransaction(tx, SLUG, keptId, {});
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");
    await current!.events.settle();

    expect(eventsIn(log)).toEqual([]);
    // The control: the writes really were undone, so silence is correct.
    expect(await storedTitles()).toEqual(["kept"]);
  });

  it("announces each row of a batch, at the commit of the transaction it ran in", async () => {
    const { entries, log } = await boot(dialect);

    const own = await entries.createEntries(
      { collectionName: SLUG, overrideAccess: true },
      [{ title: "one" }, { title: "two" }]
    );
    await current!.events.settle();

    expect(own.successful).toBe(2);
    expect(eventsIn(log).sort()).toEqual(
      own.ids.map(id => `event.created:${id}`).sort()
    );

    // The batch's own transaction joins the caller's, so its rows are
    // announced once the caller's commits.
    log.length = 0;
    let inside: string[] = [];
    let ids: string[] = [];
    await current!.adapter.transaction(async () => {
      const result = await entries.createEntries(
        { collectionName: SLUG, overrideAccess: true },
        [{ title: "three" }, { title: "four" }]
      );
      ids = result.ids;
      inside = eventsIn(log);
    });
    await current!.events.settle();

    expect(ids).toHaveLength(2);
    expect(inside).toEqual([]);
    expect(eventsIn(log).sort()).toEqual(
      ids.map(id => `event.created:${id}`).sort()
    );
  });

  it("still announces a committed write whose after-hook throws", async () => {
    const { collections, log } = await boot(dialect);
    const throwing: HookHandler = () => {
      throw new Error("after-hook failed");
    };
    registerHook("afterCreate", SLUG, throwing);
    unregister.push(() => unregisterHook("afterCreate", SLUG, throwing));

    await collections
      .createEntry(SLUG, { title: "durable" }, {})
      .catch(() => undefined);
    await current!.events.settle();

    expect(eventsIn(log)).toHaveLength(1);
    expect(await storedTitles()).toEqual(["durable"]);
  });
});

describe.each(SAVEPOINT_DIALECTS)(
  "collection events in a savepoint on %s",
  dialect => {
    it("drops only what a rolled-back savepoint announced", async () => {
      const { collections, log } = await boot(dialect);
      let keptId = "";

      await collections.withTransaction(async tx => {
        const kept = await collections.createEntryInTransaction(
          tx,
          SLUG,
          { title: "kept" },
          {}
        );
        keptId = String(kept.id);
        // A nested transaction is a savepoint here; this one fails after its
        // entry was written, so the entry and its event go with it.
        await collections
          .withTransaction(async inner => {
            await collections.createEntryInTransaction(
              inner,
              SLUG,
              { title: "undone" },
              {}
            );
            throw new Error("savepoint failed");
          })
          .catch(() => undefined);
      });
      await current!.events.settle();

      expect(eventsIn(log)).toEqual([`event.created:${keptId}`]);
      // The control: only the savepoint's entry was undone.
      expect(await storedTitles()).toEqual(["kept"]);
    });
  }
);

describe.each(DIALECTS)("publishing every language on %s", dialect => {
  it("announces the publish before its after-hooks", async () => {
    current = await createTestNextly({
      dialect,
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

    const log: string[] = [];
    current.events.on("collection.pages.updated", () => {
      log.push("event.updated");
    });
    const hook: HookHandler = () => {
      log.push("hook.afterUpdate");
    };
    registerHook("afterUpdate", "pages", hook);
    unregister.push(() => unregisterHook("afterUpdate", "pages", hook));

    const entries = handler.getEntryService() as CollectionEntryService;
    const result = await entries.publishAllLocales({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
      data: { _overwrite: true },
    });
    await current.events.settle();

    expect(result.success).toBe(true);
    expect(log[0]).toBe("event.updated");
    expect(log).toContain("hook.afterUpdate");
    expect(log.filter(line => line === "event.updated")).toHaveLength(1);
  });
});

describe.each(DIALECTS)("what a listener is handed on %s", dialect => {
  it("is detached from what the after-hooks are handed", async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "docs",
          fields: [text({ name: "title" }), json({ name: "meta" })],
        }),
      ],
    });
    // A listener runs before the after-hooks, and changes what it is handed.
    for (const action of ACTIONS) {
      current.events.on<{
        data: { meta?: unknown };
        user?: { name?: unknown };
      }>(`collection.docs.${action}`, e => {
        const meta = e.payload.data.meta;
        if (meta && typeof meta === "object") {
          (meta as { tag?: unknown }).tag = "changed by a listener";
        }
        if (e.payload.user) e.payload.user.name = "changed by a listener";
      });
    }
    const seen: Array<{ meta: unknown; user: unknown }> = [];
    for (const phase of PHASES) {
      const hook: HookHandler = context => {
        seen.push({
          meta: (context.data as { meta?: unknown }).meta,
          user: (context.user as { name?: unknown } | undefined)?.name,
        });
      };
      registerHook(phase, "docs", hook);
      unregister.push(() => unregisterHook(phase, "docs", hook));
    }
    const user = { id: "u-1", email: "editor@example.com", name: "Editor" };

    const created = await current.nextly.create({
      collection: "docs",
      data: { title: "a", meta: { tag: "as written" } },
      user,
    });
    const id = (created.item as { id: string }).id;
    await current.nextly.update({
      collection: "docs",
      id,
      data: { meta: { tag: "as written" }, _overwrite: true },
      user,
    });
    await current.nextly.delete({ collection: "docs", id, user });
    await current.events.settle();

    expect(seen).toHaveLength(3);
    for (const { meta, user: name } of seen) {
      // A JSON column comes back as text on SQLite and as a value elsewhere.
      const tag =
        typeof meta === "string"
          ? (JSON.parse(meta) as { tag?: unknown }).tag
          : (meta as { tag?: unknown }).tag;
      expect(tag).toBe("as written");
      expect(name).toBe("Editor");
    }
    expect(user.name).toBe("Editor");
  });
});
