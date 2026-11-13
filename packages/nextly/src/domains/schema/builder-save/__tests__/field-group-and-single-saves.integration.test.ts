/**
 * A Schema Builder save of a field group or a Single writes its migration, as
 * a collection's does.
 *
 * `nextly migrate` judges each pending file against the snapshots on either
 * side of it, and every table a snapshot does not record counts as drift. A
 * field group or a Single the Builder created by pushing its table, with no
 * file, left that table on no record: the next migration, a collection's
 * included, was then refused with "table 'comp_<slug>' present in DB".
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";
import { FieldGroupMetadataService } from "../../../field-groups/services/field-group-metadata-service";
import { SingleMetadataService } from "../../../singles/services/single-metadata-service";
import { resolveBuilderVersions } from "../../../versions/builder-versions";

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await instance?.destroy();
  instance = undefined;
});

const HISTORY = "./database/history";

/** The tables the newest snapshot records, by name. */
function latestSnapshotTables(t: TestNextly): string[] {
  const meta = join(t.basePath, "database", "history", "meta");
  // No snapshot written yet: nothing is on record.
  if (!existsSync(meta)) return [];
  const newest = readdirSync(meta)
    .filter(f => f.endsWith(".snapshot.json"))
    .sort()
    .at(-1);
  if (newest === undefined) return [];
  const parsed = JSON.parse(readFileSync(join(meta, newest), "utf-8")) as {
    snapshot?: { tables?: { name: string }[] };
    tables?: { name: string }[];
  };
  return (parsed.snapshot?.tables ?? parsed.tables ?? []).map(t => t.name);
}

/** The migration files written, by name. */
function migrationFiles(t: TestNextly): string[] {
  return readdirSync(join(t.basePath, "database", "history")).filter(f =>
    f.endsWith(".sql")
  );
}

