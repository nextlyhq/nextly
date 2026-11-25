/**
 * A release's run meets a write refused over a field a Builder save changed, and one refused for a
 * moment, against a real database through the real content write.
 *
 * The field refusals are thrown with the exact codes and field paths the entry write uses for
 * them (`VALIDATION_ERROR` at `fields.<name>` coded `FIELD_REMOVED`; `BUILDER_SAVE_FIELD_UNSETTLED`
 * naming its fields), by a write that otherwise is the real one: what the run makes of them is the
 * question here, not how the entry write comes to refuse. The stop is recorded on the member in
 * the stop's own transaction, read back through the Direct API, and left stale by scheduling the
 * release again, after which the run, the field settled, publishes it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { applyDueReleases, type ReleaseMutations } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  lockServerOf,
  scheduleAsItStands,
} from "./helpers/release-writes";

const SLUG = "posts";
const PAST = new Date("2020-01-01T09:00:00.000Z");

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
  });
  current = t;
  return t;
}

/** A release of one draft, added and owned by `author`, due at `PAST`. */
async function dueRelease(
  t: TestNextly,
  author: string
): Promise<{ id: string; entryId: string; memberId: string }> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "First", subtitle: "Sub", status: "draft" }
  );
  const entryId = (created.data as { id?: string } | undefined)?.id;
  if (typeof entryId !== "string") throw new Error("no id from create");
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Launch",
    createdBy: author,
  });
  const member = await repo.addMember(
    {
      releaseId: release.id,
      scopeKind: "collection",
      scopeSlug: SLUG,
      entryId,
      locale: null,
      action: "publish",
      createdBy: author,
    },
    ANY_EDITABLE_STATE
  );
  await scheduleAsItStands(repo, release.id, PAST, "Europe/Berlin");
  return { id: release.id, entryId, memberId: member.id };
}

/** One pass, with the real write wrapped by `wrap`, and no real waiting between tries. */
function pass(
  t: TestNextly,
  wrap: (real: ReleaseMutations) => ReleaseMutations = real => real
) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: wrap(
      createReleaseMutations({
        contentApi: t.nextly,
        lockServer: lockServerOf(t),
      })
    ),
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
    sleep: async () => {},
  });
}

/** The real write, its publish refused with `error` every time. */
function publishRefusedWith(error: () => unknown) {
  return (real: ReleaseMutations): ReleaseMutations => ({
    publish: async () => {
      throw error();
    },
    unpublish: input => real.unpublish(input),
  });
}

async function stateOf(t: TestNextly, id: string): Promise<string | undefined> {
  return (await t.nextly.releases.findByID({ id }))?.state;
}

async function statusOf(t: TestNextly, entryId: string): Promise<unknown> {
  const [row] = await t.adapter.select<{ status: unknown }>(`dc_${SLUG}`, {
    columns: ["status"],
    where: { and: [{ column: "id", op: "=", value: entryId }] },
  });
  return row?.status;
}

describe.each(getConfiguredTestDialects())(
  "a release's run over a field a Builder save changed (%s)",
  dialect => {
    // Broken (taken for a failed write), the release stays scheduled, is tried every pass, and
    // nothing says which field; broken in the read (the stop not kept for its revision), a release
    // run again still reads as stopped over the field.
    it("stops the release, names the field, and forgets it once the release is scheduled again", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { id, entryId, memberId } = await dueRelease(t, author);

      const stopped = await pass(
        t,
        publishRefusedWith(() =>
          NextlyError.validation({
            errors: [
              {
                path: "fields.subtitle",
                code: "FIELD_REMOVED",
                message: "subtitle was removed from this collection.",
              },
            ],
          })
        )
      );

      expect(stopped.blocked).toBe(1);
      expect(await stateOf(t, id)).toBe("blocked");
      expect(
        await t.nextly.releases.fieldStopsOf({ releaseIds: [id] })
      ).toEqual({
        [id]: {
          items: [
            {
              memberId,
              reason: "FIELD_REMOVED",
              field: "subtitle",
              action: "publish",
              scopeKind: "collection",
              scopeSlug: SLUG,
              entryId,
            },
          ],
          hidden: 0,
        },
      });

      // Run again, the field settled: the stop no longer describes the release, and it publishes.
      await scheduleAsItStands(
        new ReleasesRepository(t.adapter),
        id,
        PAST,
        "Europe/Berlin"
      );
      expect(
        await t.nextly.releases.fieldStopsOf({ releaseIds: [id] })
      ).toEqual({
        [id]: { items: [], hidden: 0 },
      });
      const ran = await pass(t);
      expect(ran.published).toBe(1);
      expect(await statusOf(t, entryId)).toBe("published");
    }, 120_000);

    it("stops on a Builder save left part-way, naming the fields its refusal names", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { id } = await dueRelease(t, author);

      await pass(
        t,
        publishRefusedWith(
          () =>
            new NextlyError({
              code: "BUILDER_SAVE_FIELD_UNSETTLED",
              publicMessage:
                "A Builder save of the collection was left part-way.",
              logContext: {
                reason: "builder-save-field-unsettled",
                kind: "collection",
                slug: SLUG,
                fields: ["subtitle", "title"],
              },
            })
        )
      );

      expect(await stateOf(t, id)).toBe("blocked");
      const view = (await t.nextly.releases.fieldStopsOf({ releaseIds: [id] }))[
        id
      ];
      expect(view?.items.map(stop => [stop.reason, stop.field])).toEqual([
        ["FIELD_UNSETTLED", "subtitle, title"],
      ]);
    }, 120_000);

    // Broken (no retry in the pass), the release is a failed write left for the next sweep.
    it("publishes in the same pass a write refused while its collection was being changed", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { id, entryId } = await dueRelease(t, author);
      let refusals = 1;

      const ran = await pass(t, real => ({
        publish: async input => {
          if (refusals > 0) {
            refusals -= 1;
            throw new NextlyError({
              code: "COLLECTION_BEING_CHANGED",
              publicMessage:
                "This collection is being changed elsewhere. Try again in a moment.",
            });
          }
          return real.publish(input);
        },
        unpublish: input => real.unpublish(input),
      }));

      expect(ran).toMatchObject({ published: 1, failed: 0, blocked: 0 });
      expect(await stateOf(t, id)).toBe("published");
      expect(await statusOf(t, entryId)).toBe("published");
    }, 120_000);
  }
);
