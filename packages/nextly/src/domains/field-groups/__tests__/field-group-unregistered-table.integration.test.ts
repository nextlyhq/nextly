/**
 * A field group whose table this running instance has not registered is not
 * written to, on every dialect.
 *
 * The boot leaves a field group's table unregistered when it cannot read the
 * table's discriminator column, and an instance that started before a deploy
 * added the group holds none for it. The stored instances then cannot be read,
 * and an update used to take that for "none stored" and insert a second
 * instance beside the first. Each case boots with an entry holding one
 * instance, takes the table out of the registry, and counts the instance rows
 * with raw SQL, since the model cannot be asked about a table it does not hold.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import type { SchemaRegistry } from "../../../database/schema-registry";
import { missingSchemaObject } from "../../../database/missing-column";
import { reloadDynamicTables } from "../../../init/reload-dynamic-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const GROUP = "fgu_hero";
const PAGES = "fgu_pages";
const GROUP_TABLE = `comp_${GROUP}`;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface DirectApi {
  create(args: Record<string, unknown>): Promise<{ item: { id: string } }>;
  update(args: Record<string, unknown>): Promise<unknown>;
}

async function boot(dialect: TestDialect): Promise<{ id: string }> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({ slug: GROUP, fields: [text({ name: "heading" })] }),
    ],
    collections: [
      defineCollection({
        slug: PAGES,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: GROUP }),
        ],
      }),
    ],
  });
  const created = await (current.nextly as unknown as DirectApi).create({
    collection: PAGES,
    data: { title: "Home", hero: { heading: "One" } },
  });
  return { id: created.item.id };
}

/** The stored instances' headings, read past the model. */
async function storedHeadings(): Promise<string[]> {
  const rows = (await (
    current!.adapter as unknown as {
      executeQuery(sql: string): Promise<Array<{ heading: unknown }>>;
    }
  ).executeQuery(`SELECT heading FROM ${GROUP_TABLE}`)) as Array<{
    heading: unknown;
  }>;
  return rows.map(row => String(row.heading));
}

describe.each(getConfiguredTestDialects())(
  "a field group whose table this instance has not registered (%s)",
  dialect => {
    it("refuses an update of the entry's instance and writes no second one", async () => {
      const { id } = await boot(dialect);
      expect(await storedHeadings()).toEqual(["One"]);
      const registry = current!.getService(
        "schemaRegistry" as never
      ) as SchemaRegistry;
      registry.retractDynamicSchema(GROUP_TABLE);

      const refusal = await (current!.nextly as unknown as DirectApi)
        .update({ collection: PAGES, id, data: { hero: { heading: "Two" } } })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      // The refusal is the not-registered one, read as every not-migrated
      // answer reads it, not some other failure on the way.
      expect(missingSchemaObject(refusal)?.object).toBe("unregistered");
      expect(await storedHeadings()).toEqual(["One"]);
    }, 120_000);

    it("writes the instance in place once the registry is reloaded", async () => {
      const { id } = await boot(dialect);
      const registry = current!.getService(
        "schemaRegistry" as never
      ) as SchemaRegistry;
      registry.retractDynamicSchema(GROUP_TABLE);
      // What a migration's apply does before the instance serves again.
      await reloadDynamicTables("[test]");

      await (current!.nextly as unknown as DirectApi).update({
        collection: PAGES,
        id,
        data: { hero: { heading: "Two" } },
      });
      expect(await storedHeadings()).toEqual(["Two"]);
    }, 120_000);
  }
);
