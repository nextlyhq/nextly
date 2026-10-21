/**
 * Adding several documents to a release, and scheduling a document, each in
 * one all-or-nothing step, against a real database on every dialect.
 *
 * What only a database can show:
 *
 * - that a step is ONE transaction: when its last write fails, every write
 *   before it is rolled back with it, so no release, member, event or
 *   revision bump is left. The failure is made by a database whose
 *   transactions refuse that one write, after the others have been made;
 * - that scheduling a document on its own makes a single-document release,
 *   scheduled, and with accepted linked documents an ordinary release
 *   holding all of them; that it goes into an existing release, and into a
 *   new one;
 * - that taking the document out of a single release that has not run
 *   (draft, scheduled or stopped) cancels it, and that a caller who may not
 *   cancel is refused with nothing changed;
 * - that a step with one document failing a check adds none of them;
 * - and that a step tells a caller nothing of a document they may not read.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CONTENT_EVENTS_TABLE } from "../../../schemas/content-events";
import { RELEASE_MEMBERS_TABLE, RELEASES_TABLE } from "../release-tables";
import {
  ReleasesRepository,
  type ReleaseRow,
  type ReleasesDbApi,
  type ReleasesTxApi,
} from "../releases-repository";
import { ReleasesService } from "../services/releases-service";

import { seedLiveAuthor } from "./helpers/live-author";
import { READY_CHECKS } from "./helpers/ready-checks";
import { ANY_EDITABLE_STATE } from "./helpers/release-writes";
import { keyHolding, rest } from "./helpers/rest-key";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Far enough ahead that no drain reaches it during a case. */
const AT = new Date("2099-01-10T09:00:00Z");

/** Anyone may read, write, publish and unpublish: access is not the subject. */
const OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};

