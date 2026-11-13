/**
 * Every Schema Builder change to a registry row moves the stored schema
 * version's count, on every dialect: editing, renaming and deleting a
 * collection, editing and deleting a Single, and editing, changing the fields
 * of and deleting a field group. Creating each, and confirming a collection's
 * schema change, is covered in `schema-version-writers.integration.test.ts`.
 *
 * Another server copy finds out that a registry row changed only through
 * that count (`storedSchemaSeq`): its cached registry rows are filed under
 * the count they were read at, so a change that left it where it was would
 * stay unseen there until some other change moved it. Each case also reads
 * the row afterwards through the registry services, as a request would, and
 * must see the change at once in the process that made it.
 */
import { afterEach, describe, expect, it } from "vitest";

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
import type { Logger } from "../../../shared/types";
import { DynamicCollectionRegistryService } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import { readSchemaVersion } from "../schema-version";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

describe.each(getConfiguredTestDialects())(
  "a Schema Builder change to a registry row (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    const fields = [{ name: "headline", type: "text" }];
    const suffix = dialect.slice(0, 2);
    const noServices = {} as ServiceContainer;

    async function seqOf(t: TestNextly): Promise<number> {
      const stored = await readSchemaVersion(t.adapter.getDrizzle(), dialect);
      return stored.present ? (stored.version?.seq ?? 0) : 0;
    }

    /** Runs `change` and answers whether the stored count moved. */
    async function moves(
      t: TestNextly,
      change: () => Promise<unknown>
    ): Promise<boolean> {
      const before = await seqOf(t);
      await change();
      return (await seqOf(t)) > before;
    }

    function service<T>(t: TestNextly, name: string): T {
      return t.getService(name as never) as T;
    }

    const createCollection = (slug: string) =>
      dispatchCollections(
        noServices,
        "createCollection",
        {},
        { name: slug, label: slug, fields }
      );

    it("editing a collection's settings", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_edit_${suffix}`;
      await createCollection(slug);
      const registry = new DynamicCollectionRegistryService(t.adapter, silent);
      await registry.getCollection(slug);
      expect(
        await moves(t, () =>
          dispatchCollections(
            noServices,
            "updateCollection",
            { collectionName: slug },
            { description: "edited" }
          )
        )
      ).toBe(true);
      expect(
        ((await registry.getCollection(slug)) as { description?: unknown })
          .description
      ).toBe("edited");
    });

    it("renaming a collection", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_from_${suffix}`;
      const renamed = `rcm_to_${suffix}`;
      await createCollection(slug);
      const registry = service<{ getAllSlugs(): Promise<string[]> }>(
        t,
        "collectionRegistryService"
      );
      expect(await registry.getAllSlugs()).toContain(slug);
      expect(
        await moves(t, () =>
          new DynamicCollectionRegistryService(
            t.adapter,
            silent
          ).updateCollectionMetadata(slug, { slug: renamed })
        )
      ).toBe(true);
      expect(await registry.getAllSlugs()).toContain(renamed);
    });

    it("renaming a Single", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_sfrom_${suffix}`;
      const renamed = `rcm_sto_${suffix}`;
      await dispatchSingles("createSingle", {}, { slug, label: slug, fields });
      const registry = service<{
        getAllSlugs(): Promise<string[]>;
        updateSingle(
          slug: string,
          data: { slug: string },
          options: { source: string }
        ): Promise<unknown>;
      }>(t, "singleRegistryService");
      expect(await registry.getAllSlugs()).toContain(slug);
      expect(
        await moves(t, () =>
          registry.updateSingle(slug, { slug: renamed }, { source: "ui" })
        )
      ).toBe(true);
      expect(await registry.getAllSlugs()).toContain(renamed);
    });

    it("deleting a collection", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_gone_${suffix}`;
      await createCollection(slug);
      const registry = service<{ getAllSlugs(): Promise<string[]> }>(
        t,
        "collectionRegistryService"
      );
      expect(await registry.getAllSlugs()).toContain(slug);
      expect(
        await moves(t, () =>
          dispatchCollections(
            noServices,
            "deleteCollection",
            { collectionName: slug },
            undefined
          )
        )
      ).toBe(true);
      expect(await registry.getAllSlugs()).not.toContain(slug);
    });

    it("editing a Single's settings", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_single_${suffix}`;
      await dispatchSingles("createSingle", {}, { slug, label: slug, fields });
      const registry = service<{
        getSingleBySlug(slug: string): Promise<{ label?: unknown } | null>;
      }>(t, "singleRegistryService");
      await registry.getSingleBySlug(slug);
      expect(
        await moves(t, () =>
          dispatchSingles("updateSingleSchema", { slug }, { label: "Edited" })
        )
      ).toBe(true);
      expect((await registry.getSingleBySlug(slug))?.label).toBe("Edited");
    });

    it("deleting a Single", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_single_gone_${suffix}`;
      await dispatchSingles("createSingle", {}, { slug, label: slug, fields });
      const registry = service<{ getAllSlugs(): Promise<string[]> }>(
        t,
        "singleRegistryService"
      );
      expect(await registry.getAllSlugs()).toContain(slug);
      expect(
        await moves(t, () =>
          dispatchSingles("deleteSingle", { slug }, undefined)
        )
      ).toBe(true);
      expect(await registry.getAllSlugs()).not.toContain(slug);
    });

    it("editing a field group's settings", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_group_${suffix}`;
      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields }
      );
      const registry = service<{
        getComponentBySlug(slug: string): Promise<{ label?: unknown } | null>;
      }>(t, "fieldGroupRegistryService");
      await registry.getComponentBySlug(slug);
      expect(
        await moves(t, () =>
          dispatchComponents("updateComponent", { slug }, { label: "Edited" })
        )
      ).toBe(true);
      expect((await registry.getComponentBySlug(slug))?.label).toBe("Edited");
    });

    it("changing a field group's fields", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_group_fields_${suffix}`;
      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields }
      );
      const registry = service<{
        getComponentBySlug(slug: string): Promise<{ fields?: unknown } | null>;
      }>(t, "fieldGroupRegistryService");
      await registry.getComponentBySlug(slug);
      expect(
        await moves(t, () =>
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug },
            {
              fields: [...fields, { name: "summary", type: "text" }],
              confirmed: true,
              schemaVersion: 1,
            }
          )
        )
      ).toBe(true);
      expect(
        JSON.stringify((await registry.getComponentBySlug(slug))?.fields)
      ).toContain("summary");
    });

    it("deleting a field group", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const slug = `rcm_group_gone_${suffix}`;
      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields }
      );
      const registry = service<{ getAllSlugs(): Promise<string[]> }>(
        t,
        "fieldGroupRegistryService"
      );
      expect(await registry.getAllSlugs()).toContain(slug);
      expect(
        await moves(t, () =>
          dispatchComponents("deleteComponent", { slug }, undefined)
        )
      ).toBe(true);
      expect(await registry.getAllSlugs()).not.toContain(slug);
    });
  }
);
