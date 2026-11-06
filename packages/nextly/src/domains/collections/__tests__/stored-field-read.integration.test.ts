/**
 * What a plugin field type's validator can read of stored rows, and on which
 * connection.
 *
 * The read exists so a validator can judge a value against its neighbours as
 * the write sees them, and these pin the three properties that make that true:
 * it reads on the write's own transaction, so a row an earlier entry of the same
 * batch wrote is seen; `draft` is the working draft a preview shows; and it is
 * scoped to the validator's own field type, refused by name otherwise.
 */
import { getTableName } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CollectionConfig } from "../../../collections/config/define-collection";
import { definePlugin } from "../../../plugins/plugin-context";
import type { PluginStoredValue } from "../../../plugins/contributions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { VersionsDbApi } from "../../versions/db-api";
import {
  entryWriteContext,
  type StoredFieldConnection,
} from "../services/stored-field-read";

/** The executor each component-schema resolution was handed, in order. */
const schemaExecutors = vi.hoisted(() => [] as unknown[]);
vi.mock("../../versions/restore-version", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../versions/restore-version")>();
  return {
    ...real,
    resolveComponentSchemas: (
      ...args: Parameters<typeof real.resolveComponentSchemas>
    ) => {
      schemaExecutors.push(args[1]);
      return real.resolveComponentSchemas(...args);
    },
  };
});

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  seen.length = 0;
  judgedIds.length = 0;
  judgedLocales.length = 0;
});

/** What the probe validator read through its write, in the order it read. */
const seen: PluginStoredValue[] = [];

/** The entry id each probe validation was told it is judging. */
const judgedIds: (string | undefined)[] = [];

/** The language each probe validation was told its write is in. */
const judgedLocales: (string | undefined)[] = [];

/** A json-backed type whose validator reads the entry a value names. */
const probe = {
  type: "probe",
  storage: "json",
  component: "@test/probe/admin#Probe",
  async validate(
    value: unknown,
    args: {
      write?: {
        id?: string;
        locale?: string;
        readStored(target: {
          collection: string;
          id: string;
          field: string;
          form: "published" | "draft";
        }): Promise<PluginStoredValue>;
      };
    }
  ) {
    judgedIds.push(args.write?.id);
    judgedLocales.push(args.write?.locale);
    const peek = (value as { peek?: unknown } | null)?.peek;
    if (typeof peek === "string" && args.write !== undefined) {
      seen.push(
        await args.write.readStored({
          collection: "plain",
          id: peek,
          field: "body",
          form: "published",
        })
      );
    }
    return true as const;
  },
} as const;

/** A second json-backed type, which must not reach the first one's values. */
const other = {
  type: "other",
  storage: "json",
  component: "@test/other/admin#Other",
} as const;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const plugin = definePlugin({
    name: "@test/stored-read",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      fieldTypes: [probe, other],
      collections: [
        {
          slug: "plain",
          fields: [
            { name: "title", type: "text" },
            { name: "body", type: "probe" },
            { name: "extra", type: "other" },
          ],
        } as unknown as CollectionConfig,
        {
          slug: "chosen",
          db: { allowIdOnCreate: true },
          fields: [{ name: "body", type: "probe" }],
        } as unknown as CollectionConfig,
        {
          slug: "drafted",
          status: true,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text" },
            { name: "body", type: "probe" },
          ],
        } as unknown as CollectionConfig,
        {
          // The type's fields inside named groups, one inside another, and
          // in a repeater's rows, which a read by path does not walk.
          slug: "grouped",
          status: true,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text" },
            {
              name: "hero",
              type: "group",
              fields: [
                { name: "body", type: "probe" },
                { name: "caption", type: "text" },
                {
                  name: "inner",
                  type: "group",
                  fields: [{ name: "body", type: "probe" }],
                },
                {
                  name: "rows",
                  type: "repeater",
                  fields: [{ name: "body", type: "probe" }],
                },
              ],
            },
          ],
        } as unknown as CollectionConfig,
      ],
    },
  });
  current = await createTestNextly({ dialect, plugins: [plugin] });
  return current;
}

