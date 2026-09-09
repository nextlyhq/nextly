/**
 * Whether the usage index can answer "how many PAGES use this component".
 *
 * The index stores one row per place a component is referenced — per field,
 * per locale, and per stored variant — so a page that uses one component in
 * two languages and holds a pending draft contributes several rows. Counting
 * rows would therefore report a number no author could reconcile with what
 * they see, and it would climb every time somebody adds a translation.
 *
 * The question is a COUNT OF DISTINCT DOCUMENTS, and this suite is the round
 * trip that establishes the database can answer it. Two things are being
 * checked at once and only a real database can separate them: that the grouped
 * read returns a bucket per document rather than per row, and that it is
 * willing to run against this collection at all — the index denies every access
 * rule it declares, so a read that is not trusted sees nothing and answers a
 * confident zero.
 *
 * Per dialect, because grouping is SQL the adapters generate rather than
 * behaviour this package implements.
 *
 * @module __tests__/component-usage-count.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { usageCountReader } from "../class-usage-runtime";
import { COMPONENT_USAGE_INDEX_SLUG } from "../collections/component-usage-index";
import { componentUsageCount } from "../component-usage";
import { pageBuilder } from "../plugin";

/** One stored reference, in the shape the maintenance path writes. */
const row = (over: {
  entityKey: string;
  componentId: string;
  locale?: string;
  variant?: string;
}) => ({
  scope: "collection",
  entity: "pages",
  field: "content",
  locale: over.locale ?? "",
  variant: over.variant ?? "published",
  kind: "reference",
  entityKey: over.entityKey,
  componentId: over.componentId,
});

describe.each(getConfiguredTestDialects())(
  "counting the pages that use a component (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    it("counts DOCUMENTS, not the rows a document contributes", async () => {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const nextly = current.nextly;

      // Four rows over TWO pages. `page-1` carries three of them — a second
      // language and a pending draft — which is exactly the multiplicity a row
      // count would report as three separate pages.
      const rows = [
        row({ entityKey: "page-1", componentId: "header" }),
        row({ entityKey: "page-1", componentId: "header", locale: "fr" }),
        row({ entityKey: "page-1", componentId: "header", variant: "draft" }),
        row({ entityKey: "page-2", componentId: "header" }),
        // The CONTROL on the filter. Without a row for another component, a
        // grouped read that ignored `where` would answer 2 here and look
        // correct.
        row({ entityKey: "page-9", componentId: "footer" }),
      ];
      for (const data of rows) {
        await nextly.create({
          collection: COMPONENT_USAGE_INDEX_SLUG,
          data,
          overrideAccess: true,
        });
      }

      // Through the SHIPPED entry point, not a hand-written grouped read. A
      // probe that composed the query itself would prove the database can
      // answer and say nothing about whether the code a host calls asks it
      // correctly — the predicate, the group key and the trusted read are
      // exactly what this has to get right.
      const count = await componentUsageCount({
        read: usageCountReader(nextly, COMPONENT_USAGE_INDEX_SLUG),
        componentId: "header",
      });

      expect(count).toEqual({ documents: 2, complete: true });
    });

    it("answers zero for a component nothing references", async () => {
      // The control for the case above: a grouped read that returned every row
      // regardless of the filter would satisfy it while being unable to tell
      // an unused component from a used one.
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const nextly = current.nextly;

      await nextly.create({
        collection: COMPONENT_USAGE_INDEX_SLUG,
        data: row({ entityKey: "page-1", componentId: "header" }),
        overrideAccess: true,
      });

      const count = await componentUsageCount({
        read: usageCountReader(nextly, COMPONENT_USAGE_INDEX_SLUG),
        componentId: "never-placed",
      });

      expect(count).toEqual({ documents: 0, complete: true });
    });
  }
);
