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

import {
  DELETE as deleteFieldGroupRoute,
  PATCH as patchFieldGroupRoute,
} from "../../../../api/field-groups-detail";
import { resetSessionStandingForTests } from "../../../../auth/session/session-standing";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { superAdminSession } from "../../../collections/__tests__/helpers/collection-dependents-fixtures";
import type { CollectionService } from "../../../collections/services/collection-service";
import { FieldGroupMetadataService } from "../../../field-groups/services/field-group-metadata-service";
import { SingleMetadataService } from "../../../singles/services/single-metadata-service";
import { resolveBuilderVersions } from "../../../versions/builder-versions";
import { SchemaEventsRepository } from "../../events/schema-events-repository";

// A companion reconcile made to fail, by the one test that needs it to: every
// other test runs the real one.
const companionFails = vi.hoisted(() => ({
  single: false,
  component: false,
  // A delete's translations teardown, the step after its first one.
  teardown: false,
}));
vi.mock(
  "../../../i18n/migration/teardown-entity-i18n",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../i18n/migration/teardown-entity-i18n")
      >();
    return {
      ...real,
      teardownEntityI18n: (
        ...args: Parameters<typeof real.teardownEntityI18n>
      ) => {
        if (companionFails.teardown) {
          return Promise.reject(new Error("the teardown stopped part way"));
        }
        return real.teardownEntityI18n(...args);
      },
    };
  }
);
vi.mock(
  "../../../singles/services/reconcile-single-companion",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../singles/services/reconcile-single-companion")
      >();
    return {
      ...real,
      reconcileSingleCompanion: (
        ...args: Parameters<typeof real.reconcileSingleCompanion>
      ) => {
        if (companionFails.single) {
          return Promise.reject(new Error("the companion would not follow"));
        }
        return real.reconcileSingleCompanion(...args);
      },
    };
  }
);
vi.mock(
  "../../../field-groups/services/field-group-table-provisioning",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../field-groups/services/field-group-table-provisioning")
      >();
    return {
      ...real,
      reconcileComponentCompanion: (
        ...args: Parameters<typeof real.reconcileComponentCompanion>
      ) => {
        if (companionFails.component) {
          return Promise.reject(new Error("the companion would not follow"));
        }
        return real.reconcileComponentCompanion(...args);
      },
    };
  }
);

