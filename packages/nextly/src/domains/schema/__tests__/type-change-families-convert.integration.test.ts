/**
 * A Schema Builder save's type change into or out of a date, a checkbox, a JSON value or a rich text
 * writes each value as the new type reads it, in the form its column keeps on each dialect: a date
 * as PostgreSQL's timestamp, MySQL's whole-second timestamp or SQLite's seconds; a checkbox as
 * PostgreSQL's boolean or 1/0. The migration file it writes converts every database it deploys to
 * alike. A required field's values that cannot convert are written as the fill the person chose,
 * before the column takes its NOT NULL; without one, the change is refused. Proved on SQLite,
 * PostgreSQL and MySQL, values read back through the Direct API.
 *
 * What separates the right answer from plausible wrong ones:
 * - a conversion that writes a reading as a text literal stores a date as text where SQLite keeps
 *   seconds, and a checkbox as "true" where MySQL keeps 1;
 * - one that clears a required field's lost values leaves NULLs its NOT NULL refuses.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../migrate/data-loss-consent";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcv_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-families-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
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

async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
}

/** `nextly migrate` on `t`'s database over the folder the first database wrote. */
async function migrateFolder(
  t: TestNextly,
  step?: number,
  consent: DataLossConsent = NO_CONSENT
): Promise<void> {
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
    consent,
    interactive: false,
    throwOnFailure: true,
  } as never);
  clearRegistryRowCache();
}

async function createPosts(fields: Record<string, unknown>[]): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    { name: SLUG, label: "Post", fields }
  );
}

