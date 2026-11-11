/**
 * Field groups made in the Schema Builder, placed directly in one another.
 *
 * A group with no name only lays a form out: the fields in it are stored at the level it sits in.
 * So a field group placed inside one, inside another field group, is a row of its own table like
 * one placed at the top of the fields: stored, read, cleared and removed with its entry, at every
 * level. A walk that looked only at the top of a field group's fields would drop its value, and the
 * read and the row counts below would show it missing.
 *
 * A placement the Builder later removes leaves its rows stored, since nothing deletes them when the
 * definition changes. Deleting the entity that owns them still deletes them: the sweep reads where
 * rows are, not only where a current definition places them.
 *
 * The Builder's field groups are made on one start, and the collection placing them is defined in
 * code on the next start over the same database, as an app would be.
 */
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
import { teardownEntityComponentData } from "../services/teardown-entity-field-group-data";

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
  const scratch = await createScratchDatabase(dialect, "nextly_fgb");
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
  return { type: "group", label: "Layout", fields };
}

/** A field placing `slug` directly. */
function placing(name: string, slug: string): Record<string, unknown> {
  return { name, type: "component", component: slug };
}

/** The Builder's create of a field group. */
async function createFieldGroup(slug: string, fields: unknown[]) {
  await dispatchComponents(
    "createComponent",
    {},
    { slug, label: slug, fields }
  );
}

/** Rows each field group's table holds. */
async function rowCounts(t: TestNextly, slugs: string[]): Promise<number[]> {
  const counts: number[] = [];
  for (const slug of slugs) {
    counts.push((await t.adapter.select(`comp_${slug}`, {})).length);
  }
  return counts;
}

