/**
 * The canvas's reader against a real database, beside the published page's.
 *
 * One collection, read three ways, on every configured dialect:
 * - as an editor whose read rule leaves out one team's entries: their drafts
 *   are listed, the entry they may not read is not, and a field only signed-in
 *   people may read comes back to them;
 * - as a person with no read permission: refused, as in the admin;
 * - as the published page reads it (the public reader): published entries
 *   only and public fields only, so a draft value the editor sees never
 *   reaches it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createEditorReader } from "../editor-reader";
import { createPublicReader } from "../public-reader";

const SLUG = "erd_posts";

describe.each(getConfiguredTestDialects())(
  "the canvas's reader beside the published page's (%s)",
  dialect => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            access: {
              // A signed-in reader sees every team but HR's; a visitor reads
              // what is published.
              read: ({ user }) =>
                user === undefined || user === null
                  ? true
                  : { team: { not_equals: "hr" } },
            },
            fields: [
              text({ name: "title" }),
              text({ name: "team" }),
              text({
                name: "internalNote",
                access: { read: ({ user }) => Boolean(user) },
              }),
            ],
          }),
        ],
      });
      for (const row of [
        { title: "Live", team: "web", status: "published" },
        { title: "Draft idea", team: "web", status: "draft" },
        { title: "HR only", team: "hr", status: "published" },
      ]) {
        await t.nextly.create({
          collection: SLUG,
          data: { ...row, internalNote: `note for ${row.title}` },
        });
      }
      await userWhoMay(t, "editor", "read", [SLUG]);
      await userWhoMay(t, "outsider", "read", ["nothing-here"]);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const titles = (items: readonly Record<string, unknown>[]) =>
      items.map(item => item.title).sort();

    it("lists the editor's drafts, without the entry their rule leaves out", async () => {
      const editor = createEditorReader(t.nextly, { user: { id: "editor" } });
      const { items, meta } = await editor.find({
        collection: SLUG,
        limit: 50,
      });
      expect(titles(items)).toEqual(["Draft idea", "Live"]);
      expect(meta.total).toBe(2);
      await expect(editor.count({ collection: SLUG })).resolves.toBe(2);
      // A field the public may not read, which this person may.
      expect(items.find(item => item.title === "Draft idea")).toMatchObject({
        internalNote: "note for Draft idea",
      });
    });

    it("refuses a filter or sort the published page refuses, though the editor may read the field", async () => {
      const editor = createEditorReader(t.nextly, { user: { id: "editor" } });
      // The control: the editor reads the field, and may filter by a field
      // the public reads too.
      await expect(
        editor.find({
          collection: SLUG,
          filters: [{ field: "title", op: "equals", value: "Live" }],
        })
      ).resolves.toMatchObject({ meta: { total: 1 } });
      for (const read of [
        () =>
          editor.find({
            collection: SLUG,
            filters: [
              { field: "internalNote", op: "equals", value: "note for Live" },
            ],
          }),
        () => editor.find({ collection: SLUG, sort: "-internalNote" }),
        () =>
          editor.count({
            collection: SLUG,
            filters: [{ field: "internalNote", op: "exists", value: true }],
          }),
      ]) {
        const refusal = await read().then(
          () => "",
          (error: unknown) => JSON.stringify(error)
        );
        expect(refusal).toContain("internalNote");
      }
    });

    it("refuses a person who may not read the collection, as the admin does", async () => {
      const outsider = createEditorReader(t.nextly, {
        user: { id: "outsider" },
      });
      const refusal = await outsider.find({ collection: SLUG }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(NextlyError.is(refusal)).toBe(true);
    });

    it("never hands the published page the editor's draft or their fields", async () => {
      // The control: the editor's read holds the draft and the note.
      const seen = await createEditorReader(t.nextly, {
        user: { id: "editor" },
      }).find({ collection: SLUG, limit: 50 });
      expect(JSON.stringify(seen.items)).toContain("Draft idea");
      // The published page's read, made after it, holds neither.
      const { items } = await createPublicReader(t.nextly).find({
        collection: SLUG,
        limit: 50,
      });
      expect(titles(items)).toEqual(["HR only", "Live"]);
      expect(JSON.stringify(items)).not.toContain("Draft idea");
      for (const item of items) expect(item).not.toHaveProperty("internalNote");
    });
  }
);
