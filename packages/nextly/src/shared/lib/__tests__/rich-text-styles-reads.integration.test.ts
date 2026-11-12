/**
 * `richTextStyles` reaches the HTML on every way a site reads rich text: the
 * converter called from code, the Direct API, and REST, for a collection entry
 * and a Single, on every configured dialect. Each read is made with the option
 * and without, and the class-only HTML is the same whichever way it was read.
 *
 * @module shared/lib/__tests__/rich-text-styles-reads.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import type { RichTextValue } from "../../../collections/fields/types/rich-text";
import {
  defineCollection,
  defineSingle,
  richText,
  text,
} from "../../../config";
import { ServiceDispatcher } from "../../../dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { convertRichTextToHtml } from "../rich-text-html";

const POSTS = "rtsposts";
const HOME = "rtshome";

/** A centred paragraph with bold text: an element class, a mark class and alignment. */
const BODY = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        format: "center",
        children: [{ type: "text", text: "Hi", format: 1 }],
      },
    ],
  },
} as unknown as RichTextValue;

const CLASS_ONLY =
  '<p class="nextly-rich-text-paragraph nextly-rich-text-align-center"><strong class="nextly-rich-text-bold">Hi</strong></p>';
const DEFAULT = convertRichTextToHtml(BODY);

// Readable by anyone, so the REST reads below, made with no signed-in user,
// are judged as a visitor's and allowed.
const posts = defineCollection({
  slug: POSTS,
  fields: [text({ name: "title" }), richText({ name: "body" })],
  access: { read: () => true },
});
const home = defineSingle({
  slug: HOME,
  fields: [richText({ name: "body" })],
  access: { read: () => true },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [posts],
    singles: [home],
    // The boot's seeding: the Public role, granted the reads whose rule
    // answers `true`, so the REST reads below are a visitor's.
    seedPublic: true,
  });
  const entries = (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService();
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "One", body: BODY }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  // A first write with no read before it: nothing to say which version it
  // replaces, so it says it replaces whatever is stored.
  await current.nextly.updateSingle({
    slug: HOME,
    data: { body: BODY, _overwrite: true },
  });
  return (created.data as { id: string }).id;
}

/** A REST read through the dispatcher the route handler calls, as JSON. */
async function rest(
  service: "collections" | "singles",
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const result = await new ServiceDispatcher().dispatch({
    service,
    operation: "single",
    method,
    params,
  });
  expect(result.success, JSON.stringify(result.error)).toBe(true);
  return (result.data as Response).json();
}

const bodyOf = (doc: unknown): unknown => (doc as { body: unknown }).body;

describe.each(getConfiguredTestDialects())(
  "class-only rich text HTML on %s",
  dialect => {
    it("reaches every read of an entry, with the option and without", async () => {
      const id = await boot(dialect);
      const nextly = current!.nextly;
      const html = { richTextFormat: "html" } as const;
      const none = { ...html, richTextStyles: "none" } as const;

      expect(convertRichTextToHtml(BODY, { styles: "none" })).toBe(CLASS_ONLY);

      const found = await nextly.find({ collection: POSTS, ...none });
      expect(bodyOf(found.items[0])).toBe(CLASS_ONLY);
      const foundDefault = await nextly.find({ collection: POSTS, ...html });
      expect(bodyOf(foundDefault.items[0])).toBe(DEFAULT);

      const byId = await nextly.findByID({ collection: POSTS, id, ...none });
      expect(bodyOf(byId)).toBe(CLASS_ONLY);

      const both = await nextly.findByID({
        collection: POSTS,
        id,
        richTextFormat: "both",
        richTextStyles: "none",
      });
      expect(bodyOf(both)).toEqual({ json: BODY, html: CLASS_ONLY });

      const listed = (await rest("collections", "listEntries", {
        collectionName: POSTS,
        richTextFormat: "html",
        richTextStyles: "none",
      })) as { items: unknown[] };
      expect(bodyOf(listed.items[0])).toBe(CLASS_ONLY);

      const read = await rest("collections", "getEntry", {
        collectionName: POSTS,
        entryId: id,
        richTextFormat: "html",
        richTextStyles: "none",
      });
      expect(bodyOf(read)).toBe(CLASS_ONLY);

      const readDefault = await rest("collections", "getEntry", {
        collectionName: POSTS,
        entryId: id,
        richTextFormat: "html",
      });
      expect(bodyOf(readDefault)).toBe(DEFAULT);
    });

    it("reaches every read of a Single, with the option and without", async () => {
      await boot(dialect);
      const nextly = current!.nextly;

      const single = await nextly.findSingle({
        slug: HOME,
        richTextFormat: "html",
        richTextStyles: "none",
      });
      expect(bodyOf(single)).toBe(CLASS_ONLY);
      const singleDefault = await nextly.findSingle({
        slug: HOME,
        richTextFormat: "html",
      });
      expect(bodyOf(singleDefault)).toBe(DEFAULT);

      const read = await rest("singles", "getSingleDocument", {
        slug: HOME,
        richTextFormat: "html",
        richTextStyles: "none",
      });
      expect(bodyOf(read)).toBe(CLASS_ONLY);
    });
  }
);
