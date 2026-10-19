/**
 * A release member's own write is its record of being applied.
 *
 * A pass the host ends part-way through a component settles no release, so
 * the next pass plans every document again. Each member's write marks the
 * member, in the write's own transaction, with the release revision it was
 * applied for, and the next pass leaves out the members marked for the
 * release's current revision: only the documents still to go are written,
 * and the component settles. A change to the release moves its revision, so
 * a later pass writes everything again.
 *
 * The same mark is what decides whether a refused write counted. Nothing is
 * read from the document: a write that was refused leaves no mark, whatever
 * its status reads, and a read hook that rewrites the status changes nothing.
 *
 * Writes are counted by `afterChange` calls, which run once per committed
 * write. A pass is ended part-way by a write that never returns, the state a
 * host's time limit leaves: what committed stays, and nothing after it runs.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { defineSingle } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { applyDueReleases } from "../apply-due-releases";
import type { ReleaseMutations } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "./helpers/release-writes";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Collection hooks register into the global registry.
  resetHookRegistry();
});

const POSTS = "posts";
const LOCKED = "locked";
const PAGES = "pages";
const HIDDEN = "hidden";
const SHOWN = "shown";
const STRIPPED = "stripped";
const SETTINGS = "banner";
const PAST = new Date("2020-01-01T00:00:00Z");
const LATER_PAST = new Date("2021-01-01T00:00:00Z");

/** Committed writes to `posts`, counted by its `afterChange` hook. */
let changes = 0;
/** When set, a `posts` write never returns from this point. */
let hang: "before-commit" | "after-commit" | null = null;
/** Which `posts` write, counted from 1, the before-commit hang stops. */
let hangBeforeWrite = 1;
let beforeChanges = 0;

const never = (): Promise<never> => new Promise<never>(() => {});