/** Reads as validation on the pool does, scoped to `type`. */
function poolReader(t: TestNextly, type: string) {
  const connection: StoredFieldConnection = {
    db: t.adapter as unknown as VersionsDbApi,
    executor: undefined,
    defaultLocale: null,
  };
  const write = entryWriteContext({
    kind: "collection",
    slug: "plain",
    connection,
  });
  return (target: Parameters<typeof write.readStored>[1]) =>
    write.readStored(type, target);
}

async function created(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<string> {
  const result = await t.nextly.create({
    collection,
    data,
    overrideAccess: true,
  });
  return String((result.item as { id: unknown }).id);
}

/**
 * The probe type beside site content in two languages: a localized collection
 * whose blocks-like field is translated, an unlocalized collection whose field
 * carries the flag anyway (and so is stored on the main row), and a Single.
 */
async function bootLanguages(dialect: TestDialect): Promise<TestNextly> {
  const plugin = definePlugin({
    name: "@test/stored-read-languages",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { fieldTypes: [probe, other] },
  });
  current = await createTestNextly({
    dialect,
    plugins: [plugin],
    collections: [
      {
        slug: "worded",
        localized: true,
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "probe", localized: true },
        ],
      } as unknown as CollectionConfig,
      {
        slug: "flagged",
        fields: [{ name: "body", type: "probe", localized: true }],
      } as unknown as CollectionConfig,
      {
        // A group kept per language, holding the type's field.
        slug: "framed",
        localized: true,
        fields: [
          {
            name: "hero",
            type: "group",
            localized: true,
            fields: [{ name: "body", type: "probe" }],
          },
        ],
      } as unknown as CollectionConfig,
      {
        slug: "staged",
        localized: true,
        status: true,
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "probe", localized: true },
        ],
      } as unknown as CollectionConfig,
    ],
    singles: [
      {
        slug: "site",
        fields: [{ name: "body", type: "probe" }],
      } as never,
    ],
    localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
  });
  return current;
}

/** Reads as validation on the pool does, for a site whose default is English. */
function languagesReader(t: TestNextly, type: string) {
  const connection: StoredFieldConnection = {
    db: t.adapter as unknown as VersionsDbApi,
    executor: undefined,
    defaultLocale: "en",
  };
  const write = entryWriteContext({
    kind: "collection",
    slug: "worded",
    connection,
  });
  return (target: Parameters<typeof write.readStored>[1]) =>
    write.readStored(type, target);
}

