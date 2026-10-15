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
import { afterEach, describe, expect, it } from "vitest";

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

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  seen.length = 0;
});

/** What the probe validator read through its write, in the order it read. */
const seen: PluginStoredValue[] = [];

/** A json-backed type whose validator reads the entry a value names. */
const probe = {
  type: "probe",
  storage: "json",
  component: "@test/probe/admin#Probe",
  async validate(
    value: unknown,
    args: {
      write?: {
        readStored(target: {
          collection: string;
          id: string;
          field: string;
          form: "published" | "draft";
        }): Promise<PluginStoredValue>;
      };
    }
  ) {
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
          slug: "drafted",
          status: true,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text" },
            { name: "body", type: "probe" },
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
        data: { body: { v: "pending" } },
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
          { id: x, data: { body: { v: "written in the batch" } } },
          { id: y, data: { body: { peek: x } } },
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
