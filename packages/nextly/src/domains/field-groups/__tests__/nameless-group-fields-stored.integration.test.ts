/**
 * The data fields of a group with no name, inside a field group, are stored on the field group's
 * row.
 *
 * A group with no name only lays fields out: the fields in it are stored where the group sits, as
 * a collection's and a Single's are. For a field group that is the instance's own row, so each such
 * field is a column of the field group's table. These cases hold that end to end on every dialect:
 * the create makes the columns, a write stores the values, a read returns them (a relationship's at
 * depth too), reconcile finds the table healthy, and a later Builder save plans only the change it
 * makes. A field group placed inside such a group keeps its instances as rows of its own table.
 *
 * Field groups made before this stored nothing for those fields, and their tables have no column
 * for them. The last cases build such a table, as the earlier creator left it, and hold the way
 * forward: reconcile keeps the fields and names each column the table still lacks, and the next
 * Builder save adds the columns, nullable, without touching the columns that stand. Values are
 * stored from then on.
 *
 * The Builder's field groups are made on one start, and the collection placing them is defined in
 * code on the next start over the same database, as an app would be. Each case runs as a
 * development server does, where a Builder save applies its migration at once.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import { FieldGroupMetadataService } from "../services/field-group-metadata-service";
import { reconcileFieldGroup } from "../services/field-group-reconcile-service";
import { registeredComponentColumns } from "../services/field-group-table-provisioning";

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database every start of one case connects to, dropped when the case ends. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  vi.stubEnv("DB_DIALECT", dialect);
  if (dialect === "sqlite") {
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const scratch = await createScratchDatabase(dialect, "nextly_fgn");
  vi.stubEnv("DATABASE_URL", scratch.url);
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: scratch.url,
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await scratch.drop();
    },
  };
}

/** A group with no name holding `fields`: it lays them out, and they are stored where it sits. */
function laidOut(fields: unknown[]): Record<string, unknown> {
  return { type: "group", label: "Details", fields };
}

/** The collection a relationship inside the field group points at, defined in code. */
const targets = defineCollection({
  slug: "fgntargets",
  fields: [text({ name: "title" })],
});

/**
 * The badge's fields: a text beside a group with no name, which holds a text, a number, a JSON
 * field, a relationship and a field group, and nests a second group with no name holding a date.
 */
function badgeFields(): unknown[] {
  return [
    { name: "label", type: "text" },
    // A relationship beside the group, which a read at depth expands: the one inside is read the
    // same way.
    {
      name: "lead",
      type: "relationship",
      relationTo: "fgntargets",
    },
    laidOut([
      { name: "note", type: "text" },
      { name: "count", type: "number" },
      { name: "meta", type: "json" },
      // A single reference, which every route indexes whether or not it asks.
      { name: "owner", type: "relationship", relationTo: "fgntargets" },
      { name: "seal", type: "component", component: "fgnseal" },
      laidOut([{ name: "issued_on", type: "date" }]),
    ]),
  ];
}

/** The columns the badge's laid-out data fields are stored in. */
const LAID_OUT_COLUMNS = ["note", "count", "meta", "owner", "issued_on"];

