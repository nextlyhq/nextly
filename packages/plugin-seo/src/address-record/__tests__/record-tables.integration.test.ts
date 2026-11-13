/**
 * The address record in the SEO plugin's own tables: what a save's
 * bookkeeping costs, that two saves of one address still never both commit,
 * and that the record an earlier version kept in a collection moves over
 * whole, its claims still answering afterwards.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  definePlugin,
  type HeldAddressUpdate,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf, writesAmong } from "../../__tests__/count-statements";
import { readProxyStatus } from "../../redirects/proxy-seen";
import { seoPlugin } from "../../plugin";
import { addressNotes } from "../../schema/tables";
import { readStanding } from "../../staging/guard";
import { catchUp, lastCatchUp } from "../catch-up";
import { ADDRESS_RECORD_SLUG } from "../collection";
import { addressHolders } from "../participant";
import { pendingMoves } from "../pending-moves";
import { claimKey, sha256 } from "../rows";
import { moveEarlierRecord, noteKey } from "../store";

import {
  claimRows,
  forgetRecord,
  noteRows,
  recordedRows,
  seoContext,
} from "./record-tables";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that hands its context over, to move addresses directly. */
function contextOf() {
  const seen: { ctx?: PluginContext } = {};
  const plugin = definePlugin({
    name: "@test/address-mover",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      seen.ctx = ctx;
    },
  });
  return { plugin, seen };
}

async function boot(dialect: TestDialect, renamed?: string) {
  const { plugin, seen } = contextOf();
  const seo = seoPlugin({ collections: ["pages", "posts"] });
  current = await createTestNextly({
    dialect,
    plugins: [
      renamed === undefined
        ? seo
        : seo.rename({ [ADDRESS_RECORD_SLUG]: renamed }),
      plugin,
    ],
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/blog/{slug}",
      }),
    ],
  });
  const ctx = seen.ctx;
  if (!ctx) throw new Error("the helper plugin never started");
  await lastCatchUp();
  return { t: current, ctx, record: renamed ?? ADDRESS_RECORD_SLUG };
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

/** Make `updates` as one batch, as a save asks the record to. */
function move(ctx: PluginContext, updates: HeldAddressUpdate[]) {
  return ctx.services.collections.withTransaction(tx =>
    ctx.publicAddresses.move(updates, tx)
  );
}

const post = (id: string, ...paths: string[]): HeldAddressUpdate => ({
  holder: { collection: "posts", id, label: `Post ${id}` },
  holds: paths.map(path => ({ locale: "en", path })),
});

/**
 * Wait for the page heads a committed change expires to be expired: the
 * expiry follows the commit, so it is counted with the change that made it
 * rather than with the next.
 */
const expirySettled = () => new Promise(resolve => setTimeout(resolve, 100));

/** The statements that touch the record's tables, savepoints aside. */
const onRecord = (statements: readonly string[]) =>
  statements.filter(sql => /seo__(addresses|notes)/.test(sql));

