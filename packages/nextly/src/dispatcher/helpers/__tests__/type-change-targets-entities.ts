/**
 * The Schema Builder's type picker as the tests ask it: the list each kind's route answers with, and
 * the three kinds of entity a case is asked of, each with the Builder's own create and save.
 */
import { expect } from "vitest";

import type { TestNextly } from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { dispatchCollections } from "../../handlers/collection-dispatcher";
import { dispatchComponents } from "../../handlers/component-dispatcher";
import { dispatchSingles } from "../../handlers/single-dispatcher";

export const DB = {
  migrationsDir: "./migrations",
  uiSchemaFile: "./ui-schema.json",
};
export const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

export type Field = Record<string, unknown>;
type Refusal = { code: string; reason: string; steps: string[] };
type Target = {
  type: string;
  blocked: string | null;
  outcome: string | null;
  refusal: Refusal | null;
};

/** The picker's answer, read as the admin reads it: a list whose total counts its items. */
async function itemsOf(answer: unknown): Promise<Target[]> {
  const body = (await (answer as Response).json()) as {
    items: Target[];
    meta: { total: number };
  };
  expect(body.meta.total).toBe(body.items.length);
  return body.items;
}

/** What the picker asks of a saved field, `type` being the type it is saved as. */
export async function targetsOf(
  slug: string,
  field: string[],
  type: string
): Promise<Target[]> {
  return itemsOf(
    await dispatchCollections(
      {} as ServiceContainer,
      "typeChangeTargets",
      { collectionName: slug },
      { field, type }
    )
  );
}

/** Where a case's change is asked and made: the picker's route and the Builder's own save. */
export interface Entity {
  kind: "collection" | "Single" | "field group";
  create(field: Field): Promise<void>;
  /** The picker's answer for `field` as saved. */
  targets(field: Field): Promise<Target[]>;
  save(field: Field): Promise<unknown>;
}

export const collection = (t: TestNextly): Entity => ({
  kind: "collection",
  create: async field => {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: "tct_agree", label: "Post", fields: [field] }
    );
  },
  targets: field => targetsOf("tct_agree", ["v"], String(field.type)),
  save: async field => {
    const [row] = await (
      t.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<{ v: number | string | null }>(
      "SELECT schema_version AS v FROM dynamic_collections WHERE slug = 'tct_agree'"
    );
    return dispatchCollections(
      {} as ServiceContainer,
      "applySchemaChanges",
      { collectionName: "tct_agree" },
      { fields: [field], confirmed: true, schemaVersion: Number(row?.v ?? 1) }
    );
  },
});

export const single = (t: TestNextly): Entity => ({
  kind: "Single",
  create: async field => {
    await dispatchSingles(
      "createSingle",
      {},
      { slug: "tct_home", label: "Home", fields: [field] }
    );
  },
  targets: async field =>
    itemsOf(
      await dispatchSingles(
        "singleTypeChangeTargets",
        { slug: "tct_home" },
        { field: ["v"], type: String(field.type) }
      )
    ),
  save: async field => {
    const stored = await t
      .getService("singleRegistryService")
      .getSingleBySlug("tct_home");
    return dispatchSingles(
      "applySingleSchemaChanges",
      { slug: "tct_home" },
      {
        fields: [field],
        confirmed: true,
        schemaVersion: stored?.schemaVersion ?? 1,
      }
    );
  },
});

export const fieldGroup = (t: TestNextly): Entity => ({
  kind: "field group",
  create: async field => {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: "tct_box", label: "Box", fields: [field] }
    );
  },
  targets: async field =>
    itemsOf(
      await dispatchComponents(
        "componentTypeChangeTargets",
        { slug: "tct_box" },
        { field: ["v"], type: String(field.type) }
      )
    ),
  save: async field => {
    const { schemaVersion } = await t
      .getService("fieldGroupRegistryService")
      .getComponent("tct_box");
    return dispatchComponents(
      "applyComponentSchemaChanges",
      { slug: "tct_box" },
      { fields: [field], confirmed: true, schemaVersion }
    );
  },
});