type Badge = {
  label?: string;
  note?: string | null;
  count?: number | null;
  meta?: unknown;
  owner?: unknown;
  lead?: unknown;
  issued_on?: unknown;
  seal?: { mark?: string } | null;
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group's fields inside a group with no name — ${dialect}`, () => {
    let database: CaseDatabase;
    // The app's own folder, which every start of one case shares as an app's restarts do.
    let folder: string;

    /** Start the app over this case's database, with `collections` defined in code. */
    async function start(
      collections: ReturnType<typeof defineCollection>[] = [targets]
    ): Promise<TestNextly> {
      defineConfig({ collections });
      // Keeps the adapter open: the next start connects to the same database.
      clearServices();
      return createTestNextly({
        adapter: database.adapter as never,
        collections,
        basePath: folder,
      });
    }

    /** The second start, with the collection placing the badge. */
    function startWithPages(): Promise<TestNextly> {
      return start([
        targets,
        defineCollection({
          slug: "fgnpages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "badge", component: "fgnbadge" }),
          ],
        }),
      ]);
    }

    /** The live columns of `table`, by name. */
    async function liveColumns(t: TestNextly, table: string) {
      const snapshot = await introspectLiveColumns(
        t.adapter.getDrizzle(),
        dialect,
        [table]
      );
      return new Map(
        (snapshot.tables[0]?.columns ?? []).map(column => [column.name, column])
      );
    }

    /** Every migration file the app's folder holds, by path. */
    async function migrationFiles(): Promise<string[]> {
      const found: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) await walk(path);
          else if (entry.name.endsWith(".sql")) found.push(path);
        }
      };
      await walk(folder);
      return found.sort();
    }

    /** The statements of the newest migration file whose name ends in `suffix`. */
    async function newestMigration(suffix: string): Promise<string> {
      const newest = (await migrationFiles())
        .filter(path => path.endsWith(suffix))
        .at(-1);
      expect(newest, `a migration ending in ${suffix}`).toBeDefined();
      return readFile(newest!, "utf-8");
    }

    /**
     * The statements of `sql` that change the badge's table's shape when it is applied: its DDL,
     * without comments, breakpoints, or the registry and ledger rows the file also writes.
     */
    function statementsOf(sql: string): string[] {
      // The file's `-- UP` section: its `-- DOWN` section undoes it, and runs only on a rollback.
      const up = sql.split(/^-- DOWN\b/m)[0] ?? "";
      return up
        .split(/--> statement-breakpoint|;\s*\n/)
        .map(part =>
          part
            .split("\n")
            .filter(line => !line.trim().startsWith("--"))
            .join(" ")
            .trim()
        )
        .filter(
          part =>
            /^(ALTER|CREATE|DROP)\b/i.test(part) && part.includes("fgnbadge")
        );
    }

    async function reconcile(t: TestNextly, slug: string) {
      return reconcileFieldGroup({
        registry: t.getService("fieldGroupRegistryService"),
        adapter: t.adapter,
        logger: t.getService("logger"),
        slug,
      });
    }

    /**
     * The Builder's save of the badge's fields, against the version it read, confirming the
     * conversions its review named (`acknowledgedConversions`).
     */
    async function saveBadge(
      t: TestNextly,
      fields: unknown[],
      acknowledgedConversions: string[] = []
    ): Promise<void> {
      const stored = await t
        .getService("fieldGroupRegistryService")
        .getComponent("fgnbadge");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "fgnbadge" },
        {
          fields,
          confirmed: true,
          schemaVersion: stored.schemaVersion,
          acknowledgedConversions,
        }
      );
    }

    /** Write a page with a badge, then read it back at `depth`. */
    async function writeAndRead(
      t: TestNextly,
      depth: number
    ): Promise<{ id: string; badge: Badge | undefined; ownerId: string }> {
      const owner = await t.nextly.create({
        collection: "fgntargets" as never,
        data: { title: "Owner" } as never,
      });
      const ownerId = (owner.item as { id: string }).id;
      const created = await t.nextly.create({
        collection: "fgnpages" as never,
        data: {
          title: "P",
          badge: {
            label: "L",
            note: "N",
            count: 7,
            meta: { tier: "gold" },
            owner: ownerId,
            lead: ownerId,
            issued_on: "2026-01-02T00:00:00.000Z",
            seal: { mark: "M" },
          },
        } as never,
      });
      const id = (created.item as { id: string }).id;
      const read = (await t.nextly.findByID({
        collection: "fgnpages" as never,
        id: id as never,
        depth,
      })) as { badge?: Badge };
      return { id, badge: read.badge, ownerId };
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
      folder = await mkdtemp(join(tmpdir(), "nextly-fgn-"));
      // Development, where a field group's Builder save applies its migration.
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      await shutdownServices().catch(() => {});
      vi.unstubAllEnvs();
      _resetEnvCache();
      await database?.close();
      await rm(folder, { recursive: true, force: true });
    });

    it("creates a column for each of them, stores their values and reads them back", async () => {
      await start();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgnseal",
          label: "Seal",
          fields: [{ name: "mark", type: "text" }],
        }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgnbadge", label: "Badge", fields: badgeFields() }
      );
      const t = await startWithPages();

      const live = await liveColumns(t, "comp_fgnbadge");
      expect(LAID_OUT_COLUMNS.filter(column => !live.has(column))).toEqual([]);
      // Each is nullable, as a field that is not required is anywhere.
      expect(
        LAID_OUT_COLUMNS.filter(column => live.get(column)?.nullable !== true)
      ).toEqual([]);
      // The field group inside the group keeps its instances in its own table: no column here.
      expect(live.has("seal")).toBe(false);

      const { id, badge, ownerId } = await writeAndRead(t, 0);
      expect(badge?.label).toBe("L");
      expect(badge?.note).toBe("N");
      expect(badge?.count).toBe(7);
      expect(badge?.meta).toEqual({ tier: "gold" });
      expect(badge?.owner).toBe(ownerId);
      expect(new Date(badge?.issued_on as string).toISOString()).toBe(
        "2026-01-02T00:00:00.000Z"
      );
      expect(badge?.seal?.mark).toBe("M");

      // At depth the relationship inside the group is expanded as one beside it is: the entry is
      // the first level and the field group's instance the second.
      const deep = (await t.nextly.findByID({
        collection: "fgnpages" as never,
        id: id as never,
        depth: 2,
      })) as { badge?: Badge };
      expect(deep.badge?.lead).toMatchObject({ id: ownerId, title: "Owner" });
      expect(deep.badge?.owner).toMatchObject({ id: ownerId, title: "Owner" });

      // The values sit in the badge's own row, under the fields' columns.
      const rows = await t.adapter.select("comp_fgnbadge", {});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ note: "N", count: 7 });
    }, 120_000);

    it("reconciles healthy, and a later save plans only its own change", async () => {
      await start();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgnseal",
          label: "Seal",
          fields: [{ name: "mark", type: "text" }],
        }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgnbadge", label: "Badge", fields: badgeFields() }
      );
      const t = await startWithPages();

      const report = await reconcile(t, "fgnbadge");
      expect(report.removed).toEqual([]);
      expect(report.repaired).toEqual([]);
      expect(report.adopted).toEqual([]);
      expect(report.unchanged).toBe(true);

      // A save that adds one field beside the group: its migration adds that column and nothing
      // else, so the group's columns are neither dropped nor added again.
      await saveBadge(t, [...badgeFields(), { name: "motto", type: "text" }]);
      const changed = statementsOf(
        await newestMigration("_fgnbadge_update.sql")
      );
      // Listed whole on a failure, so an extra statement is named.
      expect(changed.filter(statement => !/motto/.test(statement))).toEqual([]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatch(/ADD/i);
      const live = await liveColumns(t, "comp_fgnbadge");
      expect(
        [...LAID_OUT_COLUMNS, "motto"].filter(column => !live.has(column))
      ).toEqual([]);
    }, 120_000);

    /** The badge's fields that sit beside its group, each of which every earlier version stored. */
    function besideTheGroup(): unknown[] {
      return badgeFields().filter(
        field => typeof (field as { name?: unknown }).name === "string"
      );
    }

    /**
     * The way forward from a badge table that has a column for each field beside the group and none
     * for the fields inside it, under the definition that lays them out, as earlier versions left
     * every such field group. `acknowledged` is what the save confirms, as the Builder's review
     * sends it back.
     */
    async function bringForward(acknowledged: string[]): Promise<void> {
      const t = await startWithPages();
      const before = await liveColumns(t, "comp_fgnbadge");
      expect(LAID_OUT_COLUMNS.filter(column => before.has(column))).toEqual([]);

      // Reconcile keeps the fields and names the columns still to come, rather than removing the
      // fields or calling the table damaged.
      const report = await reconcile(t, "fgnbadge");
      expect(report.removed).toEqual([]);
      expect(report.repaired).toEqual([]);
      expect(report.adopted).toEqual([]);
      expect(
        report.awaitingColumns.map(entry => entry.columnName).sort()
      ).toEqual([...LAID_OUT_COLUMNS].sort());
      expect(report.unchanged).toBe(true);

      // Until the columns are added the field group is served as before: an instance is written
      // and read, and the values of the fields inside the group are not yet stored.
      const old = await t.nextly.create({
        collection: "fgnpages" as never,
        data: {
          title: "Old",
          badge: { label: "Kept", note: "Early" },
        } as never,
      });
      const oldId = (old.item as { id: string }).id;
      const oldRead = (await t.nextly.findByID({
        collection: "fgnpages" as never,
        id: oldId as never,
      })) as { badge?: Badge };
      expect(oldRead.badge?.label).toBe("Kept");
      expect(oldRead.badge?.note ?? null).toBeNull();

      // The next save, of the same fields, adds the columns: one nullable ADD per column, and no
      // statement that drops, rebuilds or changes a column that stands.
      // Every file the save writes is read: one adopting a table no snapshot records puts its
      // conversions in a file of their own, before the change.
      const earlierFiles = new Set(await migrationFiles());
      await saveBadge(t, badgeFields(), acknowledged);
      const written = (await migrationFiles()).filter(
        path => !earlierFiles.has(path)
      );
      expect(written.length).toBeGreaterThan(0);
      // An `_adopt` file records the table as it stands and is recorded applied without running,
      // so the statements that change the table are those of the others.
      const statements = (
        await Promise.all(
          written
            .filter(path => !path.endsWith("_adopt.sql"))
            .map(path => readFile(path, "utf-8"))
        )
      ).flatMap(statementsOf);
      const columnStatements = statements.filter(
        statement => !/\bINDEX\b/i.test(statement)
      );
      expect(
        columnStatements.filter(statement => !/\bADD\b/i.test(statement))
      ).toEqual([]);
      expect(
        statements.filter(statement =>
          /\bDROP\b|ALTER COLUMN|\bMODIFY\b|__new_/i.test(statement)
        )
      ).toEqual([]);
      for (const column of LAID_OUT_COLUMNS) {
        expect(
          columnStatements.filter(statement => statement.includes(`${column}`)),
          `one ADD of ${column}`
        ).toHaveLength(1);
      }
      const after = await liveColumns(t, "comp_fgnbadge");
      expect(LAID_OUT_COLUMNS.filter(column => !after.has(column))).toEqual([]);
      expect(
        LAID_OUT_COLUMNS.filter(column => after.get(column)?.nullable !== true)
      ).toEqual([]);
      for (const [name, column] of before) {
        expect(after.get(name), name).toEqual(column);
      }

      // The earlier instance is still there, and new values are stored and read back.
      const kept = (await t.nextly.findByID({
        collection: "fgnpages" as never,
        id: oldId as never,
      })) as { badge?: Badge };
      expect(kept.badge?.label).toBe("Kept");
      const { badge, ownerId } = await writeAndRead(t, 0);
      expect(badge?.note).toBe("N");
      expect(badge?.count).toBe(7);
      expect(badge?.meta).toEqual({ tier: "gold" });
      expect(badge?.owner).toBe(ownerId);

      const healthy = await reconcile(t, "fgnbadge");
      expect(healthy.awaitingColumns).toEqual([]);
      expect(healthy.removed).toEqual([]);
      expect(healthy.adopted).toEqual([]);
      expect(healthy.unchanged).toBe(true);
    }

    it("brings forward a field group its earlier creator made, naming each column in the review", async () => {
      const first = await start();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgnseal",
          label: "Seal",
          fields: [{ name: "mark", type: "text" }],
        }
      );
      // Made by the field group's own creator, with no migration file: the table is on no
      // snapshot, so the next save adopts it and names what it converts.
      const registry = first.getService("fieldGroupRegistryService");
      await new FieldGroupMetadataService(
        registry,
        first.getService("logger"),
        first.adapter
      ).createFieldGroup({
        slug: "fgnbadge",
        label: "Badge",
        tableName: "comp_fgnbadge",
        fields: besideTheGroup(),
        source: "ui",
        locked: false,
        schemaHash: "earlier",
      } as never);
      await registry.updateComponent("fgnbadge", {
        fields: badgeFields(),
      } as never);

      // The review names each column the save adds, as missing from the table an earlier version
      // made, rather than one line for the table.
      const t = await startWithPages();
      const preview = (await (
        (await dispatchComponents(
          "previewComponentSchemaChanges",
          { slug: "fgnbadge" },
          { fields: badgeFields() }
        )) as Response
      ).json()) as { data?: { notices?: string[] }; notices?: string[] };
      const notices = preview.data?.notices ?? preview.notices ?? [];
      for (const column of LAID_OUT_COLUMNS) {
        expect(
          notices.some(
            notice =>
              notice.includes(` ${column} from missing`) &&
              notice.includes("nullable")
          ),
          `a notice naming ${column}`
        ).toBe(true);
      }

      await bringForward([
        ...LAID_OUT_COLUMNS,
        // The index the reference inside the group asks for, named by its table.
        "comp_fgnbadge",
      ]);
    }, 120_000);

    it("keeps serving an earlier field group after an edit that alters no table", async () => {
      const first = await start();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgnseal",
          label: "Seal",
          fields: [{ name: "mark", type: "text" }],
        }
      );
      const registry = first.getService("fieldGroupRegistryService");
      await new FieldGroupMetadataService(
        registry,
        first.getService("logger"),
        first.adapter
      ).createFieldGroup({
        slug: "fgnbadge",
        label: "Badge",
        tableName: "comp_fgnbadge",
        fields: besideTheGroup(),
        source: "ui",
        locked: false,
        schemaHash: "earlier",
      } as never);
      await registry.updateComponent("fgnbadge", {
        fields: badgeFields(),
      } as never);
      const t = await startWithPages();

      // The field group's own update, with no save writer: it alters no table, and registers the
      // runtime table again as the table stands.
      await new FieldGroupMetadataService(
        t.getService("fieldGroupRegistryService"),
        t.getService("logger"),
        t.adapter
      ).updateFieldGroup({
        slug: "fgnbadge",
        label: "Badge, relabelled",
        fields: badgeFields() as never,
      });
      // The runtime table that update registered, read before anything else registers one: it
      // names no column the table does not hold.
      const registered = registeredComponentColumns(
        t.adapter as never,
        "comp_fgnbadge"
      );
      expect(registered).toBeDefined();
      expect(
        LAID_OUT_COLUMNS.filter(column => registered!.has(column))
      ).toEqual([]);
      expect(registered!.has("label")).toBe(true);

      const written = await t.nextly.create({
        collection: "fgnpages" as never,
        data: { title: "After", badge: { label: "Kept", note: "N" } } as never,
      });
      const read = (await t.nextly.findByID({
        collection: "fgnpages" as never,
        id: (written.item as { id: string }).id as never,
      })) as { badge?: Badge };
      expect(read.badge?.label).toBe("Kept");
      expect(read.badge?.note ?? null).toBeNull();
    }, 120_000);

    it("brings forward a field group an earlier Builder save made, on record", async () => {
      await start();
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgnseal",
          label: "Seal",
          fields: [{ name: "mark", type: "text" }],
        }
      );
      // Made by a Builder save, whose migration and snapshot record the table as an earlier
      // version wrote it: the fields beside the group alone.
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgnbadge", label: "Badge", fields: besideTheGroup() }
      );
      await start().then(t =>
        t
          .getService("fieldGroupRegistryService")
          .updateComponent("fgnbadge", { fields: badgeFields() } as never)
      );

      // On record, the save diffs from the snapshot: no adoption, nothing to confirm.
      await bringForward([]);
    }, 120_000);
  });
}
