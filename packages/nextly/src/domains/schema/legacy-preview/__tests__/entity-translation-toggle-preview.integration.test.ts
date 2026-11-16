/**
 * Turning a collection's translation on or off in the Schema Builder is a schema change, even when
 * no field changes otherwise: each field translated by default moves between the main table and the
 * translations table. The preview says so (`hasChanges`), so the Builder opens its confirmation and
 * the save runs the change, rather than taking its no-changes path and storing the setting alone.
 *
 * The fields here are stored as the REST API, the Direct API or code store them, with no
 * `required`, `unique` or `localized` setting, and sent back as the Builder sends them, with each.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

const STORED = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];

/** The same fields as the Builder sends them back, otherwise unchanged. */
const FROM_BUILDER = [
  { name: "heading", type: "text", required: false, unique: false },
  { name: "views", type: "number", required: false, unique: false },
];

async function bodyOf(response: unknown): Promise<{ hasChanges: boolean }> {
  const data = (await (response as Response).json()) as {
    hasChanges: boolean;
    data?: { hasChanges: boolean };
  };
  return data.data ?? data;
}

describeEachDialect(
  "the preview of a collection's translation turned on or off",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    async function seed(localized: boolean): Promise<void> {
      const handler = current.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
      const created = await handler.createCollection({
        name: "posts",
        label: "Post",
        localized,
        fields: STORED,
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
    }

    const preview = (body: Record<string, unknown>) =>
      dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        body
      ).then(bodyOf);

    it("reports a change when translation is turned on and no field changes otherwise", async () => {
      await seed(false);

      const shown = await preview({ fields: FROM_BUILDER, localized: true });

      expect(shown.hasChanges).toBe(true);
    });

    it("reports a change when translation is turned off and no field changes otherwise", async () => {
      await seed(true);

      const shown = await preview({ fields: FROM_BUILDER, localized: false });

      expect(shown.hasChanges).toBe(true);
    });

    it("reports no change when the setting and the fields stay as they are", async () => {
      await seed(false);

      const shown = await preview({ fields: FROM_BUILDER, localized: false });

      expect(shown.hasChanges).toBe(false);
    });
  }
);
