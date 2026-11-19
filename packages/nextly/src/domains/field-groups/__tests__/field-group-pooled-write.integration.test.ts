/**
 * The pooled field-group save hands the host write to each instance's
 * validators, as the save inside a transaction does.
 *
 * `saveComponentData` is the pooled door to a field group's rows, reachable
 * through the service a host or plugin asks for. A validator that judges a
 * value by the write it belongs to (who makes it, which entry it is for)
 * refuses one that arrives with no write behind it, so the pooled door left a
 * permitted write refused, in every field group kind and at every depth.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  pluginField,
  text,
} from "../../../config";
import type { FieldConfig } from "../../../collections/fields/types";
import type {
  PluginFieldValidateArgs,
  PluginStoredValue,
} from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { EntryWriteContext } from "../../../shared/lib/entry-validation";
import type { FieldGroupDataService } from "../services/field-group-data-service";
import { writeFieldGroupType } from "../storage/field-group-type-key";

const PAGES = "pooledwritepages";

/** What each validator was handed of the write, in the order it ran. */
let seen: Array<{ readonly slug?: string; readonly inFieldGroup?: boolean }> =
  [];

/**
 * A field type judged by the write it belongs to: refused without one, as a
 * value only some writers may set is.
 */
const writeAwarePlugin = definePlugin({
  name: "@test/write-aware",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    fieldTypes: [
      {
        type: "write-aware",
        storage: "text",
        component: "@test/write-aware/admin#WriteAwareInput",
        validate: (_value: unknown, args: PluginFieldValidateArgs) => {
          seen.push({
            slug: args.write?.slug,
            inFieldGroup: args.write?.inFieldGroup,
          });
          return args.write === undefined
            ? "Judged only within the write it belongs to"
            : true;
        },
      },
    ],
  },
});

const pages = defineCollection({
  slug: PAGES,
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "one", component: "pooledmark" }),
    fieldGroup({ name: "many", component: "pooledmark", repeatable: true }),
    fieldGroup({
      name: "zone",
      components: ["pooledmark", "pooledholder"],
      repeatable: true,
    }),
  ],
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  seen = [];
});

/** Boots the site and stores an entry with no field-group values yet. */
async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [writeAwarePlugin],
    fieldGroups: [
      defineFieldGroup({
        slug: "pooledmark",
        fields: [pluginField({ name: "mark", type: "write-aware" })],
      }),
      // An instance holding a field group of its own, saved a level down.
      defineFieldGroup({
        slug: "pooledholder",
        fields: [fieldGroup({ name: "nested", component: "pooledmark" })],
      }),
    ],
    collections: [pages],
  });
  const entries = (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService();
  const created = await entries.createEntry(
    { collectionName: PAGES, overrideAccess: true },
    { title: "Home" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  return (created.data as { id: string }).id;
}

/** The host write a caller of the pooled save hands it: this entry's update. */
function hostWrite(id: string): EntryWriteContext {
  const nothing: PluginStoredValue = { kind: "absent" };
  return {
    kind: "collection",
    slug: PAGES,
    id,
    inTransaction: false,
    readStored: () => Promise.resolve(nothing),
    readStoredOf: () => Promise.resolve(new Map()),
  };
}

/** One instance of a dynamic zone, typed as the zone stores it. */
function typed(
  type: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const instance = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

/** A value in every kind of field group, and one a level down. */
const DATA = {
  one: { mark: "a" },
  many: [{ mark: "b" }, { mark: "c" }],
  zone: [
    typed("pooledmark", { mark: "d" }),
    typed("pooledholder", { nested: { mark: "e" } }),
  ],
};

describe.each(getConfiguredTestDialects())(
  "the pooled field-group save (integration, %s)",
  dialect => {
    it("hands each instance's validators the host write, at every depth", async () => {
      const id = await boot(dialect);
      const service = current!.getService(
        "fieldGroupDataService"
      ) as FieldGroupDataService;
      await service.saveComponentData({
        parentId: id,
        parentTable: `dc_${PAGES}`,
        fields: pages.fields as FieldConfig[],
        data: DATA,
        access: { overrideAccess: true },
        write: hostWrite(id),
      });
      // Five values: the single, the two repeated, the zone's own, and the
      // one inside the zone's holder. Each saw the host's write, as one in a
      // field-group instance.
      expect(seen).toHaveLength(5);
      expect(seen).toEqual(
        Array.from({ length: 5 }, () => ({ slug: PAGES, inFieldGroup: true }))
      );
    });

    it("refuses the same values when no write is handed to it", async () => {
      // The control: the validator runs on this path and refuses a value with
      // no write, so the case above passing is the write arriving.
      const id = await boot(dialect);
      const service = current!.getService(
        "fieldGroupDataService"
      ) as FieldGroupDataService;
      await expect(
        service.saveComponentData({
          parentId: id,
          parentTable: `dc_${PAGES}`,
          fields: pages.fields as FieldConfig[],
          data: { one: { mark: "a" } },
          access: { overrideAccess: true },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  }
);