describe.each(getConfiguredTestDialects())("on %s", (dialect: TestDialect) => {
  describe("reading stored values of a validator's own field type", () => {
    it("reads the value as stored, and answers absent for an entry that is not there", async () => {
      const t = await boot(dialect);
      const id = await created(t, "plain", { title: "a", body: { v: 1 } });
      const read = poolReader(t, "probe");

      expect(
        await read({
          collection: "plain",
          id,
          field: "body",
          form: "published",
        })
      ).toEqual({ kind: "value", value: { v: 1 } });
      expect(
        await read({
          collection: "plain",
          id: "nope",
          field: "body",
          form: "published",
        })
      ).toEqual({ kind: "absent" });
    });

    it("reads a collection's registry record once per write, however many reads", async () => {
      const t = await boot(dialect);
      const first = await created(t, "plain", { title: "a", body: { v: 1 } });
      const second = await created(t, "plain", { title: "b", body: { v: 2 } });
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(slug: string, executor?: unknown): Promise<unknown>;
      };
      const lookups = vi.spyOn(registry, "getCollectionBySlug");
      const read = poolReader(t, "probe");

      for (const id of [first, second, first]) {
        await read({ collection: "plain", id, field: "body", form: "draft" });
      }
      // A second write context is a second write: it reads the record afresh.
      await poolReader(
        t,
        "probe"
      )({
        collection: "plain",
        id: first,
        field: "body",
        form: "published",
      });

      expect(
        lookups.mock.calls.filter(([slug]) => slug === "plain")
      ).toHaveLength(2);
    });

    it("reads the pending working draft as `draft`, and the live row as `published`", async () => {
      const t = await boot(dialect);
      const id = await created(t, "drafted", {
        title: "a",
        body: { v: "live" },
        status: "published",
      });
      // A status-less save of a published entry is held as a working draft.
      await t.nextly.update({
        collection: "drafted",
        id,
        data: { body: { v: "pending" }, _overwrite: true },
        overrideAccess: true,
      });
      const read = poolReader(t, "probe");

      expect(
        await read({
          collection: "drafted",
          id,
          field: "body",
          form: "published",
        })
      ).toEqual({ kind: "value", value: { v: "live" } });
      expect(
        await read({ collection: "drafted", id, field: "body", form: "draft" })
      ).toEqual({ kind: "value", value: { v: "pending" } });
    });

    it("resolves a working draft's component schemas on the write's own transaction", async () => {
      const t = await boot(dialect);
      const id = await created(t, "drafted", {
        title: "a",
        body: { v: "live" },
        status: "published",
      });
      await t.nextly.update({
        collection: "drafted",
        id,
        data: { body: { v: "pending" }, _overwrite: true },
        overrideAccess: true,
      });
      schemaExecutors.length = 0;

      // Inside a transaction a pooled read could wait behind the very
      // connection the transaction holds, so every read stays on it.
      const executors: unknown[] = [];
      await t.adapter.transaction(async tx => {
        const executor = (
          tx as unknown as { getDrizzle(): unknown }
        ).getDrizzle();
        executors.push(executor);
        const write = entryWriteContext({
          kind: "collection",
          slug: "drafted",
          connection: {
            db: tx as unknown as VersionsDbApi,
            executor,
            defaultLocale: null,
          },
        });
        expect(
          await write.readStored("probe", {
            collection: "drafted",
            id,
            field: "body",
            form: "draft",
          })
        ).toEqual({ kind: "value", value: { v: "pending" } });
      });

      expect(schemaExecutors.length).toBeGreaterThan(0);
      for (const handed of schemaExecutors) {
        expect(handed).toBe(executors[0]);
      }
    });

    it("refuses, by name, a field of another type, or one of its own collection's other fields", async () => {
      const t = await boot(dialect);
      const id = await created(t, "plain", {
        title: "a",
        body: { v: 1 },
        extra: { x: 1 },
      });

      await expect(
        poolReader(
          t,
          "probe"
        )({ collection: "plain", id, field: "title", form: "published" })
      ).rejects.toThrow(/"plain\.title" cannot be read here/);
      await expect(
        poolReader(
          t,
          "probe"
        )({ collection: "plain", id, field: "extra", form: "published" })
      ).rejects.toThrow(/"plain\.extra" cannot be read here/);
    });

    it("refuses another type's validator the values of this type", async () => {
      const t = await boot(dialect);
      const id = await created(t, "plain", { title: "a", body: { v: 1 } });

      await expect(
        poolReader(
          t,
          "other"
        )({ collection: "plain", id, field: "body", form: "published" })
      ).rejects.toThrow(/Only top-level "other" fields/);
    });

    it("reads a field inside named groups by its path, at any depth", async () => {
      const t = await boot(dialect);
      const id = await created(t, "grouped", {
        title: "a",
        hero: { body: { v: "top" }, inner: { body: { v: "deep" } } },
      });
      const bare = await created(t, "grouped", { title: "b" });
      const read = poolReader(t, "probe");
      const at = (entry: string, field: string) =>
        read({ collection: "grouped", id: entry, field, form: "published" });

      expect(await at(id, "hero.body")).toEqual({
        kind: "value",
        value: { v: "top" },
      });
      expect(await at(id, "hero.inner.body")).toEqual({
        kind: "value",
        value: { v: "deep" },
      });
      // An entry whose group stores nothing holds nothing at the path.
      expect(await at(bare, "hero.inner.body")).toEqual({ kind: "absent" });
    });

    it("reads a field inside a named group from the pending working draft as `draft`", async () => {
      const t = await boot(dialect);
      const id = await created(t, "grouped", {
        title: "a",
        hero: { body: { v: "live" }, inner: { body: { v: "live deep" } } },
        status: "published",
      });
      // A status-less save of a published entry is held as a working draft.
      await t.nextly.update({
        collection: "grouped",
        id,
        data: {
          hero: {
            body: { v: "pending" },
            inner: { body: { v: "pending deep" } },
          },
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const read = poolReader(t, "probe");
      const at = (field: string, form: "published" | "draft") =>
        read({ collection: "grouped", id, field, form });

      expect(await at("hero.body", "published")).toEqual({
        kind: "value",
        value: { v: "live" },
      });
      expect(await at("hero.body", "draft")).toEqual({
        kind: "value",
        value: { v: "pending" },
      });
      expect(await at("hero.inner.body", "draft")).toEqual({
        kind: "value",
        value: { v: "pending deep" },
      });
    });

    it("returns a string inside a named group as stored, even one that reads as JSON", async () => {
      // The group's value is decoded once, as the group; a string inside it
      // is the field's value, and decoding it again would turn "123" into a
      // number and "null" into nothing.
      const t = await boot(dialect);
      const id = await created(t, "grouped", {
        title: "a",
        hero: { body: "123", inner: { body: "null" } },
        status: "published",
      });
      const read = poolReader(t, "probe");
      const at = (field: string, form: "published" | "draft") =>
        read({ collection: "grouped", id, field, form });

      expect(await at("hero.body", "published")).toEqual({
        kind: "value",
        value: "123",
      });
      expect(await at("hero.inner.body", "published")).toEqual({
        kind: "value",
        value: "null",
      });

      // The working draft's snapshot is walked the same way.
      await t.nextly.update({
        collection: "grouped",
        id,
        data: {
          hero: { body: "null", inner: { body: "123" } },
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(await at("hero.body", "draft")).toEqual({
        kind: "value",
        value: "null",
      });
      expect(await at("hero.inner.body", "draft")).toEqual({
        kind: "value",
        value: "123",
      });
    });

    it("refuses, by name, a path through anything but named groups, or to a field of another type", async () => {
      const t = await boot(dialect);
      const id = await created(t, "grouped", {
        title: "a",
        hero: { body: { v: 1 }, rows: [{ body: { v: 2 } }] },
      });
      const read = poolReader(t, "probe");
      const at = (field: string) =>
        read({ collection: "grouped", id, field, form: "published" });

      // A repeater's rows are not walked.
      await expect(at("hero.rows[0].body")).rejects.toThrow(
        /"grouped\.hero\.rows\[0\]\.body" cannot be read here: it is not inside named groups alone/
      );
      await expect(at("hero.rows.body")).rejects.toThrow(
        /it is not inside named groups alone/
      );
      // A field that is not a group holds no fields.
      await expect(at("title.body")).rejects.toThrow(
        /it is not inside named groups alone/
      );
      // The type is still the leaf's own.
      await expect(at("hero.caption")).rejects.toThrow(
        /"grouped\.hero\.caption" cannot be read here: it is not a field of that type/
      );
      await expect(at("hero.missing")).rejects.toThrow(
        /it is not a field of that type/
      );
    });

    it("refuses a collection that does not exist, by name", async () => {
      const t = await boot(dialect);

      await expect(
        poolReader(
          t,
          "probe"
        )({ collection: "nowhere", id: "1", field: "body", form: "published" })
      ).rejects.toThrow(
        /"nowhere\.body" cannot be read here: it names no collection/
      );
    });
  });

  describe("the entry a validator is told it is judging", () => {
    it("is the caller's own id on a create where the collection accepts one", async () => {
      const t = await boot(dialect);
      const chosen = "3f0f7a52-2b1e-4c3a-9d55-5f7e9b0c1a2d";

      await t.nextly.create({
        collection: "chosen",
        data: { id: chosen, body: { v: 1 } },
        overrideAccess: true,
      });
      await t.nextly.create({
        collection: "plain",
        data: { id: chosen, title: "x", body: { v: 1 } },
        overrideAccess: true,
      });

      // Where ids are minted by the write, a supplied one is not the identity
      // the row is stored under, so nothing is handed.
      expect(judgedIds).toEqual([chosen, undefined]);
    });
  });

  describe("reading a value stored per language, and a Single's", () => {
    it("reads a localized field in the language asked for, and the default language when none is named", async () => {
      const t = await bootLanguages(dialect);
      const id = await created(t, "worded", {
        title: "a",
        body: { said: "en" },
      });
      await t.nextly.update({
        collection: "worded",
        id,
        locale: "de",
        data: { body: { said: "de" }, _overwrite: true },
        overrideAccess: true,
      } as never);
      const read = languagesReader(t, "probe");
      const at = (locale?: string) =>
        read({
          collection: "worded",
          id,
          field: "body",
          form: "published",
          ...(locale === undefined ? {} : { locale }),
        } as never);

      expect(await at("de")).toEqual({ kind: "value", value: { said: "de" } });
      expect(await at("en")).toEqual({ kind: "value", value: { said: "en" } });
      expect(await at()).toEqual({ kind: "value", value: { said: "en" } });
    });

    it("reads one language's value by selecting that one column, not the whole translation row", async () => {
      const t = await bootLanguages(dialect);
      const id = await created(t, "worded", {
        title: "a",
        body: { said: "en" },
      });
      // Every select a read on the pool makes, with the table it reads. A bare
      // select of the translation table loads every translated column of the
      // row, which a save then pays for each stored form it reads.
      const selects: { projection: unknown; table?: string }[] = [];
      const adapter = t.adapter as unknown as { getDrizzle(): object };
      const drizzle = adapter.getDrizzle();
      vi.spyOn(adapter, "getDrizzle").mockReturnValue(
        new Proxy(drizzle, {
          get(target, property, receiver) {
            const value: unknown = Reflect.get(target, property, receiver);
            if (property !== "select" || typeof value !== "function") {
              return value;
            }
            return (...args: unknown[]) => {
              const seen: { projection: unknown; table?: string } = {
                projection: args[0],
              };
              selects.push(seen);
              const builder = (value as (...a: unknown[]) => object).apply(
                target,
                args
              ) as { from(table: unknown): unknown };
              const from = builder.from.bind(builder);
              builder.from = (table: unknown) => {
                seen.table = getTableName(table as never);
                return from(table);
              };
              return builder;
            };
          },
        })
      );

      const read = await languagesReader(
        t,
        "probe"
      )({
        collection: "worded",
        id,
        field: "body",
        form: "published",
        locale: "en",
      } as never);

      expect(read).toEqual({ kind: "value", value: { said: "en" } });
      const companionReads = selects.filter(seen =>
        seen.table?.endsWith("_locales")
      );
      expect(companionReads.length).toBeGreaterThan(0);
      // Each companion read selects the field's own column and nothing else,
      // whatever key the projection holds it under.
      for (const seen of companionReads) {
        expect(
          Object.values((seen.projection ?? {}) as object).map(
            column => (column as { name?: unknown }).name
          )
        ).toEqual(["body"]);
      }
    });

    it("reads a language's value as stored, whatever that language's status", async () => {
      const t = await bootLanguages(dialect);
      const id = await created(t, "staged", {
        title: "a",
        body: { said: "en" },
        status: "published",
      });
      // A translation kept as a draft: its row is stored with a draft status.
      await t.nextly.update({
        collection: "staged",
        id,
        locale: "de",
        data: { body: { said: "de" }, status: "draft", _overwrite: true },
        overrideAccess: true,
      } as never);

      expect(
        await languagesReader(
          t,
          "probe"
        )({
          collection: "staged",
          id,
          field: "body",
          form: "published",
          locale: "de",
        } as never)
      ).toEqual({ kind: "value", value: { said: "de" } });
    });

    it("answers absent for a language that stores nothing, rather than another language's value", async () => {
      const t = await bootLanguages(dialect);
      const id = await created(t, "worded", {
        title: "a",
        body: { said: "en" },
      });
      const read = languagesReader(t, "probe");

      expect(
        await read({
          collection: "worded",
          id,
          field: "body",
          form: "published",
          locale: "fr",
        } as never)
      ).toEqual({ kind: "absent" });
    });

    it("reads a flagged field of an unlocalized collection from the row, where it is stored", async () => {
      const t = await bootLanguages(dialect);
      const id = await created(t, "flagged", { body: { said: "row" } });
      const read = languagesReader(t, "probe");

      expect(
        await read({
          collection: "flagged",
          id,
          field: "body",
          form: "published",
        })
      ).toEqual({ kind: "value", value: { said: "row" } });
    });

    it("refuses a field inside a group kept per language, by name", async () => {
      const t = await bootLanguages(dialect);
      const read = languagesReader(t, "probe");

      // Refused from the definition alone, before any row is read.
      await expect(
        read({
          collection: "framed",
          id: "any",
          field: "hero.body",
          form: "published",
        })
      ).rejects.toThrow(
        /"framed\.hero\.body" cannot be read here: it is inside a group kept per language/
      );
    });

    it("tells a Single's validators the language the save is in", async () => {
      const t = await bootLanguages(dialect);
      await t.nextly.updateSingle({
        slug: "site",
        locale: "de",
        data: { body: { said: "de" }, _overwrite: true },
        overrideAccess: true,
      } as never);
      await t.nextly.updateSingle({
        slug: "site",
        locale: "en",
        data: { body: { said: "en" }, _overwrite: true },
        overrideAccess: true,
      } as never);

      // The default language is said as none.
      expect(judgedLocales).toEqual(["de", undefined]);
    });

    it("reads a Single's stored value", async () => {
      const t = await bootLanguages(dialect);
      await t.nextly.updateSingle({
        slug: "site",
        data: { body: { said: "single" }, _overwrite: true },
        overrideAccess: true,
      } as never);
      const read = languagesReader(t, "probe");

      expect(
        await read({
          single: "site",
          field: "body",
          form: "published",
        } as never)
      ).toEqual({ kind: "value", value: { said: "single" } });
    });
  });

  describe("the read a validator is handed on a batch write", () => {
    it("sees a row an earlier entry of the same batch wrote", async () => {
      // Read on any other connection, the second entry would see `x` as it was
      // before the batch began, because the batch has not committed.
      const t = await boot(dialect);
      const x = await created(t, "plain", {
        title: "x",
        body: { v: "before" },
      });
      const y = await created(t, "plain", { title: "y", body: { v: 0 } });
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{ failed: number }>;
          };
        }
      ).getEntryService();

      const result = await entries.updateEntries(
        { collectionName: "plain", overrideAccess: true },
        [
          {
            id: x,
            data: { body: { v: "written in the batch" }, _overwrite: true },
          },
          { id: y, data: { body: { peek: x }, _overwrite: true } },
        ],
        { skipHooks: true }
      );

      expect(result.failed).toBe(0);
      expect(seen).toEqual([
        { kind: "value", value: { v: "written in the batch" } },
      ]);
    });
  });
});
