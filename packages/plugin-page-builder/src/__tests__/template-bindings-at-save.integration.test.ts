/**
 * A template's bindings are judged at save against the collection it draws,
 * not against the templates collection it is stored in.
 *
 * What only a server shows: a template is an entry of `templates`, whose own
 * `content` is a blocks field and which has no excerpt, image or author. A
 * Posts template binding a post's body, excerpt, cover image and author saves,
 * as the post's fields fit those props; a binding that misfits in the posts
 * it draws is still refused.
 *
 * @module __tests__/template-bindings-at-save.integration.test
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  relationship,
  richText,
  text,
  textarea,
  upload,
} from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

const POSTS = "tb_posts";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>,
  bindings: Record<string, unknown>
): BlockNode => ({ id, type, version: 1, props, bindings }) as BlockNode;

/** A post's body, excerpt, cover image and author's name, bound. */
const FITTING: readonly BlockNode[] = [
  node("body", "core/rich-text", {}, { content: { $bind: "body" } }),
  node(
    "excerpt",
    "core/heading",
    { text: "", level: "h2" },
    { text: { $bind: "excerpt" } }
  ),
  node("cover", "core/image", {}, { mediaId: { $bind: "cover" } }),
  node(
    "byline",
    "core/heading",
    { text: "", level: "h3" },
    { text: { $bind: "author.name" } }
  ),
];

/** The codes a write is refused with; none when it saves. */
async function refusalCodes(write: Promise<unknown>): Promise<string[]> {
  try {
    await write;
    return [];
  } catch (error) {
    const errors = (
      error as { publicData?: { errors?: Array<{ code: string }> } }
    ).publicData?.errors;
    if (errors === undefined) throw error;
    return errors.map(issue => issue.code).sort();
  }
}

describe.each(getConfiguredTestDialects())(
  "a template's bindings at save (%s)",
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
            slug: POSTS,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              textarea({ name: "excerpt" }),
              richText({ name: "body" }),
              upload({ name: "cover", relationTo: "media" }),
              relationship({ name: "author", relationTo: "users" }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      return current;
    }

    const template = (t: TestNextly, nodes: readonly BlockNode[]) =>
      t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: {
          title: "Posts",
          collection: POSTS,
          status: "published",
          content: { formatVersion: 1, kind: "template", nodes },
        },
        overrideAccess: true,
      });

    it("saves bindings to the fields of the collection it draws", async () => {
      const t = await boot();
      // Judged against `templates`, each was refused: it has no body,
      // excerpt, cover or author, only a blocks `content` and a title.
      expect(await refusalCodes(template(t, FITTING))).toEqual([]);
    });

    it("still refuses a binding that misfits in the collection it draws", async () => {
      const t = await boot();
      // A relation can't fill a heading's text, in the posts it draws.
      expect(
        await refusalCodes(
          template(t, [
            node(
              "author",
              "core/heading",
              { text: "", level: "h2" },
              { text: { $bind: "author" } }
            ),
          ])
        )
      ).toEqual(["binding-type-misfit"]);
    });
  }
);