/** The schema dialog's save of `fields`; the refusal it answered with, or undefined. */
async function save(
  t: TestNextly,
  fields: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Promise<unknown> {
  const [row] = await (
    t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
  ).executeQuery<{ v: number | string | null }>(
    `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  return dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: Number(row?.v ?? 1),
      ...extra,
    }
  ).then(
    () => {
      clearRegistryRowCache();
      return undefined;
    },
    (error: unknown) => error
  );
}

async function write(
  t: TestNextly,
  title: string,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.create({
    collection: SLUG,
    data: { title, ...data },
  } as never);
}

/** `v` of each entry, by title, through the Direct API; a date as its ISO instant. */
async function read(t: TestNextly): Promise<Record<string, unknown>> {
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Array<Record<string, unknown>> };
  return Object.fromEntries(
    found.items.map(item => {
      const v = item.v ?? null;
      return [String(item.title), v instanceof Date ? v.toISOString() : v];
    })
  );
}

describe.each(getConfiguredTestDialects())(
  "a type change into or out of a date, checkbox, JSON or rich text writes each dialect's stored form (%s)",
  dialect => {
    // A date read as text is its ISO instant, a form the database's cast does not write: the save
    // writes it, from each dialect's stored form (SQLite's seconds included).
    it("converts a date into a text as its ISO instant", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "date" }]);
      const t = instance as TestNextly;
      await write(t, "a", { v: "2024-01-02T03:04:05.000Z" });

      expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

      expect(await read(t)).toEqual({ a: "2024-01-02T03:04:05.000Z" });
    });

    it("converts a text holding an instant into a date, clearing a confirmed value that is no date", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const t = instance as TestNextly;
      await write(t, "kept", { v: "2024-01-02T03:04:05.000Z" });
      await write(t, "lost", { v: "not a date" });

      expect(
        await save(t, [{ name: "v", type: "date" }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toBeUndefined();

      const values = await read(t);
      expect(
        typeof values.kept === "string"
          ? new Date(values.kept).toISOString()
          : values.kept
      ).toBe("2024-01-02T03:04:05.000Z");
      expect(values.lost).toBeNull();
    });

    it("converts texts saying true or false into a checkbox, clearing a confirmed value that says neither", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const t = instance as TestNextly;
      for (const [title, v] of [
        ["t", "true"],
        ["f", "false"],
        ["one", "1"],
        ["zero", "0"],
        ["maybe", "maybe"],
      ] as const) {
        await write(t, title, { v });
      }

      expect(
        await save(t, [{ name: "v", type: "checkbox" }], {
          confirmedClears: [{ field: "v", count: 1 }],
        })
      ).toBeUndefined();

      expect(await read(t)).toEqual({
        t: true,
        f: false,
        one: true,
        zero: false,
        maybe: null,
      });
    });

    it("converts a checkbox into a text saying true or false", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "checkbox" }]);
      const t = instance as TestNextly;
      await write(t, "on", { v: true });
      await write(t, "off", { v: false });

      expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

      expect(await read(t)).toEqual({ on: "true", off: "false" });
    });

    it("converts a text into a JSON value: an object's JSON as the object, any other text as a JSON string", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const t = instance as TestNextly;
      await write(t, "object", { v: '{"a":1}' });
      await write(t, "word", { v: "hello" });

      expect(await save(t, [{ name: "v", type: "json" }])).toBeUndefined();

      expect(await read(t)).toEqual({ object: { a: 1 }, word: "hello" });
    });

    it("converts a JSON value into a text as its JSON", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "json" }]);
      const t = instance as TestNextly;
      await write(t, "object", { v: { a: 1 } });

      expect(await save(t, [{ name: "v", type: "text" }])).toBeUndefined();

      expect(await read(t)).toEqual({ object: '{"a":1}' });
    });

    it("converts a deploy's own dates and checkboxes alike when nextly migrate replays the file", async () => {
      const first = await boot(dialect);
      await createPosts([
        { name: "v", type: "text" },
        { name: "w", type: "text" },
      ]);
      const created = await filesWritten();
      await write(first, "a", { v: "2024-01-02T03:04:05.000Z", w: "true" });
      expect(
        await save(first, [
          { name: "v", type: "date" },
          { name: "w", type: "checkbox" },
        ])
      ).toBeUndefined();
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "b", { v: "1999-12-31T23:59:59.000Z", w: "false" });
      await migrateFolder(second);

      const found = (await second.nextly.find({
        collection: SLUG,
        limit: 10,
      } as never)) as { items: Array<{ v?: unknown; w?: unknown }> };
      const [entry] = found.items;
      expect(
        new Date(
          String(entry?.v instanceof Date ? entry.v.toISOString() : entry?.v)
        ).toISOString()
      ).toBe("1999-12-31T23:59:59.000Z");
      expect(entry?.w).toBe(false);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a required field's values that cannot convert are written as a chosen fill (%s)",
  dialect => {
    it("writes the fill into each lost value of a required field, and converts the rest", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "text", required: true }]);
      const t = instance as TestNextly;
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(
        await save(t, [{ name: "v", type: "number", required: true }], {
          confirmedClears: [{ field: "v", count: 1, fill: 0 }],
        })
      ).toBeUndefined();

      expect(await read(t)).toEqual({ kept: 12, lost: 0 });
    });

    it("refuses a fill the new type cannot hold, and changes nothing", async () => {
      await boot(dialect);
      await createPosts([{ name: "v", type: "text", required: true }]);
      const t = instance as TestNextly;
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      expect(
        await save(t, [{ name: "v", type: "number", required: true }], {
          confirmedClears: [{ field: "v", count: 1, fill: "x" }],
        })
      ).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.v",
              message: expect.stringContaining("fill"),
            }),
          ],
        },
      });

      expect(await read(t)).toEqual({ kept: "12", lost: "abc" });
    });

    it("writes the fill into a deploy's own lost value when nextly migrate replays the file with consent", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text", required: true }]);
      const created = await filesWritten();
      await write(first, "lost", { v: "abc" });
      expect(
        await save(first, [{ name: "v", type: "number", required: true }], {
          confirmedClears: [{ field: "v", count: 1, fill: 0 }],
        })
      ).toBeUndefined();
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "word", { v: "zzz" });
      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );

      expect(await read(second)).toEqual({ whole: 34, word: 0 });
    });
  }
);