describe.each(getConfiguredTestDialects())(
  "the address record's own tables (%s)",
  dialect => {
    it("a save's bookkeeping costs a statement or two a row, not an entry save", async () => {
      const { ctx } = await boot(dialect);
      // Each lock row made once, as a page's first save makes it.
      await move(ctx, [post("1", "/blog/one")]);
      await expirySettled();

      const kept = await statementsOf(dialect, () =>
        move(ctx, [post("1", "/blog/one")])
      );
      const claimed = await statementsOf(dialect, async () => {
        await move(ctx, [post("2", "/blog/two")]);
        await expirySettled();
      });
      // Let go of whole: no address left to leave a redirect to.
      const released = await statementsOf(dialect, async () => {
        await move(ctx, [post("2")]);
        await expirySettled();
      });

      // Every statement of the move, BEGIN and COMMIT included. Before the
      // record had its own tables, each row was written as a whole entry
      // save: the same three moves cost 92, 102 and 35 on PostgreSQL, 98,
      // 106 and 35 on MySQL, and 5, 15 and 19 on SQLite.
      expect(kept.length).toBeLessThanOrEqual(LIMITS[dialect].kept);
      expect(claimed.length).toBeLessThanOrEqual(LIMITS[dialect].claimed);
      expect(released.length).toBeLessThanOrEqual(LIMITS[dialect].released);
      // A move that changes nothing writes nothing but its lock rows.
      expect(
        writesAmong(kept).filter(sql => !/^\s*update\b/i.test(sql))
      ).toEqual([]);
      // Nothing outside the record is written for its rows, but the expiry
      // of the page heads read from it, once a change commits.
      expect(
        writesAmong([...kept, ...claimed, ...released]).filter(
          sql =>
            onRecord([sql]).length === 0 &&
            !/nextly_cache_tag_expiries/.test(sql)
        )
      ).toEqual([]);
      expect(kept.filter(sql => /nextly_cache_tag_expiries/.test(sql))).toEqual(
        []
      );
    });

    it("of many saves of one address at once, one commits and the others are refused", async () => {
      const { t } = await boot(dialect);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, (_, n) =>
          publish(t, n % 2 === 0 ? "pages" : "posts", "same")
        ).concat(
          // The posts are served under /blog: these meet only each other.
          Array.from({ length: 2 }, () => publish(t, "posts", "same"))
        )
      );

      const kept = Object.entries(await recordedRows());
      // One page at /same, one post at /blog/same.
      expect(kept.map(([at]) => at).sort()).toEqual([
        "en|/blog/same",
        "en|/same",
      ]);
      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(2);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          // Refused for the address, or, where MySQL refuses one of two
          // saves making one lock row at once as a deadlock, asked to try
          // again: never a save that went through.
          expect(["DUPLICATE", "CONFLICT"]).toContain(
            (outcome.reason as { code?: string }).code
          );
        }
      }
    });

    it("a range and an address inside it, claimed at once, never both commit", async () => {
      const { ctx } = await boot(dialect);
      for (let round = 0; round < 3; round++) {
        const base = `/go${round}`;
        const outcomes = await Promise.allSettled([
          move(ctx, [
            {
              holder: { collection: "lists", id: `r${round}` },
              holds: [{ locale: "en", path: base, range: true }],
            },
          ]),
          move(ctx, [post(`a${round}`, `${base}/inside`)]),
        ]);
        const committed = outcomes.filter(
          o => o.status === "fulfilled" && o.value.refused.length === 0
        );
        expect(committed).toHaveLength(1);
      }
      const held = Object.keys(await recordedRows());
      for (let round = 0; round < 3; round++) {
        expect(held.filter(at => at.startsWith(`en|/go${round}`))).toHaveLength(
          1
        );
      }
    });

    it("moves every row an earlier version kept in its collection, and its claims still answer", async () => {
      const { t, record } = await boot(dialect, "seo_addresses");
      const seo = seoContext();
      await forgetRecord(seo);
      await forgetMoved(seo);
      await keepEarlier(t, record);

      const moved = await moveEarlierRecord(seo);

      // The two claims and five notes; the lock row is made again when taken.
      expect(moved).toBe(7);
      expect(await recordedRows(seo)).toEqual({
        "en|/old": "pages:p1",
        "en|/list": "lists:1",
      });
      expect(
        (await claimRows(seo)).find(row => row.path === "/old")
      ).toMatchObject({ holderLabel: "Old page" });
      expect(await addressHolders(seo, "/list/page/2", "en")).toEqual([
        { collection: "lists", id: "1" },
      ]);
      // A second page is refused the address moved over.
      await expect(publish(t, "pages", "old")).rejects.toMatchObject({
        code: "DUPLICATE",
      });
      // The notes answer as they did: the standing, the Proxy's note, the
      // owed redirect, and the fingerprint, which skips the next catch-up.
      expect(await readStanding(seo)).toBe("listable");
      expect((await readProxyStatus(seo)).lastSeen).toBe(SEEN);
      expect(await pendingMoves(seo)).toEqual([
        {
          key: PENDING_KEY,
          holder: { collection: "pages", id: "p1" },
          address: { locale: "en", path: "/older" },
        },
      ]);
      expect(await noteValue(seo, "fingerprint")).toBe(
        await seo.publicAddresses.fingerprint()
      );
      // A move found done moves nothing, however often it runs.
      expect(await moveEarlierRecord(seo)).toBe(0);
      expect(Object.keys(await recordedRows(seo))).toHaveLength(2);
      // The earlier rows are left where they were.
      const { items } = await t.nextly.find({ collection: record, limit: 50 });
      expect(items).toHaveLength(8);
    });

    it("two starts moving the earlier record at once move each row once", async () => {
      const { t, record } = await boot(dialect);
      const seo = seoContext();
      await forgetRecord(seo);
      await forgetMoved(seo);
      await keepEarlier(t, record);

      const counts = await Promise.all([
        moveEarlierRecord(seo),
        moveEarlierRecord(seo),
      ]);

      expect(counts.sort((a, b) => a - b)).toEqual([0, 7]);
      expect(Object.keys(await recordedRows(seo))).toHaveLength(2);
      expect(
        (await noteRows(seo)).filter(row => row.kind === "pending")
      ).toHaveLength(1);
    });

    it("a start where nothing changed after the move reads its notes once and writes nothing", async () => {
      await boot(dialect);
      await catchUp();

      const statements = await statementsOf(dialect, async () => {
        expect((await catchUp()).ran).toBe(false);
        expect(await moveEarlierRecord(seoContext())).toBe(0);
      });

      expect(writesAmong(statements)).toEqual([]);
      expect(statements.length).toBeLessThanOrEqual(4);
    });
  }
);

