/**
 * Every explicit save is kept in the history, credited to the person who
 * saved it.
 *
 * A save that names no status on a published document is held as the working
 * draft: the live content is untouched until it is published. The draft row is
 * rewritten in place, so without a version per save the earlier saves, and who
 * made them, would be gone. These run on every dialect the environment
 * reaches, through the real write paths.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { restoreVersion } from "../restore-version";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ana = { id: "ana", roles: ["super-admin"] };
const ben = { id: "ben", roles: ["super-admin"] };
const superAdmin = { id: "tester", roles: ["super-admin"] };

type VersionRow = {
  scopeSlug: string;
  entryId: string;
  versionNo: number | null;
  status: string;
  isAutosave: boolean | number;
  locale: string | null;
  createdBy: string | null;
  sourceVersionNo: number | null;
  snapshot: unknown;
};

function parsed(snapshot: unknown): Record<string, unknown> {
  // Some dialects hand JSON back as text.
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
  ) as Record<string, unknown>;
}

async function rowsFor(handle: TestNextly, slug: string) {
  return (await handle.adapter.select<VersionRow>("nextly_versions")).filter(
    r => r.scopeSlug === slug
  );
}

/** Durable versions, oldest first. */
async function versionsFor(handle: TestNextly, slug: string) {
  return (await rowsFor(handle, slug))
    .filter(r => typeof r.versionNo === "number")
    .sort((a, b) => (a.versionNo ?? 0) - (b.versionNo ?? 0));
}

/** The working drafts: neither versions nor autosaves. */
async function workingDraftsFor(handle: TestNextly, slug: string) {
  return (await rowsFor(handle, slug)).filter(
    r => r.versionNo === null && !r.isAutosave
  );
}

const posts = (localized = false) =>
  defineCollection({
    slug: "posts",
    status: true,
    versions: true,
    ...(localized ? { localized: true } : {}),
    fields: [text({ name: "title" })],
  });

