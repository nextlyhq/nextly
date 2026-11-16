// Discarding a language's pending change forgets the author's unsaved work
// recorded in that language, and only that.
//
// The editor offers to restore unsaved changes from the author's recovery
// point. Once the author discards that language's changes, the offer is what
// they threw away. The plausible broken implementations keep the point, so
// the discarded work is offered back on the next load, or remove it whatever
// language it was recorded in, so work in a language the author never
// discarded is lost.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { VersionsRepository } from "../../versions/versions-repository";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const NOTES = "recoverynotes";
const AUTHOR = { id: "author-1", email: "author@x.test" };
const OTHER = "author-2";

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "body", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** An entry live in English and German, with a change held in each. */
async function heldInBoth(entries: CollectionEntryService): Promise<string> {
  const at = (entryId: string, locale: string) => ({
    collectionName: NOTES,
    entryId,
    locale,
    overrideAccess: true,
  });
  const created = await entries.createEntry(
    { collectionName: NOTES, overrideAccess: true, locale: "en" },
    { body: "Hello", status: "published" }
  );
  const id = (created.data as { id: string }).id;
  for (const [locale, body] of [["de", "Hallo"]] as const) {
    const live = await entries.updateEntry(at(id, locale), {
      body,
      status: "published",
      _overwrite: true,
    });
    expect(live.success, JSON.stringify(live)).toBe(true);
  }
  for (const [locale, body] of [
    ["en", "Hello again"],
    ["de", "Hallo wieder"],
  ] as const) {
    const held = await entries.updateEntry(at(id, locale), {
      body,
      _overwrite: true,
    });
    expect(held.success, JSON.stringify(held)).toBe(true);
  }
  return id;
}

describe.each(getConfiguredTestDialects())(
  "discarding a language's pending change (integration, %s)",
  dialect => {
    it("forgets the author's recovery point recorded in that language, and keeps one recorded in another", async () => {
      const entries = await boot(dialect);
      const id = await heldInBoth(entries);
      const repo = new VersionsRepository(
        current!.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: NOTES,
        entryId: id,
      };
      const pointIn = (locale: string | null, createdBy: string) =>
        repo.upsertAutosave({
          ref,
          status: "draft",
          snapshot: { body: `unsaved ${locale ?? "default"}` },
          locale,
          createdBy,
        });

      // The author's point in German, and another author's in English (the
      // default language, recorded as no language, as the editor records it).
      await pointIn("de", AUTHOR.id);
      await pointIn(null, OTHER);

      // Discarding English leaves the author's German work and the other
      // author's alone.
      await entries.discardWorkingDraft({
        collectionName: NOTES,
        entryId: id,
        version: { _overwrite: true },
        locale: "en",
        user: AUTHOR,
      });
      expect((await repo.findAutosave(ref, AUTHOR.id))?.locale).toBe("de");
      expect(await repo.findAutosave(ref, OTHER)).toBeDefined();

      // Discarding German forgets the author's German work.
      await entries.discardWorkingDraft({
        collectionName: NOTES,
        entryId: id,
        version: { _overwrite: true },
        locale: "de",
        user: AUTHOR,
      });
      expect(await repo.findAutosave(ref, AUTHOR.id)).toBeUndefined();
      expect(await repo.findAutosave(ref, OTHER)).toBeDefined();
    });

    it("forgets the author's recovery point recorded in the default language when that language is discarded", async () => {
      const entries = await boot(dialect);
      const id = await heldInBoth(entries);
      const repo = new VersionsRepository(
        current!.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: NOTES,
        entryId: id,
      };
      await repo.upsertAutosave({
        ref,
        status: "draft",
        snapshot: { body: "unsaved default" },
        locale: null,
        createdBy: AUTHOR.id,
      });

      await entries.discardWorkingDraft({
        collectionName: NOTES,
        entryId: id,
        version: { _overwrite: true },
        locale: "en",
        user: AUTHOR,
      });

      expect(await repo.findAutosave(ref, AUTHOR.id)).toBeUndefined();
    });

    // A discard that found no pending change threw nothing away, so the
    // author's unsaved work, the only copy of it, stays to be offered back.
    it("keeps the author's recovery point when the discard removes no pending change", async () => {
      const entries = await boot(dialect);
      const created = await entries.createEntry(
        { collectionName: NOTES, overrideAccess: true, locale: "en" },
        { body: "Hello", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const repo = new VersionsRepository(
        current!.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: NOTES,
        entryId: id,
      };
      await repo.upsertAutosave({
        ref,
        status: "draft",
        snapshot: { body: "typed, never saved" },
        locale: "en",
        createdBy: AUTHOR.id,
      });

      // Answered or refused as having nothing to discard, either way the
      // recovery point is what matters here.
      await entries
        .discardWorkingDraft({
          collectionName: NOTES,
          entryId: id,
          version: { _overwrite: true },
          locale: "en",
          user: AUTHOR,
        })
        .catch(() => undefined);

      expect((await repo.findAutosave(ref, AUTHOR.id))?.locale).toBe("en");
    });
  }
);
