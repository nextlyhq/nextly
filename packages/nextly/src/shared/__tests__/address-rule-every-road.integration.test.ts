/**
 * One address rule on every road, against a real database.
 *
 * For each kind (collection, Single, field group) and each road that creates one (a Builder save,
 * the field-group Direct API, configuration at start), on a fresh project: `team-updates` is
 * created, an entry of it is written and read, and its table carries the snake_case name with the
 * kind's prefix. Then `team_updates`, which has the same snake_case form, and the addresses the
 * rule refuses for other reasons, are refused on the same road, with the tables and the registry
 * as they were.
 *
 * The upgrade case: a database holding a Builder collection made under `admin` before the rule,
 * and a code-first collection under `cascade` (a SQL word configuration accepted before the rule),
 * starts, and both keep being read, written and edited.
 *
 * The Direct API creates field groups only: nothing in it creates a collection or a Single, so
 * that road is exercised for field groups alone.
 *
 * Each case owns its database, so a boot that is refused can be inspected afterwards: a throwaway
 * database on PostgreSQL and MySQL, one in-memory SQLite connection otherwise.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../database/test-database-ddl";
import { clearServices } from "../../di/register";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../dispatcher/handlers/single-dispatcher";
import { seedBuilderCollection } from "../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import type { ServiceContainer } from "../../services";
import { judgeAddress } from "../address-rule";
import { _resetEnvCache } from "../lib/env";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database every boot of one case connects to, dropped by `close`. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_ar_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/** Addresses the rule refuses for a reason other than a shared snake_case form. */
const REFUSED = ["admin", "select", "accounts", "a".repeat(51)];

const REGISTRY = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
  fieldGroup: STORAGE_FORMAT.registryTable,
} as const;

/** What a refusal must leave as it was: the registry's addresses and the tables. */
async function stateOf(
  adapter: DrizzleAdapter,
  kind: keyof typeof REGISTRY
): Promise<{ addresses: string[]; tables: boolean[] }> {
  const rows = await adapter.select<{ slug: string }>(REGISTRY[kind], {
    columns: ["slug"],
  });
  const tables = await Promise.all(
    ["dc_team_updates", "single_team_updates", "comp_team_updates"].map(t =>
      adapter.tableExists(t)
    )
  );
  return { addresses: rows.map(r => r.slug).sort(), tables };
}

/** The refusal's message, or `null` when the call went through. */
async function verdictOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.[0]?.message ?? (error as Error).message;
  }
}

const BODY = [{ name: "body", type: "text" }];

