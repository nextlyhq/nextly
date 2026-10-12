/**
 * A collection a field still points at is not deleted, on any path that goes on to drop its table,
 * and the refusal comes before anything is torn down.
 *
 * Every dialect, because the registries read here store a field list as jsonb, as JSON and as text,
 * and the Field Group registry is found by reading the catalog. A reader that parses one of those
 * and not the others refuses nothing on that database.
 *
 * @module domains/collections/__tests__/refuse-dropping-a-referenced-collection.integration.test
 */
import { afterEach, expect, it } from "vitest";

import { handToCodeFirst } from "../../../cli/commands/db-sync-promote";
import { runPrune } from "../../../cli/commands/prune";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionRegistryService } from "../services/collection-registry-service";

const TAGS = "drop_tags";
const POSTS = "drop_posts";
const TAGS_TABLE = `dc_${TAGS}`;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const tags = defineCollection({
  slug: TAGS,
  fields: [text({ name: "label" })],
});
const posts = defineCollection({
  slug: POSTS,
  fields: [
    text({ name: "title" }),
    relationship({ name: "tag", relationTo: TAGS }),
  ],
});

const registryOf = (t: TestNextly) =>
  t.getService("collectionRegistryService") as CollectionRegistryService;

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A code-first collection's row as the Builder leaves one, so a plain delete reaches past the lock. */
async function unlock(t: TestNextly, slug: string): Promise<void> {
  await t.adapter.update(
    "dynamic_collections",
    { locked: 0 },
    { and: [{ column: "slug", op: "=", value: slug }] }
  );
}

/** What a delete rejected with, so the assertion reads the refusal itself. */
async function refusalOf(attempt: Promise<unknown>): Promise<NextlyError> {
  const outcome = await attempt.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!NextlyError.is(outcome)) {
    throw new Error(`expected a NextlyError, got ${String(outcome)}`);
  }
  return outcome;
}

describeEachDialect("deleting a collection a field points at", dialect => {
  it("refuses the Builder's delete, naming every field in every registry, before tearing anything down", async () => {
    // Localized, so a teardown that ran before the refusal would have dropped its companion table.
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: TAGS,
          localized: true,
          fields: [text({ name: "label" })],
        }),
        posts,
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      singles: [
        defineSingle({
          slug: "drop_settings",
          fields: [relationship({ name: "featured", relationTo: TAGS })],
        }),
      ],
      fieldGroups: [
        defineFieldGroup({
          slug: "drop_seo",
          fields: [relationship({ name: "topic", relationTo: TAGS })],
        }),
      ],
    });
    await current.nextly.create({ collection: TAGS, data: { label: "kept" } });

    const result = await handlerOf(current).deleteCollection({
      collectionName: TAGS,
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 409,
      message: `"${TAGS}" cannot be deleted while other fields point at it: ${POSTS}.tag, the Single drop_settings.featured, the Field Group drop_seo.topic. Remove those fields, or point them at another collection, then delete "${TAGS}".`,
    });
    expect(await current.adapter.tableExists(TAGS_TABLE)).toBe(true);
    expect(await current.adapter.tableExists(`${TAGS_TABLE}_locales`)).toBe(
      true
    );
    expect(await registryOf(current).getCollectionBySlug(TAGS)).not.toBeNull();
    expect(
      await current.adapter.select(TAGS_TABLE, { columns: ["id"] })
    ).toHaveLength(1);
  }, 60_000);

  it("refuses the schema route's delete of a Builder collection and keeps its registry row", async () => {
    current = await createTestNextly({ dialect, collections: [tags, posts] });
    await unlock(current, TAGS);
    const registry = registryOf(current);

    const refusal = await refusalOf(registry.deleteCollection(TAGS));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.publicMessage).toBe(
      `"${TAGS}" cannot be deleted while other fields point at it: ${POSTS}.tag. Remove those fields, or point them at another collection, then delete "${TAGS}".`
    );
    expect(await registry.getCollectionBySlug(TAGS)).not.toBeNull();
  }, 60_000);

  it("still deletes a collection nothing points at", async () => {
    // 🔴 The control: the refusals above are about the field that points, not about deleting.
    current = await createTestNextly({ dialect, collections: [tags, posts] });
    await unlock(current, POSTS);
    const registry = registryOf(current);

    await registry.deleteCollection(POSTS);

    expect(await registry.getCollectionBySlug(POSTS)).toBeNull();
  }, 60_000);

  it("lets promotion hand a collection to its code-first definition while fields still point at it", async () => {
    current = await createTestNextly({ dialect, collections: [tags, posts] });
    await unlock(current, TAGS);
    const registry = registryOf(current);

    await handToCodeFirst(registry, TAGS);

    expect(await registry.getCollectionBySlug(TAGS)).toBeNull();
    expect(await current.adapter.tableExists(TAGS_TABLE)).toBe(true);
  }, 60_000);

  it("refuses a prune whose orphan a remaining collection points at, before dropping anything", async () => {
    const plugin = definePlugin({
      name: "@t/drop-refusal",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [tags] },
    });
    current = await createTestNextly({
      dialect,
      plugins: [plugin],
      collections: [posts],
    });
    const registry = registryOf(current);

    const refusal = await refusalOf(
      runPrune({
        registry,
        adapter: current.adapter,
        currentSlugs: [POSTS],
        force: true,
      })
    );

    expect(refusal.publicMessage).toBe(
      `Nothing was deleted, because other fields still point at "${TAGS}" (${POSTS}.tag). Remove those fields, or point them at another collection, then try again.`
    );
    expect(await current.adapter.tableExists(TAGS_TABLE)).toBe(true);
    expect(await registry.getCollectionBySlug(TAGS)).not.toBeNull();
  }, 60_000);

  it("names, in a dry run, the orphans a forced prune would refuse, and drops nothing", async () => {
    const plugin = definePlugin({
      name: "@t/drop-preview",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: { collections: [tags] },
    });
    current = await createTestNextly({
      dialect,
      plugins: [plugin],
      collections: [posts],
    });
    const registry = registryOf(current);

    const result = await runPrune({
      registry,
      adapter: current.adapter,
      currentSlugs: [POSTS],
      force: false,
    });

    expect(result.orphans).toEqual([TAGS]);
    expect(result.blocked).toEqual({
      [TAGS]: [
        { entityType: "collection", entitySlug: POSTS, fieldPath: "tag" },
      ],
    });
    expect(result.dropped).toEqual([]);
    expect(await registry.getCollectionBySlug(TAGS)).not.toBeNull();
  }, 60_000);

  it("prunes orphans that point only at each other, dropping every one", async () => {
    // Each points at the other, so whichever is dropped first still has a field pointing at it
    // until the second goes: only a check that knows they go together lets the prune finish.
    const plugin = definePlugin({
      name: "@t/drop-together",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          defineCollection({
            slug: TAGS,
            fields: [
              text({ name: "label" }),
              relationship({ name: "featured", relationTo: POSTS }),
            ],
          }),
          posts,
        ],
      },
    });
    current = await createTestNextly({ dialect, plugins: [plugin] });
    const registry = registryOf(current);

    const result = await runPrune({
      registry,
      adapter: current.adapter,
      currentSlugs: [],
      force: true,
    });

    expect([...result.dropped].sort()).toEqual([POSTS, TAGS]);
    expect(await registry.getCollectionBySlug(TAGS)).toBeNull();
    expect(await registry.getCollectionBySlug(POSTS)).toBeNull();
    expect(await current.adapter.tableExists(TAGS_TABLE)).toBe(false);
  }, 60_000);
});