const open = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};
/** Editable, but nobody may publish or take down. */
const noPublish = {
  read: () => true,
  update: () => true,
  publish: () => false,
  unpublish: () => false,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  changes = 0;
  beforeChanges = 0;
  hang = null;
  hangBeforeWrite = 1;
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: open,
        hooks: {
          beforeChange: [
            ({ data }: { data?: unknown }) => {
              if (hang !== "before-commit") return data;
              beforeChanges += 1;
              return beforeChanges === hangBeforeWrite ? never() : data;
            },
          ],
          afterChange: [
            () => {
              changes += 1;
              return hang === "after-commit" ? never() : undefined;
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: LOCKED,
        status: true,
        versions: { drafts: true },
        access: noPublish,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        access: noPublish,
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: HIDDEN,
        status: true,
        access: open,
        hooks: {
          // Reports every document as a draft, whatever is stored.
          afterRead: [
            ({ data }: { data?: unknown }) => ({
              ...(data as Record<string, unknown>),
              status: "draft",
            }),
          ],
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: STRIPPED,
        status: true,
        access: open,
        hooks: {
          // Keeps every write a draft, so a publish stores another status.
          beforeChange: [
            ({ data }: { data?: unknown }) => ({
              ...(data as Record<string, unknown>),
              status: "draft",
            }),
          ],
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: SHOWN,
        status: true,
        access: noPublish,
        hooks: {
          // Reports every document as live, whatever is stored.
          afterRead: [
            ({ data }: { data?: unknown }) => ({
              ...(data as Record<string, unknown>),
              status: "published",
            }),
          ],
        },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SETTINGS,
        status: true,
        access: open,
        fields: [text({ name: "siteName" })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function entry(
  t: TestNextly,
  collectionName: string,
  status: "draft" | "published",
  locale?: string
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName, overrideAccess: true, ...(locale ? { locale } : {}) },
    { title: "one", status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

async function drafts(t: TestNextly, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(await entry(t, POSTS, "draft"));
  return ids;
}

/** A due release publishing these documents, by its author `author`. */
async function dueRelease(
  t: TestNextly,
  entryIds: readonly string[],
  scope: { scopeKind: "collection" | "single"; scopeSlug: string } = {
    scopeKind: "collection",
    scopeSlug: POSTS,
  }
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  for (const entryId of entryIds) {
    await repo.addMember(
      {
        releaseId: release.id,
        ...scope,
        entryId,
        locale: null,
        action: "publish",
        createdBy: "author",
      },
      ANY_EDITABLE_STATE
    );
  }
  await scheduleAsItStands(repo, release.id, PAST, "UTC");
  return release.id;
}

/** The mutations the drain job performs, as the drain job builds them. */
const mutationsOf = (t: TestNextly): ReleaseMutations =>
  createReleaseMutations({ contentApi: t.nextly });

/** One materialisation pass, as the drain job performs it. */
function materialise(
  t: TestNextly,
  mutations: ReleaseMutations = mutationsOf(t)
) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations,
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

/**
 * A pass the host ends once `writes` content writes have completed: the next
 * write never returns. Resolves once that write has been reached, so every
 * write before it has committed and been confirmed.
 */
async function killedAfter(t: TestNextly, writes: number): Promise<void> {
  const real = mutationsOf(t);
  let started = 0;
  const cut =
    (write: ReleaseMutations["publish"]): ReleaseMutations["publish"] =>
    input =>
      started++ >= writes ? never() : write(input);
  void materialise(t, {
    ...real,
    publish: cut(input => real.publish(input)),
    unpublish: cut(input => real.unpublish(input)),
  });
  await until(() => started > writes);
}

/** A pass the host ends inside a content write, as `hang` places it. */
async function killedInsideWrite(t: TestNextly): Promise<void> {
  const before = hang === "after-commit" ? changes : beforeChanges;
  void materialise(t);
  await until(() =>
    hang === "after-commit"
      ? changes > before
      : beforeChanges >= hangBeforeWrite
  );
}

async function until(condition: () => boolean): Promise<void> {
  for (let n = 0; n < 2000; n++) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error("the pass never reached the point it was to be ended at");
}

async function storedStatus(
  t: TestNextly,
  collectionName: string,
  id: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(
    `dc_${collectionName}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  return row?.status;
}

const stateOf = async (t: TestNextly, id: string) =>
  (await t.nextly.releases.findByID({ id }))?.state;

describe.each(getConfiguredTestDialects())(
  "a pass ended part-way is continued, not replayed (%s)",
  dialect => {
    it("writes only the documents still to go and settles the release", async () => {
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;

      await killedAfter(t, 2);
      expect(changes).toBe(2);
      expect(await stateOf(t, releaseId)).toBe("scheduled");

      changes = 0;
      const result = await materialise(t);

      expect(changes).toBe(1);
      expect(result).toMatchObject({ failed: 0, applied: 3, published: 1 });
      for (const id of ids) {
        expect(await storedStatus(t, POSTS, id)).toBe("published");
      }
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("settles every release of a component sharing a document", async () => {
      const t = await boot(dialect);
      const [a, b, shared, d] = await drafts(t, 4);
      const first = await dueRelease(t, [a, b, shared]);
      const second = await dueRelease(t, [shared, d]);
      changes = 0;

      await killedAfter(t, 2);
      expect(changes).toBe(2);

      changes = 0;
      const result = await materialise(t);

      expect(changes).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.published).toBe(2);
      for (const id of [a, b, shared, d]) {
        expect(await storedStatus(t, POSTS, id)).toBe("published");
      }
      expect(await stateOf(t, first)).toBe("published");
      expect(await stateOf(t, second)).toBe("published");
    });

    it("does not write a document again when the pass ended just after its write committed", async () => {
      // The write and its mark commit together, so there is no point at which
      // a committed write is left unmarked.
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;
      hang = "after-commit";

      await killedInsideWrite(t);
      expect(changes).toBe(1);

      hang = null;
      changes = 0;
      await materialise(t);

      expect(changes).toBe(2);
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("writes again only the document whose write the pass ended inside", async () => {
      // Ended before the second write committed: that write rolled back with
      // its mark, so the next pass writes it, and the one never started.
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;
      hang = "before-commit";
      hangBeforeWrite = 2;

      await killedInsideWrite(t);
      expect(changes).toBe(1);

      hang = null;
      changes = 0;
      await materialise(t);

      expect(changes).toBe(2);
      for (const id of ids) {
        expect(await storedStatus(t, POSTS, id)).toBe("published");
      }
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("writes everything again once the release is rescheduled", async () => {
      // Rescheduling moves the release's revision, so the marks left by the
      // ended pass are for a release that no longer exists as it was.
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;
      await killedAfter(t, 2);

      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        releaseId,
        LATER_PAST,
        "UTC"
      );
      changes = 0;
      const result = await materialise(t);

      expect(changes).toBe(3);
      expect(result.failed).toBe(0);
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("writes everything again once a document joins the release", async () => {
      // A membership change moves the revision as a reschedule does.
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;
      await killedAfter(t, 2);

      const [added] = await drafts(t, 1);
      await new ReleasesRepository(t.adapter).addMember(
        {
          releaseId,
          scopeKind: "collection",
          scopeSlug: POSTS,
          entryId: added,
          locale: null,
          action: "publish",
          createdBy: "author",
        },
        ANY_EDITABLE_STATE
      );
      changes = 0;
      await materialise(t);

      expect(changes).toBe(4);
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("leaves a release cancelled after a pass ended part-way, its marks stale", async () => {
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;
      await killedAfter(t, 2);

      const repo = new ReleasesRepository(t.adapter);
      expect(await repo.cancelRelease(releaseId)).toBe(true);
      changes = 0;
      expect(await materialise(t)).toMatchObject({ due: 0 });

      expect(changes).toBe(0);
      expect(await stateOf(t, releaseId)).toBe("cancelled");
      // Marked for the revision the pass planned against, which the cancel
      // moved on from.
      const [release] = await repo.findReleases({ ids: [releaseId] });
      const marks = (await repo.listMembers(releaseId)).map(
        m => m.appliedRevision
      );
      expect(marks.filter(m => m !== null)).toHaveLength(2);
      expect(marks).not.toContain(release?.revision);
    });

    it("writes every document once on a pass nothing ends early", async () => {
      // The control: with no pass ended part-way, nothing is left out.
      const t = await boot(dialect);
      const ids = await drafts(t, 3);
      const releaseId = await dueRelease(t, ids);
      changes = 0;

      const result = await materialise(t);

      expect(changes).toBe(3);
      expect(result).toMatchObject({ failed: 0, applied: 3, published: 1 });
      expect(await stateOf(t, releaseId)).toBe("published");

      changes = 0;
      expect(await materialise(t)).toMatchObject({ due: 0 });
      expect(changes).toBe(0);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a document's mark belongs to the release that wrote it last (%s)",
  dialect => {
    it("writes a document again once another release's write has replaced the action", async () => {
      // The first release publishes `doc` and is held open by a member that
      // can never be written. A later release then takes `doc` down, and is
      // taken out of it again. The first release wins `doc` back, but its
      // member's mark described a write the takedown has since undone.
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const doc = await entry(t, POSTS, "draft");
      const stuck = await entry(t, LOCKED, "draft");
      const add = (
        releaseId: string,
        scopeSlug: string,
        entryId: string,
        action: "publish" | "unpublish"
      ) =>
        repo.addMember(
          {
            releaseId,
            scopeKind: "collection",
            scopeSlug,
            entryId,
            locale: null,
            action,
            createdBy: "author",
          },
          ANY_EDITABLE_STATE
        );
      const first = (await repo.createRelease({ title: "Launch" })).id;
      await add(first, POSTS, doc, "publish");
      await add(first, LOCKED, stuck, "publish");
      await scheduleAsItStands(repo, first, PAST, "UTC");

      await materialise(t);
      expect(await storedStatus(t, POSTS, doc)).toBe("published");

      const second = (await repo.createRelease({ title: "Takedown" })).id;
      const takedown = await add(second, POSTS, doc, "unpublish");
      await scheduleAsItStands(repo, second, LATER_PAST, "UTC");
      await materialise(t);
      expect(await storedStatus(t, POSTS, doc)).toBe("draft");

      await repo.removeMember(takedown, ANY_EDITABLE_STATE);
      changes = 0;
      await materialise(t);

      expect(changes).toBe(1);
      expect(await storedStatus(t, POSTS, doc)).toBe("published");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a refused write counts only by its own mark (%s)",
  dialect => {
    it("does not count a refused publish of a published document holding a draft", async () => {
      const t = await boot(dialect);
      const id = await entry(t, LOCKED, "published");
      // A status-less save on a drafts-enabled collection holds the edit as a
      // working draft and leaves the live row alone.
      await handlerOf(t).updateEntry(
        { collectionName: LOCKED, entryId: id, overrideAccess: true },
        { title: "pending title" }
      );
      const releaseId = await dueRelease(t, [id], {
        scopeKind: "collection",
        scopeSlug: LOCKED,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
      expect(await stateOf(t, releaseId)).toBe("scheduled");
      // The refused write left no mark, so no later pass takes it as done.
      const [member] = await new ReleasesRepository(t.adapter).listMembers(
        releaseId
      );
      expect(member?.appliedRevision).toBeNull();
    });

    it("does not count a refused whole-document publish whose default language is already live", async () => {
      const t = await boot(dialect);
      const id = await entry(t, PAGES, "published");
      await handlerOf(t).updateEntry(
        {
          collectionName: PAGES,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "Seite", status: "draft" }
      );
      const releaseId = await dueRelease(t, [id], {
        scopeKind: "collection",
        scopeSlug: PAGES,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
      expect(await stateOf(t, releaseId)).toBe("scheduled");
    });

    it("does not count a refused publish that a read hook reports as live", async () => {
      const t = await boot(dialect);
      const id = await entry(t, SHOWN, "draft");
      const releaseId = await dueRelease(t, [id], {
        scopeKind: "collection",
        scopeSlug: SHOWN,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(await storedStatus(t, SHOWN, id)).toBe("draft");
      expect(await stateOf(t, releaseId)).toBe("scheduled");
    });

    it("counts a publish that a read hook reports as a draft", async () => {
      const t = await boot(dialect);
      const id = await entry(t, HIDDEN, "draft");
      const releaseId = await dueRelease(t, [id], {
        scopeKind: "collection",
        scopeSlug: HIDDEN,
      });

      const result = await materialise(t);

      expect(result).toMatchObject({ failed: 0, applied: 1, published: 1 });
      expect(await storedStatus(t, HIDDEN, id)).toBe("published");
      expect(await stateOf(t, releaseId)).toBe("published");
    });

    it("does not count a write a hook kept from storing the status", async () => {
      // The write commits, storing a status other than the action's, so it
      // did not perform the action and leaves no mark.
      const t = await boot(dialect);
      const id = await entry(t, STRIPPED, "draft");
      const releaseId = await dueRelease(t, [id], {
        scopeKind: "collection",
        scopeSlug: STRIPPED,
      });

      const result = await materialise(t);

      expect(result.failed).toBe(1);
      expect(result.outcomes[0]?.failure).toBe("WRITE_FAILED");
      expect(await storedStatus(t, STRIPPED, id)).toBe("draft");
      expect(await stateOf(t, releaseId)).toBe("scheduled");
    });

    it("publishes a Single and settles its release", async () => {
      const t = await boot(dialect);
      const singles: SingleEntryService = t.getService("singleEntryService");
      await singles.update(
        SETTINGS,
        { siteName: "Site", status: "draft" },
        { overrideAccess: true }
      );
      const rows = await t.adapter.select<{ id: string }>(
        `single_${SETTINGS}`,
        {}
      );
      const singleId = rows[0]?.id;
      if (typeof singleId !== "string") throw new Error("no single row");
      const releaseId = await dueRelease(t, [singleId], {
        scopeKind: "single",
        scopeSlug: SETTINGS,
      });
      const repo = new ReleasesRepository(t.adapter);
      const [planned] = await repo.findReleases({ ids: [releaseId] });

      const result = await materialise(t);

      expect(result).toMatchObject({ failed: 0, applied: 1, published: 1 });
      expect(await stateOf(t, releaseId)).toBe("published");
      // The Single's write marked its member for the revision it was applied
      // for, in the write's transaction.
      const [member] = await repo.listMembers(releaseId);
      expect(member?.appliedRevision).toBe(planned?.revision);
    });
  }
);
