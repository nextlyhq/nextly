/**
 * A Builder delete of a collection removes only the entries the person confirmed in its review: the
 * review counts each collection's entries, the dialog sends those counts back with the delete
 * (`?confirmedEntries=slug:count`), and the delete counts again while it holds the collections'
 * registry rows, refusing with every entry kept where a count moved since.
 *
 * Held there, the count is the one the delete removes on every road: an entry write holds a
 * collection's registry row for share, so it either commits before the count or waits and finds the
 * collection gone, and the tables a writer's files drop afterwards are no longer any write's.
 *
 * An entry write already under way, holding its share of the collection, is waited for and its entry
 * counted.
 *
 * What separates a counted delete from plausible wrong ones: a delete that reads no count removes an
 * entry written after the review uncounted; one that counts outside the held transaction lets an
 * entry in between; one that counts only the collection named first passes a set whose other member
 * moved; one that drops a malformed count deletes uncompared.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const POSTS = "cdc_posts";
const PAGES = "cdc_pages";

/**
 * The roads a delete takes: the Builder save writer's (its drop migration written, then run), and
 * the delete's own without one (the drops run in its transaction).
 */
const ROADS = ["writer", "no writer"] as const;

/** The refusal of a delete whose collection `slug` holds `count` entries now, not those confirmed. */
const refusedWith = (slug: string, count: number) => ({
  code: "VALIDATION_ERROR",
  publicData: {
    errors: [
      expect.objectContaining({
        path: `collections.${slug}`,
        code: "DELETION_COUNT_CHANGED",
        message: expect.stringContaining(`now holds ${String(count)} entr`),
      }),
    ],
  },
});