describe.each(getConfiguredTestDialects())(
  "a Builder save of a field group or a Single (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: "./schema/builder.json" },
      });
      instance = t;
      // As the Builder runs: each save is applied, and recorded, here.
      vi.stubEnv("NODE_ENV", "development");
      return t;
    }

    it("writes a field group's migration, recording its table", async () => {
      const t = await boot();

      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      expect(migrationFiles(t).some(f => /_meta_create\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).toContain("comp_meta");
    });

    it("writes a Single's migration, recording its table", async () => {
      const t = await boot();

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [{ name: "heading", type: "text" }],
        }
      );

      expect(migrationFiles(t).some(f => /_notice_create\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).toContain("single_notice");
    });

    it("lets a collection's save follow a field group's, with both tables on record", async () => {
      const t = await boot();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      // The collection's file runs through the drift check, which once found
      // the field group's table on no record and refused it.
      await t.getService("collectionService").createCollection(
        {
          name: "articles",
          label: "Article",
          fields: [
            { name: "body", type: "text" },
            { name: "meta", type: "component", component: "meta" },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );

      expect(latestSnapshotTables(t)).toEqual(
        expect.arrayContaining(["comp_meta", "dc_articles"])
      );
    });

    /** The columns the newest snapshot records for `table`. */
    function latestColumns(t: TestNextly, table: string): string[] {
      const meta = join(t.basePath, "database", "history", "meta");
      const newest = readdirSync(meta)
        .filter(f => f.endsWith(".snapshot.json"))
        .sort()
        .at(-1)!;
      const parsed = JSON.parse(readFileSync(join(meta, newest), "utf-8")) as {
        snapshot?: { tables?: { name: string; columns: { name: string }[] }[] };
      };
      return (
        parsed.snapshot?.tables?.find(entry => entry.name === table)?.columns ??
        []
      ).map(column => column.name);
    }

    it("writes a field group's change and its delete, each on record", async () => {
      const t = await boot();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );

      // The version the Builder read, as its dialog sends it back.
      const component = await t
        .getService("fieldGroupRegistryService")
        .getComponent("meta");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "meta" },
        {
          fields: [
            { name: "note", type: "text" },
            { name: "byline", type: "text" },
          ],
          confirmed: true,
          schemaVersion: component.schemaVersion,
        }
      );
      expect(migrationFiles(t).some(f => /_meta_update\.sql$/.test(f))).toBe(
        true
      );
      expect(latestColumns(t, "comp_meta")).toContain("byline");

      await dispatchComponents("deleteComponent", { slug: "meta" }, undefined);
      expect(migrationFiles(t).some(f => /_meta_delete\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).not.toContain("comp_meta");
    });

    it("writes a Single's change and its delete, each on record", async () => {
      const t = await boot();
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [{ name: "heading", type: "text" }],
        }
      );

      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "body", type: "text" },
          ],
          confirmed: true,
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("notice")
          ).schemaVersion,
        }
      );
      expect(migrationFiles(t).some(f => /_notice_update\.sql$/.test(f))).toBe(
        true
      );
      expect(latestColumns(t, "single_notice")).toContain("body");

      await dispatchSingles("deleteSingle", { slug: "notice" }, undefined);
      expect(migrationFiles(t).some(f => /_notice_delete\.sql$/.test(f))).toBe(
        true
      );
      expect(latestSnapshotTables(t)).not.toContain("single_notice");
    });

    it("records a field group made before its saves wrote migrations, once it is saved", async () => {
      const t = await boot();
      // Made as the Builder made it before: its table pushed, no migration.
      const unrecorded = new FieldGroupMetadataService(
        t.getService("fieldGroupRegistryService"),
        console as never,
        t.adapter as never
      );
      await unrecorded.createFieldGroup({
        slug: "legacy",
        label: "Legacy",
        tableName: "comp_legacy",
        fields: [{ name: "note", type: "text" }],
        source: "ui",
        locked: false,
        schemaHash: "unrecorded",
        schemaVersion: 1,
      } as never);
      expect(latestSnapshotTables(t)).not.toContain("comp_legacy");

      // Saved once in the Builder: the save records the table as it stands.
      const component = await t
        .getService("fieldGroupRegistryService")
        .getComponent("legacy");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "legacy" },
        {
          fields: [
            { name: "note", type: "text" },
            { name: "byline", type: "text" },
          ],
          confirmed: true,
          schemaVersion: component.schemaVersion,
        }
      );

      expect(latestSnapshotTables(t)).toContain("comp_legacy");
      expect(latestColumns(t, "comp_legacy")).toContain("byline");
    });

    /** The Builder's definition file, as the saves wrote it. */
    function definition(t: TestNextly): {
      singles: Record<string, unknown>[];
      components: Record<string, unknown>[];
    } {
      return JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as {
        singles: Record<string, unknown>[];
        components: Record<string, unknown>[];
      };
    }

    /** A dispatched answer's body, whatever envelope wraps it. */
    async function bodyOf(answer: unknown): Promise<Record<string, unknown>> {
      const parsed = (await (answer as Response).json()) as Record<
        string,
        unknown
      >;
      return (parsed.data as Record<string, unknown> | undefined) ?? parsed;
    }

    it("shows a conversion an old field group's table needs, and writes it once confirmed", async () => {
      const t = await boot();
      const registry = t.getService("fieldGroupRegistryService");
      await new FieldGroupMetadataService(
        registry,
        console as never,
        t.adapter as never
      ).createFieldGroup({
        slug: "older",
        label: "Older",
        tableName: "comp_older",
        fields: [
          { name: "note", type: "text" },
          { name: "extra", type: "text" },
        ],
        source: "ui",
        locked: false,
        schemaHash: "unrecorded",
        schemaVersion: 1,
      } as never);
      // The registry no longer names `extra`, and its column stands: the table
      // differs from what the field group declares.
      await registry.updateComponent("older", {
        fields: [{ name: "note", type: "text" }],
      } as never);
      const change = {
        fields: [
          { name: "note", type: "text" },
          { name: "byline", type: "text" },
        ],
        confirmed: true,
        schemaVersion: (await registry.getComponent("older")).schemaVersion,
      };

      const preview = await bodyOf(
        await dispatchComponents(
          "previewComponentSchemaChanges",
          { slug: "older" },
          { fields: change.fields }
        )
      );
      expect(JSON.stringify(preview.notices)).toContain("extra");
      await expect(
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "older" },
          change
        )
      ).rejects.toMatchObject({ code: "NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED" });

      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "older" },
        { ...change, acknowledgedConversions: ["extra"] }
      );
      expect(latestSnapshotTables(t)).toContain("comp_older");
    });

    it("writes a Single's history, revalidation and webhook settings as the definition file spells them", async () => {
      const t = await boot();

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [{ name: "heading", type: "text" }],
          versions: true,
          versionsMaxPerDoc: 10,
          revalidate: false,
          webhooks: false,
        }
      );

      expect(
        definition(t).singles.find(s => s.slug === "notice")
      ).toMatchObject({
        versions: true,
        versionsMaxPerDoc: 10,
        revalidate: false,
        webhooks: false,
      });
    });

    it("keeps an old Single's stored settings when it is first saved", async () => {
      const t = await boot();
      await new SingleMetadataService(
        t.getService("singleRegistryService"),
        console as never,
        t.adapter as never
      ).createSingle({
        slug: "about",
        label: "About",
        tableName: "single_about",
        description: "Who we are",
        fields: [{ name: "heading", type: "text" }],
        status: true,
        versions: resolveBuilderVersions(true, 5),
        source: "ui",
        locked: false,
        schemaHash: "unrecorded",
        schemaVersion: 1,
      } as never);

      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "about" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "body", type: "text" },
          ],
          confirmed: true,
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("about")
          ).schemaVersion,
        }
      );

      expect(definition(t).singles.find(s => s.slug === "about")).toMatchObject(
        {
          description: "Who we are",
          status: true,
          versions: true,
          versionsMaxPerDoc: 5,
        }
      );
    });

    it("writes a Single's many-to-many junction table into its migration", async () => {
      const t = await boot();
      await t.getService("collectionService").createCollection(
        {
          name: "articles",
          label: "Article",
          fields: [{ name: "body", type: "text" }],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "picks",
          label: "Picks",
          fields: [
            {
              name: "featured",
              type: "relationship",
              relationTo: "articles",
              hasMany: true,
            },
          ],
        }
      );

      const junction = (
        await (
          t.adapter as unknown as { listTables(): Promise<string[]> }
        ).listTables()
      ).find(
        name => name.startsWith("single_picks") && name.includes("featured")
      );
      expect(junction).toBeDefined();
      const created = migrationFiles(t).find(f =>
        /_picks_create\.sql$/.test(f)
      )!;
      expect(
        readFileSync(join(t.basePath, "database", "history", created), "utf-8")
      ).toContain(junction);
    });
  }
);