type Slug = "posts" | "authors" | "secrets" | "articles" | "memos";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      // No read rule: who may read a secret is decided by grants alone.
      defineCollection({
        slug: "secrets",
        status: true,
        access: { update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "posts",
        status: true,
        access: OPEN,
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "authors" }),
          relationship({ name: "secret", relationTo: "secrets" }),
        ],
      }),
      // A required title, emptied on the stored row to make a hard problem.
      defineCollection({
        slug: "articles",
        status: true,
        access: OPEN,
        fields: [text({ name: "title", required: true })],
      }),
      // No access rules at all: acting on a memo is a grant's to allow.
      defineCollection({
        slug: "memos",
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

async function entry(
  t: TestNextly,
  collection: Slug,
  data: Record<string, unknown> = {}
): Promise<string> {
  const created = (await t.nextly.create({
    collection: collection as never,
    data: { title: collection, status: "draft", ...data } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  const id = created.item?.id ?? created.id;
  if (typeof id !== "string") throw new Error("no id from create");
  return id;
}

function doc(
  collection: Slug,
  entryId: string,
  action: "publish" | "unpublish" = "publish"
) {
  return {
    scopeKind: "collection" as const,
    scopeSlug: collection,
    entryId,
    locale: null,
    action,
  };
}

/** What a step could have left behind, counted. */
async function footprint(t: TestNextly) {
  const count = async (table: string) =>
    (await t.adapter.select<{ id: string }>(table, { columns: ["id"] })).length;
  return {
    releases: await count(RELEASES_TABLE),
    members: await count(RELEASE_MEMBERS_TABLE),
    events: await count(CONTENT_EVENTS_TABLE),
  };
}

async function releaseRow(t: TestNextly, id: string): Promise<ReleaseRow> {
  const [row] = await new ReleasesRepository(t.adapter).findReleases({
    ids: [id],
  });
  if (row === undefined) throw new Error(`no release ${id}`);
  return row;
}

/**
 * A release service over the real database whose transactions refuse ONE
 * write: the `nth` insert of a content event of `kind`, as a failing
 * database would refuse it, after every write before it in the transaction
 * has been made. `hits` says how many times it refused, so a case can tell
 * the failure was reached rather than the step refused earlier.
 */
function serviceFailing(
  t: TestNextly,
  failOn: { kind: string; nth: number } | null
): { svc: ReleasesService; hits: () => number; writes: () => number } {
  let seen = 0;
  let hits = 0;
  let writes = 0;
  const base = t.adapter as unknown as ReleasesDbApi;
  const failingTx = (tx: ReleasesTxApi): ReleasesTxApi =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "insert") {
          return async (
            table: string,
            data: Record<string, unknown>,
            ...rest: unknown[]
          ) => {
            if (
              failOn !== null &&
              table === CONTENT_EVENTS_TABLE &&
              data.kind === failOn.kind
            ) {
              seen += 1;
              if (seen === failOn.nth) {
                hits += 1;
                throw new Error("the last write could not be made");
              }
            }
            writes += 1;
            return (target.insert as (...a: unknown[]) => unknown)(
              table,
              data,
              ...rest
            );
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop === "transaction") {
        return (work: (tx: ReleasesTxApi) => Promise<unknown>) =>
          target.transaction(tx => work(failingTx(tx)));
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const svc = new ReleasesService({
    repository: new ReleasesRepository(db),
    // Every document is there and has a lifecycle: the checks are not the
    // subject here, the transaction is.
    targets: {
      readDocument: async target => ({ id: target.entryId }),
      declaresLifecycle: async () => true,
    },
    canManageReleases: async () => true,
    canActOnDocument: async () => true,
    runDrainNow: async () => undefined,
    readableMembers: async members => new Set(members.map(m => m.id)),
    checks: READY_CHECKS,
  });
  return { svc, hits: () => hits, writes: () => writes };
}

describe.each(getConfiguredTestDialects())(
  "a step whose last write fails leaves nothing behind (%s)",
  dialect => {
    it("adds none of several documents, and leaves the release's revision as it was", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const actor = { userId: author, overrideAccess: true };
      const release = await new ReleasesRepository(t.adapter).createRelease({
        title: "Spring",
        createdBy: author,
      });
      const docs = [
        doc("posts", await entry(t, "posts")),
        doc("posts", await entry(t, "posts"), "unpublish"),
        doc("authors", await entry(t, "authors")),
      ];
      const before = await footprint(t);

      const failing = serviceFailing(t, {
        kind: "release-document-added",
        nth: docs.length,
      });
      await expect(
        failing.svc.addMembers(release.id, docs, actor)
      ).rejects.toThrow("the last write could not be made");
      // The LAST write refused, after the release moved and the others were
      // written in the same transaction.
      expect(failing.hits()).toBe(1);
      expect(failing.writes()).toBeGreaterThanOrEqual(docs.length * 2 - 1);
      expect(await footprint(t)).toEqual(before);
      expect((await releaseRow(t, release.id)).revision).toBe(release.revision);

      // The control: the same step on a database that writes it lands whole.
      const ok = serviceFailing(t, null);
      const added = await ok.svc.addMembers(release.id, docs, actor);
      expect(added.members).toHaveLength(docs.length);
      expect(added.release.revision).toBe(release.revision + 1);
      expect(await footprint(t)).toEqual({
        ...before,
        members: before.members + docs.length,
        events: before.events + docs.length,
      });
    });

    it("schedules nothing of a document on its own, not even its release", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const actor = { userId: author, overrideAccess: true };
      const input = {
        into: "own" as const,
        document: doc("posts", await entry(t, "posts")),
        linked: [
          {
            scopeKind: "collection" as const,
            scopeSlug: "authors",
            entryId: await entry(t, "authors"),
          },
        ],
        title: "Hello world",
        at: AT,
        timezone: "Europe/Berlin",
      };
      const before = await footprint(t);

      // The schedule's event is the step's last write.
      const failing = serviceFailing(t, { kind: "release-scheduled", nth: 1 });
      await expect(failing.svc.scheduleDocument(input, actor)).rejects.toThrow(
        "the last write could not be made"
      );
      expect(failing.hits()).toBe(1);
      expect(await footprint(t)).toEqual(before);

      const ok = serviceFailing(t, null);
      const scheduled = await ok.svc.scheduleDocument(input, actor);
      expect(scheduled.release).toMatchObject({ state: "scheduled" });
      expect(await footprint(t)).toEqual({
        releases: before.releases + 1,
        members: before.members + 2,
        // Created, two documents added, scheduled.
        events: before.events + 4,
      });
    });

    it("makes no new release when its last document cannot be written", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const actor = { userId: author, overrideAccess: true };
      const input = {
        into: "new" as const,
        document: doc("posts", await entry(t, "posts")),
        linked: [
          {
            scopeKind: "collection" as const,
            scopeSlug: "authors",
            entryId: await entry(t, "authors"),
          },
        ],
        title: "Spring",
      };
      const before = await footprint(t);
      const failing = serviceFailing(t, {
        kind: "release-document-added",
        nth: 2,
      });
      await expect(failing.svc.scheduleDocument(input, actor)).rejects.toThrow(
        "the last write could not be made"
      );
      expect(failing.hits()).toBe(1);
      expect(await footprint(t)).toEqual(before);
    });

    it("leaves an existing scheduled release as it was when its last document cannot be written", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const actor = { userId: author, overrideAccess: true };
      const repo = new ReleasesRepository(t.adapter);
      const release = await repo.createRelease({
        title: "Spring",
        createdBy: author,
      });
      await repo.addMember(
        {
          ...doc("posts", await entry(t, "posts")),
          releaseId: release.id,
          createdBy: author,
        },
        ANY_EDITABLE_STATE
      );
      await repo.scheduleRelease(
        release.id,
        AT,
        "UTC",
        ["draft"],
        (await releaseRow(t, release.id)).revision
      );
      const scheduled = await releaseRow(t, release.id);
      const addedPost = await entry(t, "posts");
      const before = await footprint(t);
      const failing = serviceFailing(t, {
        kind: "release-document-added",
        nth: 1,
      });
      await expect(
        failing.svc.scheduleDocument(
          {
            into: "existing",
            document: doc("posts", addedPost),
            releaseId: release.id,
          },
          actor
        )
      ).rejects.toThrow("the last write could not be made");
      expect(failing.hits()).toBe(1);
      expect(await footprint(t)).toEqual(before);
      expect(await releaseRow(t, release.id)).toMatchObject({
        state: "scheduled",
        revision: scheduled.revision,
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "scheduling a document in one step (%s)",
  dialect => {
    it("on its own, makes a single-document release holding it, scheduled", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const post = await entry(t, "posts");
      const { release, members } = await t.nextly.releases.scheduleDocument({
        into: "own",
        document: doc("posts", post),
        title: "Hello world",
        at: AT,
        timezone: "Europe/Berlin",
        userId: author,
      });
      expect(release).toMatchObject({
        kind: "single",
        title: "Hello world",
        state: "scheduled",
        timezone: "Europe/Berlin",
        createdBy: author,
      });
      expect(new Date(release.scheduledAt ?? 0).getTime()).toBe(AT.getTime());
      expect(members.map(m => [m.entryId, m.action, m.createdBy])).toEqual([
        [post, "publish", author],
      ]);
      const stored = await t.nextly.releases.listMembers({
        releaseId: release.id,
      });
      expect(stored.map(m => m.entryId)).toEqual([post]);
      // A single release takes no second document.
      await expect(
        t.nextly.releases.addMember({
          releaseId: release.id,
          ...doc("posts", await entry(t, "posts")),
          userId: author,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("with linked documents, makes an ordinary release holding all of them", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const writer = await entry(t, "authors");
      const post = await entry(t, "posts", { author: writer });
      const { release, members } = await t.nextly.releases.scheduleDocument({
        into: "own",
        document: doc("posts", post),
        linked: [
          { scopeKind: "collection", scopeSlug: "authors", entryId: writer },
        ],
        title: "Hello world",
        at: AT,
        timezone: "UTC",
        userId: author,
      });
      expect(release).toMatchObject({
        kind: "release",
        title: "Hello world",
        state: "scheduled",
      });
      expect(members.map(m => [m.scopeSlug, m.entryId, m.action])).toEqual([
        ["posts", post, "publish"],
        ["authors", writer, "publish"],
      ]);
      // Going live in the same step, the author is no unpublished link.
      expect(members[0].unpublishedLinks.links).toEqual([]);
    });

    it("goes into an existing draft or scheduled release, at that release's time", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const draft = await t.nextly.releases.create({ title: "Spring" });
      const intoDraft = await t.nextly.releases.scheduleDocument({
        into: "existing",
        document: doc("posts", await entry(t, "posts")),
        releaseId: draft.id,
        userId: author,
      });
      expect(intoDraft.release).toMatchObject({ id: draft.id, state: "draft" });

      const launch = await t.nextly.releases.create({ title: "Summer" });
      await t.nextly.releases.addMember({
        releaseId: launch.id,
        ...doc("posts", await entry(t, "posts")),
        userId: author,
      });
      await t.nextly.releases.schedule({
        id: launch.id,
        at: AT,
        timezone: "UTC",
      });
      const intoScheduled = await t.nextly.releases.scheduleDocument({
        into: "existing",
        document: doc("posts", await entry(t, "posts"), "unpublish"),
        releaseId: launch.id,
        userId: author,
      });
      expect(intoScheduled.release).toMatchObject({
        id: launch.id,
        state: "scheduled",
      });
      expect(new Date(intoScheduled.release.scheduledAt ?? 0).getTime()).toBe(
        AT.getTime()
      );
      expect(
        await t.nextly.releases.listMembers({ releaseId: launch.id })
      ).toHaveLength(2);

      // Never a single-document release, nor a finished one.
      const single = await t.nextly.releases.create({
        title: "Alone",
        kind: "single",
      });
      await expect(
        t.nextly.releases.scheduleDocument({
          into: "existing",
          document: doc("posts", await entry(t, "posts")),
          releaseId: single.id,
          userId: author,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await t.nextly.releases.cancel({ id: draft.id });
      await expect(
        t.nextly.releases.scheduleDocument({
          into: "existing",
          document: doc("posts", await entry(t, "posts")),
          releaseId: draft.id,
          userId: author,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("goes into a new release, a draft holding it", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const post = await entry(t, "posts");
      const { release, members } = await t.nextly.releases.scheduleDocument({
        into: "new",
        document: doc("posts", post),
        title: "Autumn",
        description: "The autumn launch",
        userId: author,
      });
      expect(release).toMatchObject({
        kind: "release",
        title: "Autumn",
        description: "The autumn launch",
        state: "draft",
        scheduledAt: null,
      });
      expect(members.map(m => m.entryId)).toEqual([post]);
      expect(
        (await t.nextly.releases.listMembers({ releaseId: release.id })).map(
          m => m.entryId
        )
      ).toEqual([post]);
    });

    it("refuses scheduling a document with a hard problem, and writes nothing", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const article = await entry(t, "articles", { title: "Fine" });
      await t.adapter.update(
        "dc_articles",
        { title: "" },
        { and: [{ column: "id", op: "=", value: article }] }
      );
      const before = await footprint(t);
      await expect(
        t.nextly.releases.scheduleDocument({
          into: "own",
          document: doc("articles", article),
          title: "Broken",
          at: AT,
          timezone: "UTC",
          userId: author,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicData: {
          problems: [
            {
              memberId: null,
              code: "REQUIRED_FIELD_MISSING",
              document: {
                scopeKind: "collection",
                scopeSlug: "articles",
                entryId: article,
              },
            },
          ],
        },
      });
      expect(await footprint(t)).toEqual(before);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "taking the document out of a single release that has not run (%s)",
  dialect => {
    /** A single release holding one post, in `state`. */
    async function singleIn(
      t: TestNextly,
      author: string,
      state: "draft" | "scheduled" | "blocked"
    ): Promise<{ releaseId: string; memberId: string }> {
      if (state === "draft") {
        const release = await t.nextly.releases.create({
          title: "Alone",
          kind: "single",
        });
        const member = await t.nextly.releases.addMember({
          releaseId: release.id,
          ...doc("posts", await entry(t, "posts")),
          userId: author,
        });
        return { releaseId: release.id, memberId: member.id };
      }
      const { release, members } = await t.nextly.releases.scheduleDocument({
        into: "own",
        document: doc("posts", await entry(t, "posts")),
        title: "Alone",
        at: AT,
        timezone: "UTC",
        userId: author,
      });
      if (state === "blocked") {
        const row = await releaseRow(t, release.id);
        const stopped = await new ReleasesRepository(t.adapter).blockReleases([
          {
            id: row.id,
            scheduledAt: row.scheduledAt ?? AT,
            revision: row.revision,
          },
        ]);
        expect(stopped).toEqual([release.id]);
      }
      return { releaseId: release.id, memberId: members[0].id };
    }

    for (const state of ["draft", "scheduled", "blocked"] as const) {
      it(`cancels a ${state} single release, and keeps it with its document`, async () => {
        const t = await boot(dialect);
        const author = await seedLiveAuthor(t);
        const { releaseId, memberId } = await singleIn(t, author, state);
        expect((await releaseRow(t, releaseId)).state).toBe(state);

        await t.nextly.releases.removeMember({ releaseId, memberId });

        expect(await releaseRow(t, releaseId)).toMatchObject({
          state: "cancelled",
        });
        // Never deleted, and the document stays as the record of what it
        // was for.
        expect(
          (await t.nextly.releases.listMembers({ releaseId })).map(m => m.id)
        ).toEqual([memberId]);
      });
    }

    it("refuses whoever may not cancel, and changes nothing", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const assembler = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
      ]);
      const publisher = await keyHolding(
        t,
        [
          "read-content-releases",
          "create-content-releases",
          "publish-content-releases",
        ],
        { email: "publisher@example.com", name: "Publisher" }
      );
      for (const state of ["draft", "scheduled"] as const) {
        const { releaseId, memberId } = await singleIn(t, author, state);
        const before = await releaseRow(t, releaseId);
        const refused = await rest(assembler.key, "DELETE", [
          "releases",
          releaseId,
          "members",
          memberId,
        ]);
        expect(refused.status, state).toBe(403);
        expect(await releaseRow(t, releaseId), state).toMatchObject({
          state,
          revision: before.revision,
        });
        expect(
          await t.nextly.releases.listMembers({ releaseId }),
          state
        ).toHaveLength(1);

        // The control: the same request from whoever may cancel cancels it.
        const allowed = await rest(publisher.key, "DELETE", [
          "releases",
          releaseId,
          "members",
          memberId,
        ]);
        expect(allowed.status, state).toBe(200);
        expect((await releaseRow(t, releaseId)).state, state).toBe("cancelled");
      }
    });

    it("refuses taking the document out of a single release that was published", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { releaseId, memberId } = await singleIn(t, author, "scheduled");
      const row = await releaseRow(t, releaseId);
      await new ReleasesRepository(t.adapter).markReleasesPublished(
        [
          {
            id: releaseId,
            revision: row.revision,
            scheduledAt: row.scheduledAt ?? AT,
          },
        ],
        new Date()
      );
      await expect(
        t.nextly.releases.removeMember({ releaseId, memberId })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await releaseRow(t, releaseId)).state).toBe("published");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a step with one document failing a check adds none (%s)",
  dialect => {
    it("adds none when one document is not there", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Spring" });
      const firstPost = await entry(t, "posts");
      const lastPost = await entry(t, "posts");
      const before = await footprint(t);
      await expect(
        t.nextly.releases.addMembers({
          releaseId: release.id,
          members: [
            doc("posts", firstPost),
            doc("posts", "00000000-0000-4000-8000-00000000dead"),
            doc("posts", lastPost),
          ],
          userId: author,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await footprint(t)).toEqual(before);
      expect((await releaseRow(t, release.id)).revision).toBe(release.revision);
    });

    it("adds none to a scheduled release when one has a hard problem, which it names", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Spring" });
      await t.nextly.releases.addMember({
        releaseId: release.id,
        ...doc("articles", await entry(t, "articles")),
        userId: author,
      });
      await t.nextly.releases.schedule({
        id: release.id,
        at: AT,
        timezone: "UTC",
      });
      const broken = await entry(t, "articles", { title: "Fine" });
      await t.adapter.update(
        "dc_articles",
        { title: "" },
        { and: [{ column: "id", op: "=", value: broken }] }
      );
      const scheduled = await releaseRow(t, release.id);
      const fineArticle = await entry(t, "articles");
      const before = await footprint(t);
      await expect(
        t.nextly.releases.addMembers({
          releaseId: release.id,
          members: [doc("articles", fineArticle), doc("articles", broken)],
          userId: author,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicData: {
          problems: [
            {
              memberId: null,
              code: "REQUIRED_FIELD_MISSING",
              document: { scopeSlug: "articles", entryId: broken },
            },
          ],
        },
      });
      expect(await footprint(t)).toEqual(before);
      expect(await releaseRow(t, release.id)).toMatchObject({
        state: "scheduled",
        revision: scheduled.revision,
      });
    });

    it("adds none when one document is one the caller may not act on", async () => {
      // The key may publish posts, and may read memos but not publish them.
      const t = await boot(dialect);
      await seedLiveAuthor(t);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
        "read-memos",
        "update-memos",
      ]);
      const release = (
        await rest(key, "POST", ["releases"], { title: "Spring" })
      ).json.item as { id: string };
      const ownPost = await entry(t, "posts");
      const memo = await entry(t, "memos");
      const before = await footprint(t);
      const refused = await rest(
        key,
        "POST",
        ["releases", release.id, "members", "batch"],
        {
          members: [doc("posts", ownPost), doc("memos", memo)],
        }
      );
      expect(refused.status).toBe(403);
      expect(await footprint(t)).toEqual(before);

      // The control: the post alone is the key's to add.
      const alone = await rest(
        key,
        "POST",
        ["releases", release.id, "members", "batch"],
        { members: [doc("posts", await entry(t, "posts"))] }
      );
      expect(alone.status).toBe(201);
    });

    it("refuses the whole selection past the limit, saying how many fit", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const release = await t.nextly.releases.create({ title: "Spring" });
      // Filled to two short of the limit in one write, below the service.
      await new ReleasesRepository(t.adapter).addMembers({
        releaseId: release.id,
        members: Array.from({ length: 198 }, (_, i) => ({
          ...doc("posts", `filler-${i}`),
          releaseId: release.id,
          createdBy: author,
        })),
        allowedStates: ANY_EDITABLE_STATE,
      });
      const postA = await entry(t, "posts");
      const postB = await entry(t, "posts");
      const postC = await entry(t, "posts");
      const before = await footprint(t);
      await expect(
        t.nextly.releases.addMembers({
          releaseId: release.id,
          members: [
            doc("posts", postA),
            doc("posts", postB),
            doc("posts", postC),
          ],
          userId: author,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("so 2 more fit, not 3"),
      });
      expect(await footprint(t)).toEqual(before);
      // Two fit.
      const two = await t.nextly.releases.addMembers({
        releaseId: release.id,
        members: [
          doc("posts", await entry(t, "posts")),
          doc("posts", await entry(t, "posts")),
        ],
        userId: author,
      });
      expect(two.members).toHaveLength(2);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a step, as a reader may see it (%s)",
  dialect => {
    it("never names a document the caller may not read", async () => {
      const t = await boot(dialect);
      const author = await seedLiveAuthor(t);
      const { key } = await keyHolding(t, [
        "read-content-releases",
        "create-content-releases",
        "read-posts",
        "update-posts",
        "publish-posts",
        "read-authors",
        "update-authors",
        "publish-authors",
      ]);
      const writer = await entry(t, "authors");
      const secret = await entry(t, "secrets");
      const post = await entry(t, "posts", { author: writer, secret });

      // A release already holding a secret, put there by someone who may.
      const release = await t.nextly.releases.create({ title: "Spring" });
      const held = await t.nextly.releases.addMember({
        releaseId: release.id,
        ...doc("secrets", await entry(t, "secrets")),
        userId: author,
      });

      const added = await rest(
        key,
        "POST",
        ["releases", release.id, "members", "batch"],
        { members: [doc("posts", post), doc("authors", writer)] }
      );
      expect(added.status).toBe(201);
      const item = added.json.item as {
        members: Array<{ entryId: string; unpublishedLinks: unknown }>;
      };
      // Only the documents the step added, never the release's others.
      expect(item.members.map(m => m.entryId)).toEqual([post, writer]);
      // The author goes live in the same step, so it is no unpublished link;
      // the secret is counted, never named.
      expect(item.members[0].unpublishedLinks).toEqual({
        links: [],
        hiddenCount: 1,
        inHiddenFields: 0,
        deletedLinks: [],
      });
      const body = JSON.stringify(added.json);
      expect(body).not.toContain(secret);
      expect(body).not.toContain(held.entryId);

      // The same through the one-step schedule, into the same release.
      const another = await entry(t, "posts", { secret });
      const scheduled = await rest(
        key,
        "POST",
        ["releases", "schedule-document"],
        {
          into: "existing",
          document: doc("posts", another),
          releaseId: release.id,
        }
      );
      expect(scheduled.status).toBe(201);
      expect(JSON.stringify(scheduled.json)).not.toContain(secret);
      expect(JSON.stringify(scheduled.json)).not.toContain(held.entryId);

      // A secret the key names is a document that is not there, and the
      // step adds nothing.
      const otherPost = await entry(t, "posts");
      const before = await footprint(t);
      const refused = await rest(
        key,
        "POST",
        ["releases", release.id, "members", "batch"],
        {
          members: [doc("posts", otherPost), doc("secrets", secret)],
        }
      );
      // Refused on the caller's authority for it, before it is read, as one
      // add refuses it.
      expect(refused.status).toBe(403);
      expect(await footprint(t)).toEqual(before);

      // The control: a trusted step names the secret link, so the count
      // above stands for a link withheld, not one never found.
      const trusted = await t.nextly.releases.addMembers({
        releaseId: (await t.nextly.releases.create({ title: "Trusted" })).id,
        members: [doc("posts", post)],
        userId: author,
      });
      expect(
        trusted.members[0].unpublishedLinks.links.map(l => l.entryId).sort()
      ).toEqual([secret, writer].sort());
    });
  }
);