type Plaque = {
  label?: string;
  seal?: { mark?: string; tag?: { word?: string } | null } | null;
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`field groups made in the Schema Builder, placed in one another — ${dialect}`, () => {
    let database: CaseDatabase;

    /** Start the app over this case's database, with `collections` defined in code. */
    async function start(
      collections: ReturnType<typeof defineCollection>[] = []
    ): Promise<TestNextly> {
      // A start evaluates the app's `defineConfig` first, as its config file does.
      defineConfig({ collections });
      // Keeps the adapter open: the next start connects to the same database.
      clearServices();
      return createTestNextly({
        adapter: database.adapter as never,
        collections,
      });
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      await shutdownServices().catch(() => {});
      vi.unstubAllEnvs();
      _resetEnvCache();
      await database?.close();
    });

    it("stores, reads, clears and removes one placed inside a group with no name, at every level", async () => {
      await start();
      // Two levels laid out: the plaque holds the seal inside a group with no name, and the seal
      // holds the tag the same way.
      await createFieldGroup("lotag", [{ name: "word", type: "text" }]);
      await createFieldGroup("loseal", [
        { name: "mark", type: "text" },
        laidOut([placing("tag", "lotag")]),
      ]);
      await createFieldGroup("loplaque", [
        { name: "label", type: "text" },
        laidOut([placing("seal", "loseal")]),
      ]);
      const t = await start([
        defineCollection({
          slug: "lopages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "plaque", component: "loplaque" }),
          ],
        }),
      ]);
      const slugs = ["loplaque", "loseal", "lotag"];

      const created = await t.nextly.create({
        collection: "lopages" as never,
        data: {
          title: "P",
          plaque: { label: "L", seal: { mark: "M", tag: { word: "W" } } },
        } as never,
      });
      const id = (created.item as { id: string }).id;
      const read = async (): Promise<Plaque | undefined> =>
        (
          (await t.nextly.findByID({
            collection: "lopages" as never,
            id: id as never,
          })) as { plaque?: Plaque }
        ).plaque;

      const stored = await read();
      expect(stored?.label).toBe("L");
      expect(stored?.seal?.mark).toBe("M");
      expect(stored?.seal?.tag?.word).toBe("W");
      expect(await rowCounts(t, slugs)).toEqual([1, 1, 1]);

      // Clearing the deepest level removes its row and keeps the levels above it.
      await t.nextly.update({
        collection: "lopages" as never,
        id: id as never,
        data: {
          plaque: { label: "L", seal: { mark: "M2", tag: null } },
          _overwrite: true,
        } as never,
      });
      const cleared = await read();
      expect(cleared?.seal?.mark).toBe("M2");
      expect(cleared?.seal?.tag ?? null).toBeNull();
      expect(await rowCounts(t, slugs)).toEqual([1, 1, 0]);

      // Deleting the entry removes every level beneath it.
      await t.nextly.delete({
        collection: "lopages" as never,
        id: id as never,
      });
      expect(await rowCounts(t, slugs)).toEqual([0, 0, 0]);
    }, 120_000);

    it("requires a required field group placed inside a group with no name", async () => {
      await start();
      await createFieldGroup("rqchild", [{ name: "note", type: "text" }]);
      await createFieldGroup("rqouter", [
        { name: "label", type: "text" },
        laidOut([{ ...placing("child", "rqchild"), required: true }]),
      ]);
      const t = await start([
        defineCollection({
          slug: "rqpages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "panel", component: "rqouter" }),
          ],
        }),
      ]);

      const refused = await t.nextly
        .create({
          collection: "rqpages" as never,
          data: { title: "P", panel: { label: "L" } } as never,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(refused).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              code: "REQUIRED",
              path: expect.stringMatching(/child$/),
            }),
          ],
        },
      });
      expect(await rowCounts(t, ["rqouter", "rqchild"])).toEqual([0, 0]);

      await t.nextly.create({
        collection: "rqpages" as never,
        data: {
          title: "P",
          panel: { label: "L", child: { note: "N" } },
        } as never,
      });
      expect(await rowCounts(t, ["rqouter", "rqchild"])).toEqual([1, 1]);
    }, 120_000);

    it("deletes the rows of a placement the Builder removed with the instance holding them", async () => {
      await start();
      await createFieldGroup("rlchild", [{ name: "note", type: "text" }]);
      await createFieldGroup("rlouter", [
        { name: "label", type: "text" },
        placing("child", "rlchild"),
      ]);
      const t = await start([
        defineCollection({
          slug: "rlpages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "panel", component: "rlouter" }),
            fieldGroup({
              name: "panels",
              component: "rlouter",
              repeatable: true,
            }),
          ],
        }),
      ]);
      const holding = (label: string) => ({ label, child: { note: label } });
      const created = await t.nextly.create({
        collection: "rlpages" as never,
        data: {
          title: "P",
          panel: holding("solo"),
          panels: [holding("first"), holding("second")],
        } as never,
      });
      const id = (created.item as { id: string }).id;
      const counts = () => rowCounts(t, ["rlouter", "rlchild"]);
      expect(await counts()).toEqual([3, 3]);

      // The outer field group stops placing the child; the child rows stay stored.
      const outer = await t
        .getService("fieldGroupRegistryService")
        .getComponentBySlug("rlouter");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "rlouter" },
        {
          fields: [{ name: "label", type: "text" }],
          confirmed: true,
          schemaVersion: outer?.schemaVersion,
        }
      );
      expect(await counts()).toEqual([3, 3]);
      const stored = (await t.nextly.findByID({
        collection: "rlpages" as never,
        id: id as never,
      })) as { panels: { id: string; label: string }[] };

      // Clearing the single instance takes the child row it held.
      await t.nextly.update({
        collection: "rlpages" as never,
        id: id as never,
        data: { panel: null, _overwrite: true } as never,
      });
      expect(await counts()).toEqual([2, 2]);

      // Removing a list item takes the child row it held.
      await t.nextly.update({
        collection: "rlpages" as never,
        id: id as never,
        data: { panels: [stored.panels[0]], _overwrite: true } as never,
      });
      expect(await counts()).toEqual([1, 1]);

      // Deleting the entry takes the rest.
      await t.nextly.delete({
        collection: "rlpages" as never,
        id: id as never,
      });
      expect(await counts()).toEqual([0, 0]);
    }, 120_000);

    it("deletes the rows of a placement the Builder removed, with the entity that owns them", async () => {
      await start();
      await createFieldGroup("rmchild", [{ name: "note", type: "text" }]);
      await createFieldGroup("rmouter", [
        { name: "label", type: "text" },
        placing("child", "rmchild"),
      ]);
      const t = await start([
        defineCollection({
          slug: "rmpages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "panel", component: "rmouter" }),
          ],
        }),
      ]);
      await t.nextly.create({
        collection: "rmpages" as never,
        data: {
          title: "P",
          panel: { label: "L", child: { note: "N" } },
        } as never,
      });
      expect(await rowCounts(t, ["rmouter", "rmchild"])).toEqual([1, 1]);

      // The outer field group stops placing the child; the child's row stays stored.
      const outer = await t
        .getService("fieldGroupRegistryService")
        .getComponentBySlug("rmouter");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "rmouter" },
        {
          fields: [{ name: "label", type: "text" }],
          confirmed: true,
          schemaVersion: outer?.schemaVersion,
        }
      );
      expect(await rowCounts(t, ["rmouter", "rmchild"])).toEqual([1, 1]);

      // The collection's own sweep, as its delete runs it before dropping its table.
      await teardownEntityComponentData({
        adapter: t.adapter,
        parentTable: "dc_rmpages",
      });
      expect(await rowCounts(t, ["rmouter", "rmchild"])).toEqual([0, 0]);
    }, 120_000);
  });
}