/**
 * The most statements each move above may cost: what each dialect measured
 * (2, 6, 4 on SQLite; 14, 28, 9 on PostgreSQL; 12, 18, 7 on MySQL), with a
 * little room.
 */
const LIMITS: Record<
  TestDialect,
  { kept: number; claimed: number; released: number }
> = {
  sqlite: { kept: 4, claimed: 8, released: 6 },
  postgresql: { kept: 16, claimed: 30, released: 12 },
  mysql: { kept: 14, claimed: 20, released: 10 },
};

/** When the Proxy last ran, as the earlier record noted it. */
const SEEN = "2026-11-01T10:00:00.000Z";

/** The key the earlier record kept its one pending move under. */
const PENDING_KEY = sha256("pending:pages:p1|address:en|/older");

/** The value of the note `name`, or none. */
async function noteValue(seo: PluginContext, name: string) {
  const row = await seo.db
    .select(addressNotes)
    .where(eq(seo.db.table(addressNotes).noteKey, noteKey(name)))
    .first();
  return row?.value ?? undefined;
}

/** Forget that the earlier record has moved, as before an upgrade. */
async function forgetMoved(seo: PluginContext) {
  await seo.db
    .delete(addressNotes)
    .where(eq(seo.db.table(addressNotes).noteKey, noteKey("record-moved")));
}

/**
 * The rows an earlier version kept in its collection `record`: two claims,
 * one a range, a lock row, the catch-up's fingerprint and site types, the
 * Proxy's note, the site's standing and one pending move.
 */
async function keepEarlier(t: TestNextly, record: string) {
  const seo = seoContext();
  const rows: Record<string, unknown>[] = [
    {
      claimKey: claimKey("address", "en", "/old"),
      kind: "address",
      locale: "en",
      path: "/old",
      holderCollection: "pages",
      holderId: "p1",
      holderLabel: "Old page",
    },
    {
      claimKey: claimKey("range", "en", "/list"),
      kind: "range",
      locale: "en",
      path: "/list",
      holderCollection: "lists",
      holderId: "1",
    },
    {
      claimKey: claimKey("lock", "en", "/old"),
      kind: "lock",
      locale: "en",
      path: "/old",
    },
    {
      claimKey: noteKey("fingerprint"),
      kind: "meta",
      path: await seo.publicAddresses.fingerprint(),
    },
    {
      claimKey: noteKey("site-types"),
      kind: "meta",
      path: JSON.stringify(["pages", "posts"]),
    },
    { claimKey: noteKey("proxy-seen"), kind: "meta", path: SEEN },
    { claimKey: noteKey("staging-standing"), kind: "meta", path: "listable" },
    {
      claimKey: PENDING_KEY,
      kind: "pending",
      locale: "en",
      path: JSON.stringify({ locale: "en", path: "/older" }),
      holderCollection: "pages",
      holderId: "p1",
    },
  ];
  for (const data of rows) await t.nextly.create({ collection: record, data });
}
