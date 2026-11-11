/**
 * A Single with a required relationship or upload can be read before anyone has chosen what it
 * points at, on every dialect, whether code declares it or the Schema Builder made it.
 *
 * A Single's one entry is created on its first read, from its fields' defaults, and a reference has
 * no default to give: it starts empty. So its column has to accept that empty value, required or
 * not; the requirement is the entry's, checked when it is saved.
 */
import { afterEach, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const TAGS = defineCollection({
  slug: "tags",
  fields: [text({ name: "name" })],
});

describeEachDialect(
  "a Single with a required relationship, read for the first time",
  dialect => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      vi.unstubAllEnvs();
    });

    const singles = (): SingleEntryService =>
      current!.getService("singleEntryService");

    it("is created and read when code declares it", async () => {
      current = await createTestNextly({
        dialect,
        collections: [TAGS],
        singles: [
          defineSingle({
            slug: "banner",
            fields: [
              text({ name: "headline" }),
              relationship({ name: "tag", relationTo: "tags", required: true }),
            ],
          }),
        ],
      });

      const read = await singles().get("banner", { overrideAccess: true });

      expect(read.success, JSON.stringify(read)).toBe(true);
    });

    it("is created and read when the Schema Builder made it", async () => {
      // The builder's paths run their migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [TAGS] });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "banner",
          label: "Banner",
          fields: [
            { name: "headline", type: "text" },
            {
              name: "tag",
              type: "relationship",
              required: true,
              options: { relationType: "manyToOne", target: "tags" },
            },
          ],
        }
      );

      const read = await singles().get("banner", { overrideAccess: true });

      expect(read.success, JSON.stringify(read)).toBe(true);
    });
  }
);
