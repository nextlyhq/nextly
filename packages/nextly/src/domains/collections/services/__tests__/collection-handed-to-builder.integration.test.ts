/**
 * A code-first collection handed to the Schema Builder, on the registry itself, on every dialect
 * this run can reach.
 *
 * - The hand-over writes the row's source and lock in one update: the collection is the Builder's
 *   (`source: "ui"`), unlocked, and no longer an orphan once its code entry is gone.
 * - Only the app's own row moves: a plugin's is refused, as any other change to it is.
 * - A sync that still finds the collection declared in code leaves the Builder's row as it is and
 *   says so once.
 * - So does `nextly migrate`'s registry write, which brings each row to the configuration a
 *   migration's snapshot recorded: the Builder's row keeps a field the Builder added. A plugin's
 *   declaration under the same address is written as before.
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
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { DEMOTED_FROM_CODE } from "../../../schema/pipeline/demoted-from-code";
import { CollectionRegistryService } from "../collection-registry-service";
import { configurationRegistryRows } from "../../../schema/migrate/first-run";
import { writeRegistryFromSource } from "../../../schema/migrate/registry-writer";
import { calculateSchemaHash } from "../../../schema/services/schema-hash";
import { toCodeFirstCollectionConfig } from "../collection-sync-service";

describe.each(getConfiguredTestDialects())(
  "a code-first collection handed to the Schema Builder (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let registry: CollectionRegistryService;
    const warnings: string[] = [];

    // Typed as a collection's fields, not inferred from the default, so a
    // call may give fields of other names.
    const coded = (
      slug: string,
      fields: Parameters<typeof defineCollection>[0]["fields"] = [
        text({ name: "title" }),
      ]
    ) =>
      toCodeFirstCollectionConfig(
        defineCollection({ slug, fields }),
        "code"
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

    it("leaves an unchanged collection's schema version and migration state as they were", async () => {
      const slug = "chb_unchanged";
      const config = coded(slug);
      await registry.syncCodeFirstCollections([config]);
      const before = await registry.getCollectionBySlug(slug);
      await registry.updateCollection(
        slug,
        {
          fields: config.fields as never,
          schemaHash: calculateSchemaHash(config.fields as never),
          source: "ui",
          locked: false,
        },
        { handOver: "builder" }
      );
      const after = await registry.getCollectionBySlug(slug);
      expect({
        schemaVersion: after?.schemaVersion,
        migrationStatus: after?.migrationStatus,
      }).toEqual({
        schemaVersion: before?.schemaVersion,
        migrationStatus: before?.migrationStatus,
      });
    });

    it("unlocks a Builder row an earlier sync locked again", async () => {
      // What a demote followed by a start left before the sync learned to leave such a row:
      // the Builder's by its source, and locked.
      const slug = "chb_relocked";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );
      await registry.updateCollection(
        slug,
        { locked: true },
        { source: "code" }
      );
      expect(await owner(slug)).toEqual({ source: "ui", locked: true });

      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );
      expect(await owner(slug)).toEqual({ source: "ui", locked: false });
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
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
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

    it("records a plugin's collection as the plugin's where an earlier sync recorded it as the app's own", async () => {
      // What an earlier reload left: the plugin's collection created as `code`. The next sync
      // declares the same fields, so nothing but the owner differs, and the owner is written.
      const slug = "chb_mislabelled";
      await registry.syncCodeFirstCollections([coded(slug)]);
      expect(await owner(slug)).toEqual({ source: "code", locked: true });
      const declared = { ...coded(slug), source: "plugin:@test/chb" as const };

      expect(
        (await registry.planCodeFirstCollections([declared])).updated
      ).toContain(slug);
      const synced = await registry.syncCodeFirstCollections([declared]);

      expect(synced.updated).toContain(slug);
      expect(await owner(slug)).toEqual({
        source: "plugin:@test/chb",
        locked: true,
      });
      // Written once: the next sync finds nothing to change.
      expect(
        (await registry.syncCodeFirstCollections([declared])).unchanged
      ).toContain(slug);
    });

    it("gives a handed-over row to a plugin declaring a collection under its address", async () => {
      // A plugin registers its collection at every start, whoever holds the address: it takes the
      // row, locked, and the demote's mark goes, so the row is not taken for the Builder's again.
      const slug = "chb_claimed";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );

      await registry.syncCodeFirstCollections([
        { ...coded(slug), source: "plugin:@test/chb" },
      ]);

      const row = await registry.getCollectionBySlug(slug);
      expect({
        source: row?.source,
        locked: Boolean(row?.locked),
        configPath: row?.configPath ?? null,
      }).toEqual({
        source: "plugin:@test/chb",
        locked: true,
        configPath: null,
      });
    });

    it("leaves a row made in the Schema Builder with its owner, whoever declares its address", async () => {
      // No demote marked it, so neither the app's entry nor a plugin's takes it.
      const slug = "chb_builder_keeps_owner";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false },
        { handOver: "builder" }
      );
      // The hand-over marks the row; a row the Builder made has no mark. The registry's update
      // takes no "no config path", so the mark is cleared on the row itself.
      await handle.adapter.update(
        "dynamic_collections",
        { config_path: null },
        { and: [{ column: "slug", op: "=", value: slug }] }
      );
      clearRegistryRowCache();
      expect(
        (await registry.getCollectionBySlug(slug))?.configPath ?? null
      ).toBe(null);

      await registry.syncCodeFirstCollections([
        { ...coded(slug), source: "plugin:@test/chb" },
      ]);

      expect(await owner(slug)).toEqual({ source: "ui", locked: false });
    });

    it("a sync that still finds the collection in code leaves the Builder's row and says so once", async () => {
      const slug = "chb_still_coded";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );
      warnings.length = 0;

      // The code entry is still there, and has changed since.
      const changed = coded(slug, [
        text({ name: "title" }),
        text({ name: "summary" }),
      ]);
      // The plan a dry run prints is the sync's own answer.
      const planned = await registry.planCodeFirstCollections([changed]);
      expect(planned.updated).not.toContain(slug);
      expect(planned.unchanged).toContain(slug);
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

    /**
     * `nextly migrate`'s registry write of `declared`, as a migration's snapshot recorded it, with
     * `plugins` the collections a plugin contributes. What it logged as warnings, and how many rows
     * it wrote.
     */
    async function migrateRegistryWrite(
      declared: ReturnType<typeof defineCollection>,
      plugins: ReadonlyMap<string, `plugin:${string}`> = new Map()
    ) {
      const said: string[] = [];
      const logger = {
        info: () => {},
        debug: () => {},
        error: () => {},
        warn: (message: string) => {
          said.push(message);
        },
      };
      const result = await writeRegistryFromSource(
        {
          kind: "snapshot",
          file: "0002_after_the_demote.sql",
          entities: configurationRegistryRows({ collections: [declared] }),
        },
        {
          adapter: handle.adapter as never,
          logger: logger as never,
          entitySources: {
            collections: plugins,
            singles: new Map(),
            fieldGroups: new Map(),
            legacyCollections: new Set(),
          },
        }
      );
      return { said, written: result.written.collection };
    }

    /** `slug` synced from code, handed to the Builder, and given a field there. */
    async function handedOverWithBuilderField(slug: string) {
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );
      const held = await registry.getCollectionBySlug(slug);
      const fields = [
        ...(held?.fields ?? []),
        { name: "subtitle", type: "text" },
      ] as never;
      await registry.updateCollection(slug, {
        fields,
        schemaHash: calculateSchemaHash(fields),
      });
    }

    const fieldNames = async (slug: string) =>
      ((await registry.getCollectionBySlug(slug))?.fields ?? []).map(
        field => field.name
      );

    it("nextly migrate's registry write leaves the Builder's row of a collection still declared in code, and says so once", async () => {
      const slug = "chb_migrate_still_coded";
      await handedOverWithBuilderField(slug);
      const declared = defineCollection({
        slug,
        fields: [text({ name: "title" })],
      });

      const first = await migrateRegistryWrite(declared);
      const second = await migrateRegistryWrite(declared);

      expect(first.written).toBe(0);
      expect(second.written).toBe(0);
      expect(await fieldNames(slug)).toContain("subtitle");
      expect(await owner(slug)).toEqual({ source: "ui", locked: false });
      expect(first.said.filter(message => message.includes(slug))).toHaveLength(
        1
      );
      expect(first.said.join("\n")).toContain("nextly.config");
    });

    it("nextly migrate's registry write of a plugin's declaration under a handed-over address is as before", async () => {
      const slug = "chb_migrate_plugin";
      await handedOverWithBuilderField(slug);
      const declared = defineCollection({
        slug,
        fields: [text({ name: "title" })],
      });

      const { said, written } = await migrateRegistryWrite(
        declared,
        new Map([[slug, "plugin:@test/chb"]])
      );

      expect(written).toBe(1);
      expect(await fieldNames(slug)).not.toContain("subtitle");
      expect(said.filter(message => message.includes(slug))).toEqual([]);
    });

    it("a collection made in the Builder, never demoted, is still synced from a code entry under its address", async () => {
      // Not a hand-over: nothing moved this row from code, so the configuration's entry is
      // applied to it as it always was.
      const slug = "chb_made_in_builder";
      await registry.registerCollection({
        slug,
        labels: { singular: "Made", plural: "Made" },
        tableName: `dc_${slug}`,
        fields: [],
        source: "ui",
        schemaHash: "made-in-builder",
      } as never);
      warnings.length = 0;

      const config = coded(slug);
      expect(
        (await registry.planCodeFirstCollections([config])).updated
      ).toContain(slug);
      const synced = await registry.syncCodeFirstCollections([config]);
      expect(synced.errors).toEqual([]);
      expect(synced.updated).toContain(slug);
      expect(warnings.filter(message => message.includes(slug))).toEqual([]);
    });

    it("a plugin's entry under a Builder collection's address is handled as before, and not blamed on the configuration", async () => {
      const slug = "chb_plugin_over_builder";
      await registry.syncCodeFirstCollections([coded(slug)]);
      await registry.updateCollection(
        slug,
        { source: "ui", locked: false, configPath: DEMOTED_FROM_CODE },
        { handOver: "builder" }
      );
      warnings.length = 0;
      await registry.syncCodeFirstCollections([
        {
          ...coded(slug, [text({ name: "title" }), text({ name: "extra" })]),
          source: "plugin:@test/chb",
        },
      ]);
      expect(warnings.filter(message => message.includes(slug))).toEqual([]);
    });
  }
);
