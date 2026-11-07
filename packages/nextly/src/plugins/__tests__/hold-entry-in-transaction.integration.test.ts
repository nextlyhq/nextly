/**
 * A plugin holds an entry its write names, on every dialect, through
 * `ctx.services.collections.holdEntryInTransaction`.
 *
 * The plugin keeps "notes" naming an entry of a host collection, and an
 * in-transaction handler on the host's deletes removes them with their entry.
 * A note written while its entry is deleted must not be left behind.
 *
 * Two separating properties. A hold asked while a delete of the entry is in
 * flight answers that the entry is gone: a plain read on PostgreSQL or MySQL
 * would see the row the delete has not yet committed and answer that it
 * exists. And a delete that starts while a write holds the entry waits for
 * it, so the delete's handler removes the note the write committed: without
 * the hold the delete goes on at once, its handler finds no note, and the
 * note commits after it, naming an entry that is gone. SQLite has one writer
 * at a time, so there the cases pin the answers rather than the locks.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

// Suite-local slugs: integration files share fixed system-table names.
const HOST = "holdentry_posts";
const NOTES = "holdentry_notes";

/**
 * When set, the plugin's handler on the host's deletes says it was reached
 * and waits for `gate`, holding the delete open inside its transaction, after
 * it has removed the entry's row.
 */
const pausing: {
  at?: { reached: () => void; gate: Promise<void> };
} = {};

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  pausing.at = undefined;
  await current?.destroy();
  current = undefined;
});

/** The notes naming entry `id`, as a list asks for them. */
const naming = (id: string) => ({
  where: { entry: { equals: id } },
  pagination: { limit: 100 },
});

/** Boot the plugin, which removes an entry's notes with the entry. */
async function boot(
  dialect: TestDialect
): Promise<{ t: TestNextly; plugin: PluginContext }> {
  let captured: PluginContext | undefined;
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: HOST, fields: [text({ name: "title" })] }),
    ],
    plugins: [
      definePlugin({
        name: "@test/entry-holder",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({
              slug: NOTES,
              fields: [text({ name: "title" }), text({ name: "entry" })],
            }),
          ],
        },
        init(ctx) {
          captured = ctx;
          ctx.hooks.onInTransaction(HOST, async write => {
            if (write.operation !== "delete") return;
            if (pausing.at) {
              pausing.at.reached();
              await pausing.at.gate;
            }
            const { data } =
              await ctx.services.ownCollections.listEntriesInTransaction(
                write.transaction,
                NOTES,
                naming(String(write.id)),
                { lock: "update" }
              );
            for (const row of data) {
              await ctx.services.collections.deleteEntryInTransaction(
                write.transaction,
                NOTES,
                String(row.id),
                {}
              );
            }
          });
        },
      }),
    ],
  });
  current = t;
  if (!captured) throw new Error("the plugin's init did not run");
  return { t, plugin: captured };
}

/** A new host entry's id. */
async function entry(t: TestNextly, title: string): Promise<string> {
  const made = await t.nextly.create({
    collection: HOST,
    data: { title },
    overrideAccess: true,
  });
  return String((made as { item: { id: unknown } }).item.id);
}

/** The titles of the notes stored, whatever they name. */
async function noteTitles(t: TestNextly): Promise<string[]> {
  const found = await t.nextly.find({
    collection: NOTES,
    limit: 100,
    overrideAccess: true,
  });
  return found.items.map(row => String(row.title)).sort();
}

describeEachDialect("holding an entry in a write's transaction", dialect => {
  it("answers whether the entry, and its collection, exist", async () => {
    const { t, plugin } = await boot(dialect);
    const collections = plugin.services.collections;
    const hello = await entry(t, "Hello");
    const hold = (collection: string, id: string) =>
      collections.withTransaction(tx =>
        collections.holdEntryInTransaction(tx, collection, id)
      );

    expect(await hold(HOST, hello)).toBe(true);
    expect(await hold(HOST, `${hello}-missing`)).toBe(false);
    expect(await hold("holdentry_nowhere", hello)).toBe(false);
  });

  it("answers the entry gone once a delete that held it first has ended", async () => {
    const { t, plugin } = await boot(dialect);
    const collections = plugin.services.collections;
    const hello = await entry(t, "Hello");
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let reached!: () => void;
    const inDelete = new Promise<void>(resolve => (reached = resolve));
    pausing.at = { reached, gate };

    const deleting = t.nextly.delete({
      collection: HOST,
      id: hello,
      overrideAccess: true,
    });
    await inDelete;
    // Asked while the delete has removed the row and not yet committed: a
    // hold that took no lock would answer that the entry exists.
    const held = collections.withTransaction(tx =>
      collections.holdEntryInTransaction(tx, HOST, hello)
    );
    await new Promise(resolve => setTimeout(resolve, 200));
    release();
    await deleting;

    expect(await held).toBe(false);
  });

  it("makes a delete that starts while a write holds the entry wait, then remove what it wrote", async () => {
    const { t, plugin } = await boot(dialect);
    const collections = plugin.services.collections;
    const hello = await entry(t, "Hello");
    const kept = await entry(t, "Kept");
    await t.nextly.create({
      collection: NOTES,
      data: { title: "Kept note", entry: kept },
      overrideAccess: true,
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let holding!: () => void;
    const isHeld = new Promise<void>(resolve => (holding = resolve));

    const writing = collections.withTransaction(async tx => {
      const there = await collections.holdEntryInTransaction(tx, HOST, hello);
      if (there) {
        await collections.createEntryInTransaction(
          tx,
          NOTES,
          { title: "Hello note", entry: hello },
          {}
        );
      }
      holding();
      await gate;
      return there;
    });
    await isHeld;
    // Started outside the write's transaction, while it holds the entry and
    // has written its note without committing it.
    const deleting = t.nextly.delete({
      collection: HOST,
      id: hello,
      overrideAccess: true,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    release();

    expect(await writing).toBe(true);
    await deleting;
    expect(await noteTitles(t)).toEqual(["Kept note"]);
  });

  it("refuses a token whose transaction has settled", async () => {
    const { t, plugin } = await boot(dialect);
    const collections = plugin.services.collections;
    const hello = await entry(t, "Hello");
    const settled = await collections.withTransaction(async tx => tx);

    await expect(
      collections.holdEntryInTransaction(settled, HOST, hello)
    ).rejects.toThrow();
  });
});