let instance: TestNextly | undefined;
afterEach(async () => {
  companionFails.single = false;
  companionFails.component = false;
  companionFails.teardown = false;
  vi.unstubAllEnvs();
  resetSessionStandingForTests();
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

/** The three entry points that change or delete a field group. */
const WAYS = ["builder", "route", "direct"] as const;
type Way = (typeof WAYS)[number];

/** The field group as the definition file lists it, if it does. */
function definedFieldGroup(
  t: TestNextly,
  slug: string
): { labels?: { singular?: string } } | undefined {
  const file = join(t.basePath, "schema", "builder.json");
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
    components?: { slug: string; labels?: { singular?: string } }[];
  };
  return parsed.components?.find(entry => entry.slug === slug);
}

/** Relabel the field group `slug` the way `way` does, as its caller would. */
async function relabelVia(
  way: Way,
  t: TestNextly,
  slug: string,
  label: string
): Promise<void> {
  if (way === "builder") {
    await dispatchComponents("updateComponent", { slug }, { label });
    return;
  }
  if (way === "direct") {
    await t.nextly.fieldGroups.update({ slug, data: { label } });
    return;
  }
  const response = await patchFieldGroupRoute(
    new Request(`http://localhost/api/field-groups/${slug}`, {
      method: "PATCH",
      headers: {
        ...(await superAdminSession(t)),
        "content-type": "application/json",
      },
      body: JSON.stringify({ label }),
    }),
    { params: Promise.resolve({ slug }) }
  );
  expect(response.status).toBe(200);
}

/** Delete the field group `slug` the way `way` does, as its caller would. */
async function deleteVia(way: Way, t: TestNextly, slug: string): Promise<void> {
  if (way === "builder") {
    await dispatchComponents("deleteComponent", { slug }, undefined);
    return;
  }
  if (way === "direct") {
    await t.nextly.fieldGroups.delete({ slug });
    return;
  }
  const response = await deleteFieldGroupRoute(
    new Request(`http://localhost/api/field-groups/${slug}`, {
      method: "DELETE",
      headers: await superAdminSession(t),
    }),
    { params: Promise.resolve({ slug }) }
  );
  expect(response.status).toBe(204);
}

/** The migration files recorded applied, by name. */
async function appliedFiles(t: TestNextly): Promise<string[]> {
  const adapter = t.adapter as unknown as {
    getDrizzle(): unknown;
    getCapabilities(): { dialect: "postgresql" | "mysql" | "sqlite" };
  };
  const repo = new SchemaEventsRepository(
    adapter.getDrizzle() as never,
    adapter.getCapabilities().dialect
  );
  return (await repo.listFileApplies())
    .filter(row => row.status === "applied")
    .map(row => String(row.filename));
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
    async function boot(
      options: { translated?: boolean; development?: boolean } = {}
    ): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        db: { migrationsDir: HISTORY, uiSchemaFile: "./schema/builder.json" },
        ...(options.translated
          ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
          : {}),
      });
      instance = t;
      // As the Builder runs: each save is applied, and recorded, here.
      if (options.development !== false) vi.stubEnv("NODE_ENV", "development");
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

    it("outside development writes a field group's and a Single's create, records them pending, and builds no table", async () => {
      const t = await boot({ development: false });

      const fieldGroup = (await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      )) as Response;
      const single = (await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          fields: [{ name: "heading", type: "text" }],
        }
      )) as Response;

      // Each create's migration is written, for the deploy's `nextly migrate` to run...
      const written = migrationFiles(t);
      expect(written.some(f => /_meta_create\.sql$/.test(f))).toBe(true);
      expect(written.some(f => /_notice_create\.sql$/.test(f))).toBe(true);
      // ...and nothing of it has run: no table, no file recorded applied, and each entity's row
      // says so, as does the answer the Builder shows.
      expect(await t.adapter.tableExists("comp_meta")).toBe(false);
      expect(await t.adapter.tableExists("single_notice")).toBe(false);
      expect(await appliedFiles(t)).toEqual([]);
      expect(
        (
          await t
            .getService("fieldGroupRegistryService")
            .getComponentBySlug("meta")
        )?.migrationStatus
      ).toBe("pending");
      expect(
        (await t.getService("singleRegistryService").getSingleBySlug("notice"))
          ?.migrationStatus
      ).toBe("pending");
      expect(((await fieldGroup.json()) as { message: string }).message).toBe(
        'Component "meta" created. Run migrations to apply the table.'
      );
      expect(((await single.json()) as { message: string }).message).toBe(
        'Single "notice" created. Run migrations to apply the table.'
      );
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

    it.each(WAYS)(
      "writes a field group's edit made through the %s, on record",
      async way => {
        const t = await boot();
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "card",
            label: "Card",
            fields: [{ name: "note", type: "text" }],
          }
        );

        await relabelVia(way, t, "card", "Edited");

        expect(migrationFiles(t).some(f => /_card_update\.sql$/.test(f))).toBe(
          true
        );
        expect(definedFieldGroup(t, "card")?.labels?.singular).toBe("Edited");
        expect(latestSnapshotTables(t)).toContain("comp_card");
      }
    );

    it.each(WAYS)(
      "writes a field group's delete made through the %s, on record",
      async way => {
        const t = await boot();
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug: "card",
            label: "Card",
            fields: [{ name: "note", type: "text" }],
          }
        );

        await deleteVia(way, t, "card");

        expect(migrationFiles(t).some(f => /_card_delete\.sql$/.test(f))).toBe(
          true
        );
        expect(latestSnapshotTables(t)).not.toContain("comp_card");
        expect(definedFieldGroup(t, "card")).toBeUndefined();
      }
    );

    it("writes a Single's schema edit made through its PATCH, on record", async () => {
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
        "updateSingleSchema",
        { slug: "notice" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "body", type: "text" },
          ],
        }
      );

      expect(migrationFiles(t).some(f => /_notice_update\.sql$/.test(f))).toBe(
        true
      );
      expect(latestColumns(t, "single_notice")).toContain("body");
    });

    it("seeds a Single's permissions when its create's migration wrote its row", async () => {
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

      const rows = await t.adapter.executeQuery<{ slug: string }>(
        `SELECT slug FROM permissions WHERE resource = 'notice'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("keeps a Single update's files, recorded nowhere, when its companion fails to follow", async () => {
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

      companionFails.single = true;
      const result = await bodyOf(
        await dispatchSingles(
          "updateSingleSchema",
          { slug: "notice" },
          {
            fields: [
              { name: "heading", type: "text" },
              { name: "body", type: "text" },
            ],
          }
        )
      );

      expect(JSON.stringify(result)).toContain("failed");
      const update = migrationFiles(t).find(f =>
        /_notice_update\.sql$/.test(f)
      );
      expect(update).toBeDefined();
      expect(await appliedFiles(t)).not.toContain(update);
    });

    it("keeps a field group change's files, recorded nowhere, when its companion fails after the push", async () => {
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
      const component = await t
        .getService("fieldGroupRegistryService")
        .getComponent("meta");

      companionFails.component = true;
      await expect(
        dispatchComponents(
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
        )
      ).rejects.toBeDefined();

      // The push changed the table: its file stays, for `nextly migrate` to
      // name, and is recorded applied nowhere.
      const update = migrationFiles(t).find(f => /_meta_update\.sql$/.test(f));
      expect(update).toBeDefined();
      expect(await appliedFiles(t)).not.toContain(update);
    });

    /** A translated Single whose heading leaves translation as Required. */
    async function leavingAsRequired(t: TestNextly) {
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "notice",
          label: "Notice",
          localized: true,
          fields: [{ name: "heading", type: "text" }],
        }
      );
      // A refused setting is answered as a refusal, the fields saved without it.
      const refusal = await dispatchSingles(
        "updateSingleSchema",
        { slug: "notice" },
        {
          fields: [
            {
              name: "heading",
              type: "text",
              localized: false,
              required: true,
            },
          ],
        }
      ).then(
        () => undefined,
        (error: unknown) => (error as { publicMessage?: string }).publicMessage
      );
      const updates = migrationFiles(t).filter(f =>
        /_notice_update\.sql$/.test(f)
      );
      const heading = (
        (await t.getService("singleRegistryService").getSingle("notice"))
          .fields as { name: string; required?: boolean }[]
      ).find(field => field.name === "heading");
      return { refusal, updates, heading };
    }

    it("writes a field leaving translation as Required, its settings on record once applied", async () => {
      const t = await boot({ translated: true });

      const { refusal, updates, heading } = await leavingAsRequired(t);

      expect(refusal).toBeUndefined();
      expect(heading?.required).toBe(true);
      expect(updates.length).toBeGreaterThan(0);
      // Every file the update wrote stands as the table does.
      const applied = await appliedFiles(t);
      for (const file of updates) expect(applied).toContain(file);
    });

    it("writes a Single's update as the registry records it when a field leaving translation cannot be Required", async () => {
      const t = await boot({ translated: true });
      // The database refuses the settings, as it does where the default
      // language holds no value: all of them, and nothing of them applied.
      const refuse = vi
        .spyOn(
          SingleMetadataService.prototype as unknown as {
            applyLeavingSettings: (...args: unknown[]) => Promise<unknown>;
          },
          "applyLeavingSettings"
        )
        .mockImplementation((...args: unknown[]) =>
          Promise.resolve(
            (args[2] as { leavingSettings: unknown[] }).leavingSettings
          )
        );

      const { refusal, updates, heading } = await leavingAsRequired(t);
      refuse.mockRestore();

      expect(refusal).toContain("Required on heading");
      expect(heading?.required).not.toBe(true);
      expect(updates.length).toBeGreaterThan(0);
      // Written without the refused setting, so every file stands as the
      // table does.
      const applied = await appliedFiles(t);
      for (const file of updates) expect(applied).toContain(file);
    });

    it("withdraws a field group edit's files outside development when its change fails", async () => {
      const t = await boot({ translated: true, development: false });
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "meta",
          label: "Meta",
          fields: [{ name: "note", type: "text" }],
        }
      );
      const before = migrationFiles(t);

      companionFails.component = true;
      await expect(
        dispatchComponents(
          "updateComponent",
          { slug: "meta" },
          { localized: true }
        )
      ).rejects.toBeDefined();

      // Nothing of the refused change stays for a deploy to apply.
      expect(migrationFiles(t)).toEqual(before);
    });

    it("drops a Single's junction tables with it before its delete is recorded", async () => {
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
              options: { relationType: "manyToMany", target: "articles" },
            },
          ],
        }
      );
      const tables = () =>
        (
          t.adapter as unknown as { listTables(): Promise<string[]> }
        ).listTables();
      const isJunction = (name: string) =>
        name.includes("single_picks") && name.includes("featured");
      expect((await tables()).some(isJunction)).toBe(true);

      await dispatchSingles("deleteSingle", { slug: "picks" }, undefined);

      expect((await tables()).some(isJunction)).toBe(false);
      const deleted = migrationFiles(t).find(f =>
        /_picks_delete\.sql$/.test(f)
      );
      expect(deleted).toBeDefined();
      expect(await appliedFiles(t)).toContain(deleted);
    });

    it("records a Single update's files applied only once its row is written", async () => {
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
      const registry = t.getService("singleRegistryService");
      const rowWrite = vi
        .spyOn(registry, "updateSingle")
        .mockRejectedValueOnce(new Error("the row could not be written"));

      await expect(
        dispatchSingles(
          "updateSingleSchema",
          { slug: "notice" },
          {
            fields: [
              { name: "heading", type: "text" },
              { name: "body", type: "text" },
            ],
          }
        )
      ).rejects.toBeDefined();
      rowWrite.mockRestore();

      // The table changed and the row did not: the file stays, recorded
      // applied nowhere.
      const update = migrationFiles(t).find(f =>
        /_notice_update\.sql$/.test(f)
      );
      expect(update).toBeDefined();
      expect(await appliedFiles(t)).not.toContain(update);
    });

    it("keeps a field group delete's files, recorded nowhere, when it stops after its first teardown", async () => {
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

      companionFails.teardown = true;
      await expect(
        dispatchComponents("deleteComponent", { slug: "meta" }, undefined)
      ).rejects.toBeDefined();

      const deleted = migrationFiles(t).find(f => /_meta_delete\.sql$/.test(f));
      expect(deleted).toBeDefined();
      expect(await appliedFiles(t)).not.toContain(deleted);
    });

    it("writes a renamed nested field group's moved rows into the field group's migration", async () => {
      const t = await boot();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "panel",
          label: "Panel",
          fields: [{ name: "note", type: "text" }],
        }
      );
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "card",
          label: "Card",
          fields: [
            { name: "title", type: "text" },
            { name: "meta", type: "component", component: "panel" },
          ],
        }
      );
      const card = await t
        .getService("fieldGroupRegistryService")
        .getComponent("card");

      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "card" },
        {
          fields: [
            { name: "title", type: "text" },
            { name: "details", type: "component", component: "panel" },
          ],
          confirmed: true,
          schemaVersion: card.schemaVersion,
        }
      );

      const update = migrationFiles(t).find(f => /_card_update\.sql$/.test(f));
      expect(update).toBeDefined();
      expect(
        readFileSync(join(t.basePath, "database", "history", update!), "utf-8")
      ).toContain("_parent_field");
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
        // The push drops the undeclared column only once its drop is confirmed,
        // and asks whether the new field is that column renamed: both answered
        // as the Builder's prompt answers them.
        renameResolutions: [
          {
            tableName: "comp_older",
            fromColumn: "extra",
            toColumn: "byline",
            choice: "drop_and_add",
          },
        ],
        eventResolutions: [
          {
            kind: "confirm_drop",
            eventId: "destructive_drop:comp_older.extra",
          },
        ],
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
              // A many-to-many keeps its links in a junction table; a
              // `hasMany` relationship is stored as JSON on the row.
              options: { relationType: "manyToMany", target: "articles" },
            },
          ],
        }
      );

      const junction = (
        await (
          t.adapter as unknown as { listTables(): Promise<string[]> }
        ).listTables()
      ).find(
        // A junction's name joins its two tables in sorted order, so the
        // Single's table may stand second.
        name => name.includes("single_picks") && name.includes("featured")
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
