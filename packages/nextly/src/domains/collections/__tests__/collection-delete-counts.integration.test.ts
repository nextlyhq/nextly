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
 * What separates a counted delete from plausible wrong ones: a delete that reads no count removes an
 * entry written after the review uncounted; one that counts outside the held transaction lets an
 * entry in between; one that counts only the collection named first passes a set whose other member
 * moved; one that drops a malformed count deletes uncompared.
 */
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
