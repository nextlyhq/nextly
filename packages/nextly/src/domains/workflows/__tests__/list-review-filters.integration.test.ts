/**
 * A collection list's review filters (R-11): `_assignedToMe` keeps the documents with a part
 * assigned to the reader or to one of their roles, as the waiting list counts "mine"; the list and
 * its count agree; a collection no workflow holds matches nothing, with no refusal. On every
 * configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { workflowDefinitionHash } from "../hash";
import {
  approvedSlot,
  enteredReviewSlot,
  workflowPins,
} from "../workflow-pins";

import {
  bootSteps,
  entry,
  giveRole,
  partOf,
  person,
  role,
  saveIn,
  seedState,
  shownVersion,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

// Written for per-language storage, as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

const HASH = workflowDefinitionHash(editorial);

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** A collection no workflow holds. */
const ledgers = defineCollection({
  slug: "ledgers",
  fields: [text({ name: "title" })],
});

/**
 * The ids a list with `where` keeps for the person `userId`, and its count: read in `locale`
 * when given, else as a plain read is, in the default language.
 */
async function listedFor(
  app: TestNextly,
  collection: string,
  userId: string,
  where: Record<string, unknown>,
  locale?: string
): Promise<{ ids: string[]; total: number }> {
  const asReader = {
    collection,
    where,
    status: "all",
    overrideAccess: false,
    user: { id: userId },
    ...(locale === undefined ? {} : { locale }),
  } as never;
  const listed = await app.nextly.find(asReader);
  const counted = (await app.nextly.count(asReader)) as { total: number };
  return {
    ids: listed.items.map(item => String(item.id)).sort(),
    total: counted.total,
  };
}

describe.each(getConfiguredTestDialects())(
  "a list's review filters (%s)",
  dialect => {
    it("keeps the documents assigned to the reader or one of their roles, and counts what it lists", async () => {
      t = await bootSteps(dialect, undefined, { collections: [ledgers] });
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
        ["read", "ledgers"],
      ]);
      const desk = await role(t, "legal-desk", [["sign-off", "pages"]]);
      await giveRole(t, "sam", desk);
      const toSam = await entry(t, "pages");
      const toDesk = await entry(t, "pages");
      const toAlice = await entry(t, "pages");
      const unassigned = await entry(t, "pages");
      for (const [id, assignee] of [
        [toSam, { kind: "user" as const, id: "sam" }],
        [toDesk, { kind: "role" as const, id: desk }],
        [toAlice, { kind: "user" as const, id: "alice" }],
        [unassigned, undefined],
      ] as const) {
        await seedState(t, partOf("pages", id, null), "legal", {
          definitionHash: HASH,
          ...(assignee ? { assignee } : {}),
        });
      }

      const mine = await listedFor(t, "pages", "sam", { _assignedToMe: true });
      expect(mine.ids).toEqual([toSam, toDesk].sort());
      expect(mine.total).toBe(2);

      // A collection no workflow holds has nothing assigned to anyone: nothing, and no refusal.
      const none = await listedFor(t, "ledgers", "sam", {
        _assignedToMe: true,
      });
      expect(none).toEqual({ ids: [], total: 0 });
    });

    it("keeps the documents with a part changed since its last approval, and counts what it lists", async () => {
      t = await bootSteps(dialect, undefined, { collections: [ledgers] });
      await person(t, "sam", [
        ["read", "pages"],
        ["read", "posts"],
        ["read", "ledgers"],
      ]);
      const app = t;
      /** Saves `title` to a page, and the version it recorded. */
      const savePage = async (id: string, title: string) => {
        await (
          app.getService("collectionsHandler") as CollectionsHandler
        ).updateEntry(
          { collectionName: "pages", entryId: id, overrideAccess: true },
          { title, _overwrite: true }
        );
        return shownVersion(app, "pages", id, null);
      };
      /** Saves `title` to a post in `locale`, and the version that part now shows. */
      const savePost = async (id: string, locale: string, title: string) => {
        await saveIn(app, "posts", id, locale, { title });
        return shownVersion(app, "posts", id, locale);
      };
      /** Points the workflows slot `slot` of a document at `versionNo`, as a step does. */
      const pin = (slug: string, id: string, slot: string, versionNo: number) =>
        app.adapter.transaction(tx =>
          workflowPins.pin(tx, {
            ref: { scopeKind: "collection", scopeSlug: slug, entryId: id },
            slot,
            versionNo,
          })
        );

      // Approved, then saved again: changed since approved.
      const changed = await entry(t, "pages");
      await pin(
        "pages",
        changed,
        approvedSlot(null),
        await savePage(changed, "A")
      );
      await savePage(changed, "B");
      // Approved at its newest version: unchanged.
      const unchanged = await entry(t, "pages");
      await pin(
        "pages",
        unchanged,
        approvedSlot(null),
        await savePage(unchanged, "A")
      );
      // Submitted, never approved, then saved: there is no approval to have changed since.
      const submitted = await entry(t, "pages");
      await pin(
        "pages",
        submitted,
        enteredReviewSlot(null),
        await savePage(submitted, "A")
      );
      await savePage(submitted, "B");

      // A language approved, then saved again in that language: changed.
      const spanish = await entry(t, "posts");
      await pin(
        "posts",
        spanish,
        approvedSlot("es"),
        await savePost(spanish, "es", "Hola")
      );
      await savePost(spanish, "es", "Buenas");
      // A language approved at its newest, then another language saved: that part is unchanged.
      const otherLanguage = await entry(t, "posts");
      await pin(
        "posts",
        otherLanguage,
        approvedSlot("es"),
        await savePost(otherLanguage, "es", "Hola")
      );
      await savePost(otherLanguage, "en", "Hello again");
      // The shared part approved, then a save in any language: the shared part shows it, changed.
      const shared = await entry(t, "posts");
      await pin(
        "posts",
        shared,
        approvedSlot(null),
        await shownVersion(t, "posts", shared, null)
      );
      await savePost(shared, "ar", "Marhaba");

      const where = { _changedSinceApproved: true };
      expect(await listedFor(t, "pages", "sam", where)).toEqual({
        ids: [changed],
        total: 1,
      });
      // A trusted read judges no one and considers every language: still only an approval's pin.
      const trusted = await t.nextly.find({
        collection: "pages",
        where,
        status: "all",
        overrideAccess: true,
      } as never);
      expect(trusted.items.map(item => String(item.id))).toEqual([changed]);
      // Read in Spanish: the Spanish part changed, and the shared part. A Spanish approval is not
      // changed by a later English save.
      expect(await listedFor(t, "posts", "sam", where, "es")).toEqual({
        ids: [spanish, shared].sort(),
        total: 2,
      });
      // Read in English, as the other workflow filters are: a Spanish part is withheld from this
      // read, so it keeps no entry; the shared part still does.
      expect(await listedFor(t, "posts", "sam", where)).toEqual({
        ids: [shared],
        total: 1,
      });
      // A collection no workflow holds was never approved: nothing, and no refusal.
      expect(await listedFor(t, "ledgers", "sam", where)).toEqual({
        ids: [],
        total: 0,
      });
    });
  }
);
