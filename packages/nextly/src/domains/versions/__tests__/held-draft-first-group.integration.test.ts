/**
 * A held change that writes a group the live document never had keeps what it wrote. A group
 * keeps one structure in every language, and a held change is kept by part: the structure in the
 * shared draft, the text in the language's. A group first written with only its text has an empty
 * structure, which is still the structure the text is laid on, so the shared draft records it.
 * What separates a correct held save from a broken one: a broken one takes the empty structure
 * for no change, stores the text with nothing to lay it on, and reads the group back as none, so
 * the writer's change is lost and a caller checking it was stored is refused. Written into a field
 * the writer may not read as well, as an import into a draft does.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { defineCollection, group, text, textarea } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

perLanguageStorageSuite();

const NOTES = "hdg_notes";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a held change first writing a group (%s)",
  (dialect: TestDialect) => {
    it.each([
      ["it may not read", { access: { read: () => false } }],
      ["it may read", {}],
    ] as const)(
      "stores the value written into a field %s, and reads it back as stored",
      async (_label, rule) => {
        handle = await createTestNextly({
          ...(dialect === "sqlite" ? {} : { dialect }),
          collections: [
            defineCollection({
              slug: NOTES,
              status: true,
              versions: { drafts: true },
              access: { read: () => true, update: () => true },
              fields: [
                text({ name: "title" }),
                group({
                  name: "seo",
                  fields: [
                    text({ name: "metaTitle", localized: true, ...rule }),
                    textarea({ name: "metaDescription", localized: true }),
                  ],
                }),
              ],
            }),
          ],
        });
        await userWhoMay(handle, "editor-1", "read", [NOTES]);
        await grantTo(handle, "editor-1", "update", [NOTES]);
        const entries = handle
          .getService("collectionsHandler")
          .getEntryService() as CollectionEntryService;
        const trusted = { collectionName: NOTES, overrideAccess: true };

        const created = await entries.createEntry(trusted, {
          title: "Pricing",
          status: "published",
        });
        const id = String((created.data as { id: string }).id);
        // A held change waits beside the published page.
        await entries.updateEntry(
          { ...trusted, entryId: id },
          { title: "Pricing (new)", _overwrite: true }
        );

        // The editor writes the title they may not read into that held change.
        const saved = await entries.updateEntry(
          {
            collectionName: NOTES,
            entryId: id,
            user: { id: "editor-1" },
            overrideAccess: false,
          },
          {
            seo: { metaTitle: "Typed into the draft" },
            _overwrite: true,
          }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);

        const draft = (await handle.nextly.findByID({
          collection: NOTES,
          id,
          draft: true,
          status: "all",
          depth: 0,
          overrideAccess: true,
        } as never)) as Record<string, unknown>;
        expect(draft._isWorkingDraft).toBe(true);
        expect(draft.title).toBe("Pricing (new)");
        expect(draft.seo).toMatchObject({ metaTitle: "Typed into the draft" });
      }
    );
  }
);