for (const dialect of getConfiguredTestDialects()) {
  describe(`one address rule on every road — ${dialect}`, () => {
    let database: CaseDatabase;
    let current: TestNextly | undefined;

    async function boot(
      config: Parameters<typeof createTestNextly>[0] = {}
    ): Promise<TestNextly> {
      clearServices();
      current = await createTestNextly({
        ...config,
        adapter: database.adapter as never,
      });
      return current;
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      clearServices();
      current = undefined;
      await database.close();
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    describe("a collection", () => {
      const create = (name: string) =>
        dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name,
            label: "Team updates",
            fields: BODY,
          }
        );

      it("is created through a Builder save under a hyphen, and refused a twin or a refused address", async () => {
        const t = await boot();
        await create("team-updates");

        expect(await t.adapter.tableExists("dc_team_updates")).toBe(true);
        const written = await t.nextly.create({
          collection: "team-updates",
          data: { title: "First", body: "hello" },
        });
        const read = await t.nextly.findByID({
          collection: "team-updates",
          id: (written.item as { id: string }).id,
        });
        expect((read as { body?: string } | null)?.body).toBe("hello");

        const before = await stateOf(t.adapter as never, "collection");
        expect(await verdictOf(() => create("team_updates"))).toMatch(
          /'team_updates'.*'team_updates'.*collection 'team-updates'/
        );
        for (const address of REFUSED) {
          expect(await verdictOf(() => create(address))).toBe(
            judgeAddress("collection", address)?.message
          );
        }
        expect(await stateOf(t.adapter as never, "collection")).toEqual(before);
      });

      it("is created from configuration at start under a hyphen, and a twin or a refused address refuses the start", async () => {
        const teamUpdates = defineCollection({
          slug: "team-updates",
          fields: [text({ name: "body" })],
        });
        const t = await boot({ collections: [teamUpdates] });

        expect(await t.adapter.tableExists("dc_team_updates")).toBe(true);
        const written = await t.nextly.create({
          collection: "team-updates",
          data: { body: "hello" },
        });
        const read = await t.nextly.findByID({
          collection: "team-updates",
          id: (written.item as { id: string }).id,
        });
        expect((read as { body?: string } | null)?.body).toBe("hello");

        const before = await stateOf(database.adapter, "collection");
        // The configuration is handed over as written, not through `defineCollection`, so the start
        // is what judges it: the road `define*` cannot finish on its own.
        for (const address of ["team_updates", ...REFUSED]) {
          await expect(
            boot({
              collections: [
                teamUpdates,
                { slug: address, fields: [text({ name: "body" })] } as never,
              ],
            })
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
          expect(await stateOf(database.adapter, "collection")).toEqual(before);
        }
      });
    });

    describe("a Single", () => {
      const create = (slug: string) =>
        dispatchSingles(
          "createSingle",
          {},
          {
            slug,
            label: "Team updates",
            fields: BODY,
          }
        );

      it("is created through a Builder save under a hyphen, and refused a twin or a refused address", async () => {
        const t = await boot();
        await create("team-updates");

        expect(await t.adapter.tableExists("single_team_updates")).toBe(true);
        await t.nextly.updateSingle({
          slug: "team-updates",
          data: { body: "hello" },
        });
        const read = await t.nextly.findSingle({ slug: "team-updates" });
        expect((read as { body?: string }).body).toBe("hello");

        const before = await stateOf(t.adapter as never, "single");
        expect(await verdictOf(() => create("team_updates"))).toMatch(
          /'team_updates'.*'team_updates'.*single 'team-updates'/
        );
        for (const address of REFUSED) {
          expect(await verdictOf(() => create(address))).toBe(
            judgeAddress("single", address)?.message
          );
        }
        expect(await stateOf(t.adapter as never, "single")).toEqual(before);
      });

      it("is created from configuration at start under a hyphen, and a twin refuses the start", async () => {
        const teamUpdates = defineSingle({
          slug: "team-updates",
          fields: [text({ name: "body" })],
        });
        const t = await boot({ singles: [teamUpdates] });

        expect(await t.adapter.tableExists("single_team_updates")).toBe(true);
        await t.nextly.updateSingle({
          slug: "team-updates",
          data: { body: "hello" },
        });
        expect(
          (
            (await t.nextly.findSingle({ slug: "team-updates" })) as {
              body?: string;
            }
          ).body
        ).toBe("hello");

        const before = await stateOf(database.adapter, "single");
        for (const address of ["team_updates", ...REFUSED]) {
          await expect(
            boot({
              singles: [
                teamUpdates,
                { slug: address, fields: [text({ name: "body" })] } as never,
              ],
            })
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
          expect(await stateOf(database.adapter, "single")).toEqual(before);
        }
      });
    });

    describe("a field group", () => {
      /** A collection holding the field group, so an entry of it can be written and read. */
      async function writeAndRead(t: TestNextly): Promise<string | undefined> {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: "holders",
            label: "Holders",
            fields: [
              { name: "update", type: "component", component: "team-updates" },
            ],
          }
        );
        const written = await t.nextly.create({
          collection: "holders",
          data: { title: "One", update: { body: "hello" } },
        });
        const read = await t.nextly.findByID({
          collection: "holders",
          id: (written.item as { id: string }).id,
          depth: 1,
        });
        return (read as { update?: { body?: string } } | null)?.update?.body;
      }

      const roads = {
        "a Builder save": (slug: string) =>
          dispatchComponents(
            "createComponent",
            {},
            {
              slug,
              label: "Team updates",
              fields: BODY,
            }
          ),
        "the Direct API": (slug: string) =>
          (current as TestNextly).nextly.fieldGroups.create({
            slug,
            label: "Team updates",
            fields: BODY as never,
          }),
      };

      for (const [road, create] of Object.entries(roads)) {
        it(`is created through ${road} under a hyphen, and refused a twin or a refused address`, async () => {
          const t = await boot();
          await create("team-updates");

          expect(await t.adapter.tableExists("comp_team_updates")).toBe(true);
          expect(await writeAndRead(t)).toBe("hello");

          const before = await stateOf(t.adapter as never, "fieldGroup");
          expect(await verdictOf(() => create("team_updates"))).toMatch(
            /'team_updates'.*'team_updates'.*field group 'team-updates'/
          );
          for (const address of REFUSED) {
            expect(await verdictOf(() => create(address))).toBe(
              judgeAddress("fieldGroup", address)?.message
            );
          }
          expect(await stateOf(t.adapter as never, "fieldGroup")).toEqual(
            before
          );
        });
      }

      it("is created from configuration at start under a hyphen, and a twin refuses the start", async () => {
        const teamUpdates = defineFieldGroup({
          slug: "team-updates",
          fields: [text({ name: "body" })],
        });
        const t = await boot({ fieldGroups: [teamUpdates] });

        expect(await t.adapter.tableExists("comp_team_updates")).toBe(true);
        expect(await writeAndRead(t)).toBe("hello");

        const before = await stateOf(database.adapter, "fieldGroup");
        for (const address of ["team_updates", ...REFUSED]) {
          await expect(
            boot({
              fieldGroups: [
                teamUpdates,
                { slug: address, fields: [text({ name: "body" })] } as never,
              ],
            })
          ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
          expect(await stateOf(database.adapter, "fieldGroup")).toEqual(before);
        }
      });
    });

    describe("an upgrade from addresses made before the rule", () => {
      it("keeps a Builder collection under `admin` and a code-first one under `cascade` working", async () => {
        const cascade = defineCollection({
          slug: "cascade",
          fields: [text({ name: "body" })],
        });
        // The database as an earlier version left it: the Builder made `admin`, and `cascade` was
        // registered from code.
        await boot();
        await seedBuilderCollection(database.adapter, {
          slug: "admin",
          fields: [{ name: "body", type: "text" }],
        });
        await seedBuilderCollection(database.adapter, {
          slug: "cascade",
          fields: [{ name: "body", type: "text" }],
        });

        // The upgraded start: both are held by registry rows, so neither address is judged.
        const t = await boot({ collections: [cascade] });

        for (const collection of ["admin", "cascade"]) {
          const written = await t.nextly.create({
            collection,
            data: { title: "Kept", body: "still here" },
          });
          const read = await t.nextly.findByID({
            collection,
            id: (written.item as { id: string }).id,
          });
          expect((read as { body?: string } | null)?.body, collection).toBe(
            "still here"
          );
        }

        // Edited in the Builder: a field added to the collection under `admin`.
        await dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: "admin" },
          { fields: [...BODY, { name: "summary", type: "text" }] }
        );
        const edited = await t.nextly.create({
          collection: "admin",
          data: { title: "Edited", body: "b", summary: "s" },
        });
        expect((edited.item as { summary?: string }).summary).toBe("s");
      });
    });
  });
}
