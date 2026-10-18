/**
 * A release pass leaves out a write that would change nothing.
 *
 * A pass the host ends part-way through a component settles no release, so
 * the next pass plans every document again. One already published, holding no
 * working draft, is passed over rather than written, so its hooks and outbox
 * events do not run twice and the pass reaches the documents still to go. One
 * already published but holding a working draft is still written, because
 * putting that draft live is what the release is for.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { VersionsRepository } from "../../versions/versions-repository";
import { applyDueReleases } from "../apply-due-releases";
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
});

const SLUG = "posts";
const PAST = new Date("2020-01-01T00:00:00Z");

let changes = 0;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  changes = 0;
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        hooks: {
          afterChange: [
            () => {
              changes += 1;
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function entry(
  t: TestNextly,
  title: string,
  status: "draft" | "published"
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title, status }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

async function dueReleaseOf(
  t: TestNextly,
  entryIds: readonly string[]
): Promise<string> {
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  for (const entryId of entryIds) {
    await repo.addMember(
      {
        releaseId: release.id,
        scopeKind: "collection",
        scopeSlug: SLUG,
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

/** One materialisation pass, as the drain job performs it. */
function materialise(t: TestNextly) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({
      contentApi: t.nextly,
      drafts: new VersionsRepository(t.adapter),
    }),
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

async function stored(
  t: TestNextly,
  id: string
): Promise<{ title?: string; status?: string } | null> {
  return t.adapter.selectOne<{ title?: string; status?: string }>(
    `dc_${SLUG}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
}

describe.each(getConfiguredTestDialects())(
  "a release pass leaves out a write that changes nothing (%s)",
  dialect => {
    it("writes only the documents still to go when the rest are already live", async () => {
      const t = await boot(dialect);
      // What a pass the host ended part-way leaves behind: two documents of
      // the release already published, one not yet.
      const live1 = await entry(t, "one", "published");
      const live2 = await entry(t, "two", "published");
      const waiting = await entry(t, "three", "draft");
      const releaseId = await dueReleaseOf(t, [live1, live2, waiting]);
      changes = 0;

      const result = await materialise(t);

      expect(changes).toBe(1);
      expect(result.failed).toBe(0);
      expect((await stored(t, waiting))?.status).toBe("published");
      expect((await t.nextly.releases.findByID({ id: releaseId }))?.state).toBe(
        "published"
      );
    });

    it("still writes a published document holding a working draft, and puts the draft live", async () => {
      const t = await boot(dialect);
      const id = await entry(t, "live title", "published");
      // A status-less save on a drafts-enabled collection holds the edit as
      // a working draft and leaves the live row alone.
      await handlerOf(t).updateEntry(
        { collectionName: SLUG, entryId: id, overrideAccess: true },
        { title: "pending title" }
      );
      expect((await stored(t, id))?.title).toBe("live title");
      await dueReleaseOf(t, [id]);
      changes = 0;

      await materialise(t);

      expect(changes).toBe(1);
      expect((await stored(t, id))?.title).toBe("pending title");
      expect(
        await new VersionsRepository(t.adapter).listWorkingDraftLocales({
          scopeKind: "collection",
          scopeSlug: SLUG,
          entryId: id,
        })
      ).toEqual([]);
    });
  }
);
