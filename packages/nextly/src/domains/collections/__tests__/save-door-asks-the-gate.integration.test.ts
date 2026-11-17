/**
 * A save that names a status changes what readers see, so it is judged by the publish gate as a
 * publish of chosen parts is: early, again on its own transaction once the entry is locked, and
 * settled before it commits. Every door a status save comes through asks it: a save, a save to
 * every language, an update of several entries, and a create that publishes.
 *
 * The plausible broken implementation asks the gate only where a publish of chosen parts is
 * requested, so a save naming `status: "published"` puts an entry live past a gate that holds it.
 */
import { afterEach, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { DynamicCollectionService } from "../../dynamic-collections/services/dynamic-collection-service";
import { CollectionFileManager } from "../../../services/collection-file-manager";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { PublishGate, PublishPart } from "../services/publish-gate";

describeEachDialect(
  "a save that names a status asks the publish gate",
  dialect => {
    let t: TestNextly | undefined;
    // The services a plugin is handed, for the doors only a plugin reaches: an update of several
    // entries in one batch, and a save on a transaction the plugin opened.
    let services: PluginContext["services"] | undefined;
    // How many times the "hooked" collection's hooks ran.
    const hookCalls = { count: 0 };
    // How many times the "flipping" collection's after-hooks ran.
    const afterCalls = { count: 0 };
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
    });

    async function boot(): Promise<TestNextly> {
      t = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/save-door-probe",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init: context => {
              services = context.services;
            },
          }),
        ],
        collections: [
          defineCollection({
            slug: "posts",
            localized: true,
            status: true,
            fields: [
              text({ name: "title" }),
              text({ name: "tagline", localized: false }),
            ],
          }),
          defineCollection({
            slug: "notes",
            status: true,
            fields: [text({ name: "title" })],
          }),
          // Its hooks count each call, so a create the gate holds back can be seen to run none.
          defineCollection({
            slug: "hooked",
            status: true,
            fields: [text({ name: "title" })],
            hooks: {
              beforeOperation: [
                () => {
                  hookCalls.count += 1;
                },
              ],
              beforeChange: [
                () => {
                  hookCalls.count += 1;
                },
              ],
            },
          }),
          // A hook of the site's own turns every create into a publish; its after-hooks count calls.
          defineCollection({
            slug: "flipping",
            status: true,
            fields: [text({ name: "title" })],
            hooks: {
              beforeChange: [
                context => {
                  (context.data as Record<string, unknown>).status =
                    "published";
                  return context.data;
                },
              ],
              afterChange: [
                () => {
                  afterCalls.count += 1;
                },
              ],
            },
          }),
          // A field of the author's own that happens to be called what the gate's option once was.
          defineCollection({
            slug: "memos",
            status: true,
            fields: [text({ name: "title" }), text({ name: "withoutReview" })],
          }),
        ],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      return t;
    }

    /**
     * A gate that holds every part back unless the publish is made without review. It records what
     * it is asked early and on the move's transaction, and each settle.
     */
    function heldUnlessWithoutReview(): {
      early: { parts: readonly PublishPart[]; withoutReview?: unknown }[];
      judged: { parts: readonly PublishPart[]; withoutReview?: unknown }[];
      settled: number;
    } {
      const seen = {
        early: [] as {
          parts: readonly PublishPart[];
          withoutReview?: unknown;
        }[],
        judged: [] as {
          parts: readonly PublishPart[];
          withoutReview?: unknown;
        }[],
        settled: 0,
      };
      const held = (question: {
        parts: readonly PublishPart[];
        withoutReview?: { reason: string };
      }) =>
        question.withoutReview === undefined
          ? question.parts.map(part => ({
              part,
              code: "NOT_APPROVED" as const,
              message: "Waiting for approval.",
            }))
          : [];
      container.registerSingleton<PublishGate>("publishGate", () => ({
        refusals: question => {
          seen.early.push(question);
          return Promise.resolve(held(question));
        },
        judge: (_tx, question) => {
          seen.judged.push(question);
          return Promise.resolve({
            refusals: held(question),
            settle: () => {
              seen.settled += 1;
              return Promise.resolve();
            },
          });
        },
      }));
      return seen;
    }

    function refusalOf(promise: Promise<unknown>): Promise<string> {
      return promise.then(
        () => "",
        (error: unknown) =>
          error instanceof Error
            ? `${error.message} ${JSON.stringify((error as { publicData?: unknown }).publicData ?? null)}`
            : String(error)
      );
    }

    async function mainStatus(table: string, id: string): Promise<string> {
      const [row] = await t!.adapter.executeQuery<{ status: string }>(
        `SELECT ${q("status")} AS status FROM ${q(table)} WHERE ${q("id")} = '${id}'`
      );
      return row?.status ?? "";
    }

    async function draftNote(): Promise<string> {
      const created = await t!.nextly.create({
        collection: "notes",
        data: { title: "Draft" },
      } as never);
      return String(created.item.id);
    }

    it("holds back a save that publishes, and nothing goes live", async () => {
      await boot();
      const id = await draftNote();
      heldUnlessWithoutReview();

      const refusal = await refusalOf(
        t!.nextly.update({
          collection: "notes",
          id,
          data: { status: "published", _overwrite: true },
        } as never)
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(await mainStatus("dc_notes", id)).toBe("draft");
    });

    it("holds back a save that publishes one language", async () => {
      await boot();
      const created = await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hello" },
      } as never);
      const id = String(created.item.id);
      const seen = heldUnlessWithoutReview();

      const refusal = await refusalOf(
        t!.nextly.update({
          collection: "posts",
          id,
          locale: "es",
          data: { title: "Hola", status: "published", _overwrite: true },
        } as never)
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(seen.early[0]?.parts).toContainEqual({
        kind: "language",
        locale: "es",
      });
    });

    it("holds back a save that publishes every language", async () => {
      await boot();
      const created = await t!.nextly.create({
        collection: "posts",
        locale: "en",
        data: { title: "Hello" },
      } as never);
      const id = String(created.item.id);
      heldUnlessWithoutReview();

      const refusal = await refusalOf(
        t!.nextly.update({
          collection: "posts",
          id,
          locale: "*",
          data: { status: "published", _overwrite: true },
        } as never)
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(await mainStatus("dc_posts", id)).toBe("draft");
    });

    it("holds back an update of several entries that publishes them", async () => {
      await boot();
      const id = await draftNote();
      const seen = heldUnlessWithoutReview();

      // Each entry the update reaches is a save that names a status: the gate is asked of it, and
      // holds it back. (The update reports entries it could not change without saying why.)
      await t!.nextly
        .update({
          collection: "notes",
          where: { id: { equals: id } },
          data: { status: "published", _overwrite: true },
        } as never)
        .catch(() => undefined);

      expect(seen.early.map(question => question.parts)).toEqual([
        [{ kind: "shared" }],
      ]);
      expect(await mainStatus("dc_notes", id)).toBe("draft");
    });

    it("holds back a create that publishes, and creates nothing live", async () => {
      await boot();
      heldUnlessWithoutReview();

      const refusal = await refusalOf(
        t!.nextly.create({
          collection: "notes",
          data: { title: "Straight out", status: "published" },
        } as never)
      );
      const rows = await t!.adapter.executeQuery<{ status: string }>(
        `SELECT ${q("status")} AS status FROM ${q("dc_notes")} WHERE ${q("status")} = 'published'`
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(rows).toHaveLength(0);
    });

    it("holds back a batch update that publishes", async () => {
      await boot();
      const id = await draftNote();
      const seen = heldUnlessWithoutReview();

      await services!.collections
        .updateMany(
          "notes",
          [{ id, data: { status: "published", _overwrite: true } }],
          {} as never
        )
        .catch(() => undefined);

      expect(seen.judged.map(question => question.parts)).toEqual([
        [{ kind: "shared" }],
      ]);
      expect(await mainStatus("dc_notes", id)).toBe("draft");
    });

    it("holds back a save on a transaction it was handed", async () => {
      await boot();
      const id = await draftNote();
      const seen = heldUnlessWithoutReview();

      let refused: unknown;
      await services!.collections
        .withTransaction(tx =>
          services!.collections.updateEntryInTransaction(
            tx,
            "notes",
            id,
            { status: "published", _overwrite: true },
            {} as never
          )
        )
        .catch((error: unknown) => {
          refused = error;
        });

      expect(
        seen.judged.map(question => question.parts),
        `refused with: ${String(refused)} ${JSON.stringify((refused as { publicData?: unknown } | undefined)?.publicData ?? null)}`
      ).toEqual([[{ kind: "shared" }]]);
      expect(await mainStatus("dc_notes", id)).toBe("draft");
    });

    // The option a save names a publish made without review under is a system key, `_withoutReview`,
    // as `_rev` and `_overwrite` are: a field of the author's own called `withoutReview` is a value
    // like any other, saved as it was sent.
    it("saves a field of its own called withoutReview as a value", async () => {
      await boot();
      const created = await t!.nextly.create({
        collection: "memos",
        data: { title: "Memo", withoutReview: "kept" },
      } as never);
      const id = String(created.item.id);

      await t!.nextly.update({
        collection: "memos",
        id,
        data: { withoutReview: "kept again", _overwrite: true },
      } as never);
      const [row] = await t!.adapter.executeQuery<{ value: string }>(
        `SELECT ${q("without_review")} AS value FROM ${q("dc_memos")} WHERE ${q("id")} = '${id}'`
      );

      expect(row?.value).toBe("kept again");
    });

    // What the gate is told of the collection is resolved before the save's transaction opens:
    // nothing judged under the row lock reads on the pool, where on PostgreSQL and MySQL it would
    // wait for a connection the transaction may be holding.
    it("reads nothing on the pool for the gate while its transaction is open", async () => {
      await boot();
      const id = await draftNote();
      const seen = heldUnlessWithoutReview();
      let depth = 0;
      const adapter = t!.adapter as unknown as {
        transaction: (
          work: (tx: unknown) => Promise<unknown>,
          ...rest: unknown[]
        ) => Promise<unknown>;
      };
      const open = adapter.transaction.bind(adapter);
      vi.spyOn(adapter, "transaction").mockImplementation((work, ...rest) =>
        open(
          async tx => {
            depth += 1;
            try {
              return await work(tx);
            } finally {
              depth -= 1;
            }
          },
          ...rest
        )
      );
      const poolReadsInside: string[] = [];
      const getCollection = DynamicCollectionService.prototype.getCollection;
      vi.spyOn(
        DynamicCollectionService.prototype,
        "getCollection"
      ).mockImplementation(function (this: DynamicCollectionService, ...args) {
        if (depth > 0 && args[1] === undefined) {
          poolReadsInside.push("getCollection");
        }
        return getCollection.apply(this, args);
      });
      const loadCompanion = CollectionFileManager.prototype.loadCompanionSchema;
      vi.spyOn(
        CollectionFileManager.prototype,
        "loadCompanionSchema"
      ).mockImplementation(function (this: CollectionFileManager, ...args) {
        if (depth > 0 && args[1] === undefined) {
          poolReadsInside.push("loadCompanionSchema");
        }
        return loadCompanion.apply(this, args);
      });

      await t!.nextly.update({
        collection: "notes",
        id,
        data: {
          status: "published",
          _withoutReview: { reason: "Correcting a date" },
          _overwrite: true,
        },
      } as never);

      expect(seen.judged).toHaveLength(1);
      expect(poolReadsInside).toEqual([]);
      vi.restoreAllMocks();
    });

    // The gate's early answer to a create that publishes comes before any of its hooks: a create the
    // gate holds back runs no hook (and so no side effect a hook makes) and writes nothing.
    it("asks the gate before a publishing create runs any hook", async () => {
      await boot();
      hookCalls.count = 0;
      heldUnlessWithoutReview();

      const refusal = await refusalOf(
        t!.nextly.create({
          collection: "hooked",
          data: { title: "Straight out", status: "published" },
        } as never)
      );
      const rows = await t!.adapter.executeQuery<{ id: string }>(
        `SELECT ${q("id")} AS id FROM ${q("dc_hooked")}`
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(hookCalls.count).toBe(0);
      expect(rows).toHaveLength(0);
    });

    // A hook of the site's own that turns a create into a publish runs before the gate can know it
    // is one (a stated limit), but the gate's verdict on the create's transaction still holds it
    // back: nothing is stored, no after-hook runs, and nothing is recorded or emitted.
    it("holds back a create a hook turned into a publish, storing and emitting nothing", async () => {
      await boot();
      afterCalls.count = 0;
      heldUnlessWithoutReview();
      const eventsBefore = await t!.adapter.executeQuery<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${q("nextly_content_events")} WHERE ${q("subject_slug")} = 'flipping'`
      );

      const refusal = await refusalOf(
        t!.nextly.create({
          collection: "flipping",
          data: { title: "A draft, as sent", status: "draft" },
        } as never)
      );
      const rows = await t!.adapter.executeQuery<{ id: string }>(
        `SELECT ${q("id")} AS id FROM ${q("dc_flipping")}`
      );
      const eventsAfter = await t!.adapter.executeQuery<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${q("nextly_content_events")} WHERE ${q("subject_slug")} = 'flipping'`
      );

      expect(refusal).toMatch(/NOT_APPROVED/);
      expect(rows).toHaveLength(0);
      expect(afterCalls.count).toBe(0);
      expect(Number(eventsAfter[0]?.n)).toBe(Number(eventsBefore[0]?.n));
    });

    // Unpublishing is never gated: a save that takes an entry down is not held back.
    it("never asks the gate of a save that unpublishes", async () => {
      await boot();
      const created = await t!.nextly.create({
        collection: "notes",
        data: { title: "Live", status: "published" },
      } as never);
      const id = String(created.item.id);
      const seen = heldUnlessWithoutReview();

      await t!.nextly.update({
        collection: "notes",
        id,
        data: { status: "draft", _overwrite: true },
      } as never);

      expect(seen.early).toHaveLength(0);
      expect(seen.judged).toHaveLength(0);
      expect(await mainStatus("dc_notes", id)).toBe("draft");
    });

    // A save made without review says so in its body, beside the status: the gate is told, early and
    // under the lock, and the publish it lets through is settled once.
    it("tells the gate a save made without review, and settles the publish it lets through", async () => {
      await boot();
      const id = await draftNote();
      const seen = heldUnlessWithoutReview();

      await t!.nextly.update({
        collection: "notes",
        id,
        data: {
          status: "published",
          _withoutReview: { reason: "Correcting a date" },
          _overwrite: true,
        },
      } as never);

      expect(await mainStatus("dc_notes", id)).toBe("published");
      expect(seen.early.map(question => question.withoutReview)).toEqual([
        { reason: "Correcting a date" },
      ]);
      expect(seen.judged.map(question => question.withoutReview)).toEqual([
        { reason: "Correcting a date" },
      ]);
      expect(seen.settled).toBe(1);
    });
  }
);
