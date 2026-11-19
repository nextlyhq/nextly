/**
 * A code-first collection handed to the Schema Builder, on the registry itself, on every dialect
 * this run can reach.
 *
 * - The hand-over writes the row's source and lock in one update: the collection is the Builder's
 *   (`source: "ui"`), unlocked, and no longer an orphan once its code entry is gone.
 * - Only the app's own row moves: a plugin's is refused, as any other change to it is.
 * - A sync that still finds the collection declared in code leaves the Builder's row as it is and
 *   says so once.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection } from "../../../../collections/config/define-collection";
import { text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { CollectionRegistryService } from "../collection-registry-service";
import { toCodeFirstCollectionConfig } from "../collection-sync-service";

describe.each(getConfiguredTestDialects())(
  "a code-first collection handed to the Schema Builder (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let registry: CollectionRegistryService;
    const warnings: string[] = [];

    const coded = (slug: string, fields = [text({ name: "title" })]) =>
      toCodeFirstCollectionConfig(
        defineCollection({ slug, fields })
      ) as Parameters<
        CollectionRegistryService["syncCodeFirstCollections"]
      >[0][number];

    beforeAll(async () => {
      handle = await createTestNextly({ dialect });
      registry = new CollectionRegistryService(
        handle.adapter as never,
        {
          info: () => {},
          debug: () => {},
          error: () => {},
          warn: (message: string) => {
            warnings.push(message);
          },
        } as never
      );
    }, 180_000);

    afterAll(async () => {
      await handle?.destroy();
    }, 60_000);

    /** The parts of a row a hand-over decides. */
    async function owner(slug: string) {
      const row = await registry.getCollectionBySlug(slug);
      return { source: row?.source, locked: Boolean(row?.locked) };
    }

    it("moves a synced collection's row to the Builder, unlocked, in one write", async () => {
      const slug = "chb_posts";
      await registry.syncCodeFirstCollections([coded(slug)]);
      expect(await owner(slug)).toEqual({ source: "code", locked: true });
      // Any other caller is still refused a locked row.
      await expect(
        registry.updateCollection(slug, { source: "ui", locked: false })
      ).rejects.toMatchObject({
        logContext: { reason: "collection-locked" },
      });

      await registry.updateCollection(
        slug,
        { description: "Handed over", source: "ui", locked: false },
        { handOver: "builder" }
      );
      expect(await owner(slug)).toEqual({ source: "ui", locked: false });
      // Its code entry removed, it is the Builder's collection and not an orphan to prune.
      const orphans = await registry.findOrphanedCollections([]);
      expect(orphans.map(row => row.slug)).not.toContain(slug);
      // The Builder's own edit goes through.
      await registry.updateCollection(slug, { description: "Edited" });
      expect((await registry.getCollectionBySlug(slug))?.description).toBe(
        "Edited"
      );
    });

    it("answers the hand-over's question without writing", async () => {
      const slug = "chb_asked";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await expect(
        registry.assertUpdatable(slug, { source: "ui", locked: false })
      ).rejects.toMatchObject({
        logContext: { reason: "collection-locked" },
      });
      await registry.assertUpdatable(
        slug,
        { source: "ui", locked: false },
        { handOver: "builder" }
      );
      expect(await owner(slug)).toEqual({ source: "code", locked: true });
    });

    it("refuses to hand over a plugin's collection", async () => {
      const slug = "chb_plugin";
      await registry.syncCodeFirstCollections([
        { ...coded(slug), source: "plugin:@test/chb" },
      ]);
      await expect(
        registry.updateCollection(
          slug,
          { source: "ui", locked: false },
          { handOver: "builder" }
        )
      ).rejects.toMatchObject({
        logContext: { reason: "collection-locked" },
      });
      expect(await owner(slug)).toEqual({
        source: "plugin:@test/chb",
        locked: true,
      });
    });

    it("a sync that still finds the collection in code leaves the Builder's row and says so once", async () => {
      const slug = "chb_still_coded";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false },
        { handOver: "builder" }
      );
      warnings.length = 0;

      // The code entry is still there, and has changed since.
      const changed = coded(slug, [
        text({ name: "title" }),
        text({ name: "summary" }),
      ]);
      const first = await registry.syncCodeFirstCollections([changed]);
      const second = await registry.syncCodeFirstCollections([changed]);
      expect(first.errors).toEqual([]);
      expect(first.updated).not.toContain(slug);
      expect(second.updated).not.toContain(slug);

      const row = await registry.getCollectionBySlug(slug);
      expect({ source: row?.source, locked: Boolean(row?.locked) }).toEqual({
        source: "ui",
        locked: false,
      });
      expect(row?.fields.map(field => field.name)).not.toContain("summary");
      const said = warnings.filter(message => message.includes(slug));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("nextly.config");
    });
  }
);