for (const perLanguage of [false, true]) {
  describe.each(getConfiguredTestDialects())(
    `a collection delete removes the entries confirmed in its review${perLanguage ? ", on per-language storage" : ""} (%s)`,
    dialect => {
      /** The app in development, with POSTS and PAGES made through the Builder. */
      async function boot(): Promise<TestNextly> {
        vi.stubEnv("NODE_ENV", "development");
        const t = await createTestNextly({
          dialect,
          ...(perLanguage ? { perLanguageStorage: true } : {}),
          db: {
            migrationsDir: "./database/history",
            uiSchemaFile: "./schema/builder.json",
          },
        });
        instance = t;
        for (const slug of [POSTS, PAGES]) {
          await dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            {
              name: slug,
              label: slug,
              fields: [{ name: "title", type: "text" }],
            }
          );
        }
        return t;
      }

      /** The delete's service without the Builder save writer, as one built outside the app's registration. */
      function withoutWriter(t: TestNextly): void {
        const handler = t.getService("collectionsHandler");
        const metadata: unknown = Reflect.get(
          handler as object,
          "metadataService"
        );
        expect(metadata, "the metadata service").toBeDefined();
        Reflect.set(metadata as object, "builderSave", undefined);
      }

      /** `n` entries of `slug`, written as a person writes them. */
      async function write(t: TestNextly, slug: string, n: number) {
        for (let index = 0; index < n; index += 1) {
          await t.nextly.create({
            collection: slug,
            data: { title: `${slug} ${String(index)}` },
          } as never);
        }
      }

      /** Whether `slug` is still registered, and its table's entries where it stands. */
      async function stateOf(
        t: TestNextly,
        slug: string
      ): Promise<{ registered: boolean; entries: number | "gone" }> {
        clearRegistryRowCache();
        const registered =
          (await t
            .getService("collectionRegistryService")
            .getCollectionBySlug(slug)) !== null;
        const table = `dc_${slug}`;
        if (!(await t.adapter.tableExists(table))) {
          return { registered, entries: "gone" };
        }
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        const [row] = await t.adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${q(table)}`
        );
        return { registered, entries: Number(row?.n) };
      }

      /** What the delete review shows: each collection's entries, by slug. */
      async function reviewed(
        slugs: readonly string[]
      ): Promise<Array<{ collection: string; rowCount?: number }> | undefined> {
        const body = (await dispatchCollections(
          {} as ServiceContainer,
          "previewCollectionDelete",
          {
            collectionName: slugs[0],
            ...(slugs.length > 1 ? { together: slugs.slice(1).join(",") } : {}),
          },
          undefined
        )) as Response | Record<string, unknown>;
        const json = (
          body instanceof Response ? await body.json() : body
        ) as Record<string, unknown>;
        return ((json.data ?? json) as { entries?: unknown }).entries as
          | Array<{ collection: string; rowCount?: number }>
          | undefined;
      }

      /** The delete of `slugs` together, confirming `confirmedEntries` as the dialog sends it. */
      function remove(
        slugs: readonly string[],
        confirmedEntries?: string
      ): Promise<unknown> {
        return dispatchCollections(
          {} as ServiceContainer,
          "deleteCollection",
          {
            collectionName: slugs[0],
            ...(slugs.length > 1 ? { together: slugs.slice(1).join(",") } : {}),
            ...(confirmedEntries === undefined ? {} : { confirmedEntries }),
          },
          undefined
        ).then(
          () => "deleted",
          (error: unknown) => error
        );
      }

      it("shows each collection deleted together with its entry count in the review", async () => {
        const t = await boot();
        await write(t, POSTS, 2);
        await write(t, PAGES, 1);

        expect(await reviewed([POSTS, PAGES])).toEqual([
          expect.objectContaining({ collection: POSTS, rowCount: 2 }),
          expect.objectContaining({ collection: PAGES, rowCount: 1 }),
        ]);
      }, 60_000);

      it("refuses a delete whose confirmed count is malformed, with nothing removed", async () => {
        const t = await boot();
        await write(t, POSTS, 1);

        expect(await remove([POSTS], `${POSTS}:many`)).toMatchObject({
          code: "VALIDATION_ERROR",
        });
        expect(await stateOf(t, POSTS)).toEqual({
          registered: true,
          entries: 1,
        });
      }, 60_000);

      it("deletes as before when the delete sends no count", async () => {
        const t = await boot();
        await write(t, POSTS, 1);

        expect(await remove([POSTS])).toBe("deleted");
        expect(await stateOf(t, POSTS)).toEqual({
          registered: false,
          entries: "gone",
        });
      }, 60_000);

      /** A new entry of `slug`'s table, as the statement a write sends. */
      function insertEntry(slug: string, id: string): string {
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        const columns = [
          "id",
          "title",
          "slug",
          "created_at",
          "updated_at",
          "_revision",
        ];
        const values = [
          `'${id}'`,
          `'${id}'`,
          `'${id}'`,
          "'2026-11-26 00:00:00'",
          "'2026-11-26 00:00:00'",
          "1",
        ];
        return `INSERT INTO ${q(`dc_${slug}`)} (${columns.map(q).join(", ")}) VALUES (${values.join(", ")})`;
      }

      // An entry write under way when the delete begins: on another connection, holding its share of
      // the collection as an entry write holds it until it commits (on PostgreSQL the collection's
      // advisory share, on MySQL its registry row read for share), with its entry written and not yet
      // committed. The delete waits for it, then counts its entry: it neither counts past it nor
      // drops it with the table. MySQL's delete already waits there, at the row the write holds.
      it.skipIf(dialect === "sqlite")(
        "waits for an entry write holding its share of the collection, then counts its entry and refuses",
        async () => {
          const t = await boot();
          await write(t, POSTS, 1);
          let commit = (): void => undefined;
          const committing = new Promise<void>(resolve => {
            commit = resolve;
          });
          let began = (): void => undefined;
          const begun = new Promise<void>(resolve => {
            began = resolve;
          });
          const writing = t.adapter.withSession(async session => {
            await session.execute(
              dialect === "mysql" ? "START TRANSACTION" : "BEGIN"
            );
            await session.execute(
              dialect === "mysql"
                ? "SELECT `id` FROM `dynamic_collections` WHERE `slug` = ? FOR SHARE"
                : "SELECT pg_advisory_xact_lock_shared(hashtext($1), hashtext($2))",
              dialect === "mysql"
                ? [POSTS]
                : ["nextly:entity", `collection:${POSTS}`]
            );
            await session.execute(insertEntry(POSTS, "written-under-way"));
            began();
            await committing;
            await session.execute("COMMIT");
          });
          await begun;

          let settled = false;
          const deleting = remove([POSTS], `${POSTS}:1`).finally(() => {
            settled = true;
          });
          await new Promise(resolve => setTimeout(resolve, 1_000));
          expect(settled, "the delete waits for the write").toBe(false);
          commit();
          await writing;

          expect(await deleting).toMatchObject(refusedWith(POSTS, 2));
          expect(await stateOf(t, POSTS)).toEqual({
            registered: true,
            entries: 2,
          });
        },
        60_000
      );

      /**
       * Fails the delete's drop of `table` once, where the delete runs it in its own transaction:
       * on MySQL a drop commits as it runs, so the drops before it are kept.
       */
      function failDropOnce(t: TestNextly, table: string): void {
        let failed = false;
        const transaction = t.adapter.transaction.bind(t.adapter);
        vi.spyOn(t.adapter, "transaction").mockImplementation((work, options) =>
          transaction(
            tx =>
              work(
                new Proxy(tx, {
                  get(target, key) {
                    if (key === "execute") {
                      return async (
                        statement: string,
                        params?: Parameters<TransactionContext["execute"]>[1]
                      ) => {
                        if (
                          !failed &&
                          new RegExp(`DROP TABLE[^;]*\`${table}\``).test(
                            statement
                          )
                        ) {
                          failed = true;
                          throw new Error(`injected failure: ${statement}`);
                        }
                        return target.execute(statement, params);
                      };
                    }
                    const value: unknown = Reflect.get(target, key);
                    return typeof value === "function"
                      ? value.bind(target)
                      : value;
                  },
                })
              ),
            options
          )
        );
      }

      // A set deleted together on MySQL whose later table's drop failed: the first table is gone and
      // still registered. Sent again with the counts the review showed, the delete finishes: a table
      // that no longer stands holds no entries to count, and the one that stands is counted.
      it.runIf(dialect === "mysql")(
        "finishes a delete stopped part way, sent again with the counts its review showed",
        async () => {
          const t = await boot();
          withoutWriter(t);
          await write(t, POSTS, 1);
          await write(t, PAGES, 1);
          failDropOnce(t, `dc_${PAGES}`);
          expect(
            await remove([POSTS, PAGES], `${POSTS}:1,${PAGES}:1`)
          ).not.toBe("deleted");
          expect(await stateOf(t, POSTS)).toEqual({
            registered: true,
            entries: "gone",
          });

          expect(await remove([POSTS, PAGES], `${POSTS}:1,${PAGES}:1`)).toBe(
            "deleted"
          );
          expect(await stateOf(t, POSTS)).toEqual({
            registered: false,
            entries: "gone",
          });
          expect(await stateOf(t, PAGES)).toEqual({
            registered: false,
            entries: "gone",
          });
        },
        60_000
      );

      describe.each(ROADS)("on the %s road", road => {
        it("deletes the collection when its entry count is still the one the review showed", async () => {
          const t = await boot();
          if (road === "no writer") withoutWriter(t);
          await write(t, POSTS, 2);
          expect(await reviewed([POSTS])).toEqual([
            expect.objectContaining({ collection: POSTS, rowCount: 2 }),
          ]);

          expect(await remove([POSTS], `${POSTS}:2`)).toBe("deleted");
          expect(await stateOf(t, POSTS)).toEqual({
            registered: false,
            entries: "gone",
          });
        }, 60_000);

        it("deletes nothing and names the new count when an entry was written after the review", async () => {
          const t = await boot();
          if (road === "no writer") withoutWriter(t);
          await write(t, POSTS, 2);
          expect(await reviewed([POSTS])).toEqual([
            expect.objectContaining({ collection: POSTS, rowCount: 2 }),
          ]);
          // An entry written after the review counted two.
          await write(t, POSTS, 1);

          expect(await remove([POSTS], `${POSTS}:2`)).toMatchObject(
            refusedWith(POSTS, 3)
          );
          expect(await stateOf(t, POSTS)).toEqual({
            registered: true,
            entries: 3,
          });
        }, 60_000);

        it("refuses a set deleted together whole when one member's count moved", async () => {
          const t = await boot();
          if (road === "no writer") withoutWriter(t);
          await write(t, POSTS, 1);
          await write(t, PAGES, 1);
          // The second member, not the one the delete names first, gains an entry.
          await write(t, PAGES, 1);

          expect(
            await remove([POSTS, PAGES], `${POSTS}:1,${PAGES}:1`)
          ).toMatchObject(refusedWith(PAGES, 2));
          expect(await stateOf(t, POSTS)).toEqual({
            registered: true,
            entries: 1,
          });
          expect(await stateOf(t, PAGES)).toEqual({
            registered: true,
            entries: 2,
          });
        }, 60_000);
      });
    }
  );
}
