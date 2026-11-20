/**
 * The playground's plugins start together, as `pnpm dev:app` starts them: the
 * page builder and the form builder, each with every collection it brings.
 *
 * A start checks each collection's declared indexes against the tables this
 * release keeps, where every text field is kept per language unless it says
 * `localized: false`. An index on a field kept per language names a column the
 * main table lacks, and the start refuses (`VALIDATION_ERROR`). Broken, a
 * plugin indexing a key it keeps per language stops every contributor's start.
 */
import { formBuilder } from "@nextlyhq/plugin-form-builder";
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "@nextlyhq/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

describe.each(getConfiguredTestDialects())(
  "the playground's plugins start together (%s)",
  (dialect: TestDialect) => {
    it("starts with the page builder and the form builder", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({}),
          formBuilder({ redirectRelationships: { pages: "/{slug}" } }).plugin,
        ],
      });
      try {
        // Each form-builder collection the indexes are declared on is served.
        const submissions = await t.nextly.find({
          collection: "form-submissions",
        });
        expect(submissions.items).toEqual([]);
      } finally {
        await t.destroy();
      }
    });
  }
);