describe.each(getConfiguredTestDialects())(
  "every explicit save is recorded (integration, %s)",
  dialect => {
    it("records each save over a published document, credited to whoever saved it", async () => {
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true, user: ana },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const before = (await versionsFor(current, "posts")).length;

      for (const [user, title] of [
        [ana, "Ana's first"],
        [ben, "Ben's edit"],
        [ana, "Ana's second"],
      ] as const) {
        await handler.updateEntry(
          { collectionName: "posts", entryId: id, overrideAccess: true, user },
          { title }
        );
      }

      const saves = (await versionsFor(current, "posts")).slice(before);
      expect(saves.map(v => [v.status, v.createdBy])).toEqual([
        ["draft", "ana"],
        ["draft", "ben"],
        ["draft", "ana"],
      ]);
      expect(saves.map(v => parsed(v.snapshot).title)).toEqual([
        "Ana's first",
        "Ben's edit",
        "Ana's second",
      ]);
      // Still held: the live row is what was published, and the working draft
      // carries the last save.
      const [live] = (
        await current.adapter.select<{ id: string; title: string }>("dc_posts")
      ).filter(r => r.id === id);
      expect(live.title).toBe("Live");
      const [draft] = await workingDraftsFor(current, "posts");
      expect(parsed(draft.snapshot).title).toBe("Ana's second");
    });

    it("records each save over a published Single", async () => {
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "branding",
            status: true,
            versions: true,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "branding",
        { heading: "Live", status: "published" },
        { overrideAccess: true, user: ana }
      );
      const before = (await versionsFor(current, "branding")).length;

      await singles.update(
        "branding",
        { heading: "Ana's" },
        { overrideAccess: true, user: ana }
      );
      await singles.update(
        "branding",
        { heading: "Ben's" },
        { overrideAccess: true, user: ben }
      );

      // Saving the same heading again changes nothing, so records nothing.
      await singles.update(
        "branding",
        { heading: "Ben's" },
        { overrideAccess: true, user: ben }
      );

      const saves = (await versionsFor(current, "branding")).slice(before);
      expect(saves.map(v => [v.status, v.createdBy])).toEqual([
        ["draft", "ana"],
        ["draft", "ben"],
      ]);
      expect(parsed(saves[1].snapshot).heading).toBe("Ben's");
    });

    it("keys a translated save's version as its working draft is keyed", async () => {
      current = await createTestNextly({
        dialect,
        collections: [posts(true)],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { title: "Hello", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "Hallo", status: "published" }
      );
      const before = (await versionsFor(current, "posts")).length;

      await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "de",
          user: ana,
        },
        { title: "Hallo, Welt" }
      );

      const saves = (await versionsFor(current, "posts")).slice(before);
      expect(saves).toHaveLength(1);
      const drafts = await workingDraftsFor(current, "posts");
      expect(drafts).toHaveLength(1);
      expect(saves[0].locale).toBe("de");
      expect(saves[0].locale).toBe(drafts[0].locale);
    });

    it("records no version for a save that changes nothing", async () => {
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const before = (await versionsFor(current, "posts")).length;
      const save = (title: string) =>
        handler.updateEntry(
          {
            collectionName: "posts",
            entryId: id,
            overrideAccess: true,
            user: ana,
          },
          { title }
        );

      // The same as what is live: nothing to record.
      await save("Live");
      // A change, then the same again.
      await save("Edited");
      await save("Edited");

      const saves = (await versionsFor(current, "posts")).slice(before);
      expect(saves.map(v => parsed(v.snapshot).title)).toEqual(["Edited"]);
    });

    it("lists no autosave as a version", async () => {
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const before = (await versionsFor(current, "posts")).length;

      const repo = new VersionsRepository(
        current.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: id,
      };
      for (const author of ["ana", "ben"]) {
        await repo.upsertAutosave({
          ref,
          status: "draft",
          snapshot: { title: `typing, ${author}` },
          createdBy: author,
        });
      }

      expect(await versionsFor(current, "posts")).toHaveLength(before);
      const listed = await repo.listByDoc(ref);
      expect(listed.every(v => !v.isAutosave)).toBe(true);
    });

    it("restores a recorded save as a pending change: still published, lineage kept", async () => {
      // A held save's draft is built on the live document, so it would carry
      // `status: "published"`. Restoring that status would publish the pending
      // edit at once; the recorded version names no status, so its restore is
      // held like any other save.
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const save = (title: string) =>
        handler.updateEntry(
          { collectionName: "posts", entryId: id, overrideAccess: true },
          { title }
        );
      await save("Pending");
      await save("Later");
      const pending = (await versionsFor(current, "posts")).find(
        v => parsed(v.snapshot).title === "Pending"
      );
      expect(pending).toBeDefined();
      expect(parsed(pending!.snapshot)).not.toHaveProperty("status");

      await restoreVersion({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        versionNo: pending!.versionNo!,
        user: superAdmin,
      });

      const [live] = (
        await current.adapter.select<{
          id: string;
          title: string;
          status: string;
        }>("dc_posts")
      ).filter(r => r.id === id);
      expect(live).toMatchObject({ title: "Live", status: "published" });
      const [draft] = await workingDraftsFor(current, "posts");
      expect(parsed(draft.snapshot).title).toBe("Pending");
      const versions = await versionsFor(current, "posts");
      expect(versions[versions.length - 1].sourceVersionNo).toBe(
        pending!.versionNo
      );
    });

    it("keeps the draft a restore replaces as its undo point, not the live row", async () => {
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const save = (title: string) =>
        handler.updateEntry(
          { collectionName: "posts", entryId: id, overrideAccess: true },
          { title }
        );
      await save("Pending A");
      await save("Pending B");
      const pendingA = (await versionsFor(current, "posts")).find(
        v => parsed(v.snapshot).title === "Pending A"
      );

      await restoreVersion({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        versionNo: pendingA!.versionNo!,
        user: superAdmin,
      });

      const undo = (await rowsFor(current, "posts")).filter(
        r => (r as { label?: string | null }).label === "Before restore"
      );
      // One undo point, holding the draft that was overwritten; the live row,
      // which the restore never touched, is not recorded again.
      expect(undo).toHaveLength(1);
      expect(parsed(undo[0].snapshot).title).toBe("Pending B");
      expect(undo[0].status).toBe("draft");
    });

    it("keeps the draft a restore replaces as its undo point, for a Single", async () => {
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "branding",
            status: true,
            versions: true,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "branding",
        { heading: "Live", status: "published" },
        { overrideAccess: true }
      );
      await singles.update(
        "branding",
        { heading: "Pending A" },
        { overrideAccess: true }
      );
      await singles.update(
        "branding",
        { heading: "Pending B" },
        { overrideAccess: true }
      );
      const versions = await versionsFor(current, "branding");
      const pendingA = versions.find(
        v => parsed(v.snapshot).heading === "Pending A"
      );

      await restoreVersion({
        scopeKind: "single",
        slug: "branding",
        entryId: pendingA!.entryId,
        versionNo: pendingA!.versionNo!,
        user: superAdmin,
      });

      const undo = (await rowsFor(current, "branding")).filter(
        r => (r as { label?: string | null }).label === "Before restore"
      );
      expect(undo).toHaveLength(1);
      expect(parsed(undo[0].snapshot).heading).toBe("Pending B");
    });

    it("refuses to restore a saved draft where the document can no longer hold one", async () => {
      // History-only: a save writes the live row, so restoring a saved draft
      // here would publish content that was never live.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "notes",
            status: true,
            versions: { drafts: false },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "notes", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const repo = new VersionsRepository(
        current.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      const before = await versionsFor(current, "notes");
      // A save recorded while drafts were on: draft status, no snapshot status.
      await repo.insertVersion({
        ref: { scopeKind: "collection", scopeSlug: "notes", entryId: id },
        versionNo: before.length + 1,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "Pending" },
      });

      const error = await restoreVersion({
        scopeKind: "collection",
        slug: "notes",
        entryId: id,
        versionNo: before.length + 1,
        user: superAdmin,
      }).then(
        () => undefined,
        (err: unknown) => err
      );

      expect(error).toBeDefined();
      expect(String((error as { code?: string }).code)).toBe("CONFLICT");
      const [live] = (
        await current.adapter.select<{
          id: string;
          title: string;
          status: string;
        }>("dc_notes")
      ).filter(r => r.id === id);
      expect(live).toMatchObject({ title: "Live", status: "published" });
    });

    it("shows no status change when a recorded save is compared with what is published", async () => {
      current = await createTestNextly({ dialect, collections: [posts()] });
      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await handler.updateEntry(
        { collectionName: "posts", entryId: id, overrideAccess: true },
        { title: "Pending" }
      );
      const versions = await versionsFor(current, "posts");
      const published = versions.find(v => v.status === "published")!;
      const recorded = versions[versions.length - 1];
      expect(recorded.status).toBe("draft");

      const diff = await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: "posts",
        entryId: id,
        user: superAdmin,
        from: published.versionNo!,
        to: recorded.versionNo!,
      });

      expect(diff.hasChanges).toBe(true);
      const changed = diff.fields.filter(f => f.status !== "unchanged");
      expect(changed.map(f => f.name)).toEqual(["title"]);
    });
  }
);
