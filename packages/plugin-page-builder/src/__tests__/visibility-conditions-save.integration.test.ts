/**
 * A block's visibility conditions, judged on a real save against the schema
 * and the public's read access: a condition on a field visitors may not read
 * is refused, since whether the block shows would reveal the field's value,
 * and one on a public field saves. A condition the stored page already held
 * is kept through an edit: `fields/blocksField.conditions.test.ts` and
 * `fields/list-query-judgement.test.ts` hold that, since no supported write
 * stores a page past this judgement.
 *
 * What only a server shows: the field validation behind every save reads the
 * collection's fields and the public's access, which no unit test holds.
 *
 * @module __tests__/visibility-conditions-save.integration.test
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

const ARTICLES = "vc_articles";

/** A page whose one block shows only when `conditions` hold. */
const contentOf = (conditions: unknown, title = "Hello") => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: title, level: 2 },
    },
    {
      id: "members",
      type: "core/box",
      version: 1,
      props: {},
      visibility: { conditions },
    },
  ],
});

const onSecret = [[{ field: "secret", op: "exists" }]];
const onTier = [[{ field: "tier", op: "equals", value: "vip" }]];

describe.each(getConfiguredTestDialects())(
  "a block's conditions on a save (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: ARTICLES,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "tier" }),
              text({ name: "secret", access: { read: () => false } }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      return current;
    }

    function create(t: TestNextly, conditions: unknown) {
      return t.nextly.create({
        collection: ARTICLES,
        data: { title: "A", content: contentOf(conditions) },
        overrideAccess: true,
      });
    }

    it("refuses a condition on a field visitors can't read, and saves one on a public field", async () => {
      const t = await boot();
      await expect(create(t, onSecret)).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({
              code: "condition-field-protected",
              message: expect.stringContaining("visitors can't see"),
            }),
          ],
        },
      });
      const saved = await create(t, onTier);
      expect(JSON.stringify(saved.item.content)).toContain('"tier"');
    });
  }
);
