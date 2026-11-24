/**
 * Writes made while a type change converts a field's values, between the values' copy into the
 * column beside and that copy taking the column's place. Each is either held until the change ends
 * (and then refused, naming the field, or applied to the new type), or stopped: never answered as
 * stored and then lost under a value copied before it. Asked of every road that converts: a
 * collection's, a Single's and a field group's Schema Builder save, and `nextly migrate`.
 *
 * What separates the right answer from a plausible wrong one: a road with no hold answers the write
 * as stored, then overwrites it with the value it copied, or leaves an inserted row empty.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";

/** What runs as the column is about to be emptied, once the values are copied beside it. */
const atCopyBack = vi.hoisted(() => ({
  hook: undefined as (() => Promise<void>) | undefined,
  fired: 0,
}));

vi.mock("../pipeline/_internal/run-statement", async original => {
  const actual =
    await original<typeof import("../pipeline/_internal/run-statement")>();
  return {
    ...actual,
    runStatement: async (db: unknown, dialect: never, statement: unknown) => {
      const text =
        dialect === "mysql"
          ? new MySqlDialect().sqlToQuery(statement as never).sql
          : "";
      if (/^UPDATE `[^`]+` SET `v` = NULL$/.test(text.trim())) {
        atCopyBack.fired += 1;
        const hook = atCopyBack.hook;
        atCopyBack.hook = undefined;
        await hook?.();
      }
      return actual.runStatement(db, dialect, statement);
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcw_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-writes-"));
  vi.stubEnv("NODE_ENV", "development");
  atCopyBack.hook = undefined;
  atCopyBack.fired = 0;
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  instance = await createTestNextly({ dialect, basePath, db: DB });
  return instance;
}

/** How a write ended: stored, or refused with what it said; `waited` where the hook gave up on it. */
interface Ended {
  stored: boolean;
  said?: string;
}

/** Start `write` as the column is emptied, giving it a moment to end before the change goes on. */
function during(write: () => Promise<unknown>): Promise<Ended> {
  // Run as another request runs: outside the save's async context, whose hold lets its own writes by.
  const outside = AsyncLocalStorage.snapshot();
  return new Promise<Ended>(resolve => {
    atCopyBack.hook = async () => {
      const ended = outside(write).then(
        (): Ended => ({ stored: true }),
        (error: unknown): Ended => ({
          stored: false,
          said: error instanceof Error ? error.message : String(error),
        })
      );
      void ended.then(resolve);
      await Promise.race([ended, new Promise(done => setTimeout(done, 1500))]);
    };
  });
}

async function schemaVersion(t: TestNextly, table: string, slug: string) {
  const [row] = await (
    t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
  ).executeQuery<{ v: number | string | null }>(
    `SELECT schema_version AS v FROM ${table} WHERE slug = '${slug}'`
  );
  return Number(row?.v ?? 1);
}

async function migrateFolder(t: TestNextly, step?: number): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  await migrateCore({
    ...(step === undefined ? {} : { step }),
    extensionSchema: undefined,
    dialect: adapter.getCapabilities().dialect,
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: join(basePath, "migrations"),
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast",
    consent: resolveDataLossConsent({ flag: true, env: {} }),
    interactive: false,
    throwOnFailure: true,
  } as never);
  clearRegistryRowCache();
}

const idOf = (created: unknown): string => {
  const made = created as { item?: { id?: string }; id?: string };
  return made.item?.id ?? made.id ?? "";
};

/** `v` of each entry by title. */
async function entries(t: TestNextly): Promise<Record<string, unknown>> {
  clearRegistryRowCache();
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Array<Record<string, unknown>> };
  return Object.fromEntries(
    found.items.map(item => [String(item.title), item.v ?? null])
  );
}

describe.each(getConfiguredTestDialects().filter(d => d === "mysql"))(
  "a write made while a type change converts a field's values is never lost (%s)",
  dialect => {
    async function posts(t: TestNextly): Promise<string> {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: "Post", fields: [{ name: "v", type: "text" }] }
      );
      const id = idOf(
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "12" },
        } as never)
      );
      return id;
    }
    const saveCollection = async (t: TestNextly) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: await schemaVersion(t, "dynamic_collections", SLUG),
        }
      );
    const update = (t: TestNextly, id: string) => () =>
      t.nextly.update({
        collection: SLUG,
        id,
        data: { v: "34", _overwrite: true },
      } as never);
    const insert = (t: TestNextly) => () =>
      t.nextly.create({
        collection: SLUG,
        data: { title: "b", v: "56" },
      } as never);

    it("a collection's Builder save: an update", async () => {
      const t = await boot(dialect);
      const id = await posts(t);
      const written = during(update(t, id));
      await saveCollection(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    it("a collection's Builder save: an insert", async () => {
      const t = await boot(dialect);
      await posts(t);
      const written = during(insert(t));
      await saveCollection(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });

    async function deployed(): Promise<[TestNextly, string]> {
      const first = await boot(dialect);
      await posts(first);
      const created = (await readdir(join(basePath, "migrations"))).filter(f =>
        f.endsWith(".sql")
      ).length;
      await saveCollection(first);
      await first.destroy();
      instance = undefined;
      atCopyBack.fired = 0;
      const second = await boot(dialect);
      await migrateFolder(second, created);
      const id = idOf(
        await second.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "12" },
        } as never)
      );
      return [second, id];
    }

    it("nextly migrate: an update", async () => {
      const [t, id] = await deployed();
      const written = during(update(t, id));
      await migrateFolder(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    it("nextly migrate: an insert", async () => {
      const [t] = await deployed();
      const written = during(insert(t));
      await migrateFolder(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await entries(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });

    it("a Single's Builder save: an update", async () => {
      const t = await boot(dialect);
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "tcw_hero",
          label: "Hero",
          fields: [{ name: "v", type: "text" }],
        }
      );
      const set = (v: string) =>
        t.nextly.updateSingle({
          slug: "tcw_hero",
          data: { v, _overwrite: true },
        } as never);
      await set("12");
      const written = during(() => set("34"));
      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "tcw_hero" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: await schemaVersion(t, "dynamic_singles", "tcw_hero"),
        }
      );
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      const read = (await t.nextly.findSingle({
        slug: "tcw_hero",
      } as never)) as { v?: unknown; item?: { v?: unknown } };
      expect([ended, read.item?.v ?? read.v]).toEqual([
        ended,
        ended.stored ? 34 : 12,
      ]);
    });

    async function boxed(t: TestNextly): Promise<string> {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "tcw_box", label: "Box", fields: [{ name: "v", type: "text" }] }
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: SLUG,
          label: "Post",
          fields: [{ name: "box", type: "component", component: "tcw_box" }],
        }
      );
      return idOf(
        await t.nextly.create({
          collection: SLUG,
          data: { title: "a", box: { v: "12" } },
        } as never)
      );
    }
    const saveBox = async (t: TestNextly) => {
      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent("tcw_box")) as { schemaVersion?: number };
      return dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "tcw_box" },
        {
          fields: [{ name: "v", type: "number" }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
        }
      );
    };
    const boxes = async (t: TestNextly) => {
      clearRegistryRowCache();
      const found = (await t.nextly.find({
        collection: SLUG,
        limit: 100,
      } as never)) as unknown as {
        items: Array<{ title: string; box?: { v?: unknown } }>;
      };
      return Object.fromEntries(
        found.items.map(item => [item.title, item.box?.v ?? null])
      );
    };

    it("a field group's Builder save: an update", async () => {
      const t = await boot(dialect);
      const id = await boxed(t);
      const written = during(() =>
        t.nextly.update({
          collection: SLUG,
          id,
          data: { box: { v: "34" }, _overwrite: true },
        } as never)
      );
      await saveBox(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await boxes(t)]).toEqual([
        ended,
        { a: ended.stored ? 34 : 12 },
      ]);
    });

    it("a field group's Builder save: an insert", async () => {
      const t = await boot(dialect);
      await boxed(t);
      const written = during(() =>
        t.nextly.create({
          collection: SLUG,
          data: { title: "b", box: { v: "56" } },
        } as never)
      );
      await saveBox(t);
      expect(atCopyBack.fired).toBe(1);
      const ended = await written;
      expect([ended, await boxes(t)]).toEqual([
        ended,
        ended.stored ? { a: 12, b: 56 } : { a: 12 },
      ]);
    });
  }
);
