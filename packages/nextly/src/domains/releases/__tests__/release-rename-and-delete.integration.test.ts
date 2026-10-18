/**
 * Renaming and deleting a release, each under its own permission, on every
 * dialect and through both ways in: the Direct API as a person, and REST as an
 * API key whose role holds exactly the grants named.
 *
 * Every refusal is paired with the same request from a caller who holds the
 * permission, and every caller refused holds all FOUR other release
 * permissions. So a check that asked the wrong permission (`create` for a
 * rename, `publish` for a delete), or refused everyone, fails a named case.
 *
 * A delete is tried from each of the five states. Only a draft and a cancelled
 * release go; a scheduled, stopped or published one stays, with its
 * documents, and a deleted release takes its documents with it and nothing of
 * any other release's.
 *
 * And each rename and deletion is in the activity log, with who made it.
 *
 * A rename decides whether it changes anything under the release's lock, and
 * answers and records the row it wrote: two cases force another write into
 * the gap before and after its transaction to show it.
 */

// Set before the harness boots: signing API keys reads it once.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { ReleaseActivityEntry } from "../release-activity";
import { ReleasesRepository, type ReleasesDbApi } from "../releases-repository";
import { ReleasesService } from "../services/releases-service";

import { seedLiveAuthor } from "./helpers/live-author";
import { READY_CHECKS } from "./helpers/ready-checks";
import { scheduleAsItStands } from "./helpers/release-writes";

const UPDATE = "update-content-releases";
const DELETE = "delete-content-releases";
const ALL_BUT = (held: string): string[] =>
  [
    "read-content-releases",
    "create-content-releases",
    "publish-content-releases",
    UPDATE,
    DELETE,
  ].filter(slug => slug !== held);

let current: TestNextly | undefined;
/** The first user, made super-admin by being first: it mints every key. */
let founder: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  founder = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(current);
  return current;
}

let roleSeq = 0;

/** A role holding exactly these permissions, by slug. */
async function roleHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const permissions = (await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  )) as Array<{ id: string; slug: string }>;
  const ids = slugs.map(slug => {
    const found = permissions.find(p => p.slug === slug);
    // Asserted, so a refusal below cannot be for a permission never seeded.
    expect(found, `${slug} is seeded`).toBeDefined();
    return String(found!.id);
  });
  roleSeq += 1;
  const role = await new ServiceContainer(t.adapter).roles.createRole({
    name: `Release role ${roleSeq}`,
    slug: `release-role-${roleSeq}`,
    permissionIds: ids,
  });
  return role.id;
}

/** An active person whose only role holds exactly these permissions. */
async function personHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const user = await seedLiveAuthor(t);
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(user, await roleHolding(t, slugs));
  expect(assigned.success).toBe(true);
  return user;
}

/** A role-based API key whose role holds exactly these permissions. */
async function keyHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(founder!, {
    name: `key ${slugs.join(" ")}`,
    tokenType: "role-based",
    roleId: await roleHolding(t, slugs),
    expiresIn: "unlimited",
  });
  return key;
}

/** One REST request to a release, as the key. */
async function rest(
  key: string,
  verb: "PATCH" | "DELETE",
  id: string,
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const request = new Request(`http://localhost/api/releases/${id}`, {
    method: verb,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ params: ["releases", id] }) };
  return verb === "PATCH"
    ? handlers.PATCH(request, context)
    : handlers.DELETE(request, context);
}

/** One adapter write to a release row, outside any service: another request. */
async function competingWrite(
  t: TestNextly,
  id: string,
  values: Record<string, unknown>
): Promise<void> {
  await (
    t.adapter as unknown as {
      update: (
        table: string,
        values: Record<string, unknown>,
        where: unknown
      ) => Promise<unknown>;
    }
  ).update("nextly_releases", values, {
    and: [{ column: "id", op: "=", value: id }],
  });
}

/**
 * A release service over the real database whose FIRST repository
 * transaction has another request's write land just before it opens and
 * just after it commits. Trusted, so the case is the interleaving and not
 * authority; the entries it records are kept for the case to read.
 */
function interleavedService(
  t: TestNextly,
  around: { before?: () => Promise<void>; after?: () => Promise<void> }
): { svc: ReleasesService; recorded: ReleaseActivityEntry[] } {
  const base = t.adapter as unknown as ReleasesDbApi;
  let first = true;
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop === "transaction") {
        return async (work: never) => {
          const forced = first;
          first = false;
          if (forced) await around.before?.();
          const result = await target.transaction(work);
          if (forced) await around.after?.();
          return result;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const recorded: ReleaseActivityEntry[] = [];
  const svc = new ReleasesService({
    repository: new ReleasesRepository(db),
    targets: {
      readDocument: async () => null,
      declaresLifecycle: async () => false,
    },
    canManageReleases: async () => true,
    canActOnDocument: async () => true,
    runDrainNow: async () => undefined,
    // A rename asks no document check; the stub answers every one as ready.
    checks: READY_CHECKS,
    recordActivity: async entry => {
      recorded.push(entry);
    },
  });
  return { svc, recorded };
}

async function titleOf(t: TestNextly, id: string): Promise<string | null> {
  const row = await t.nextly.releases.findByID({ id });
  return row === null ? null : row.title;
}

/** A draft release holding one post, trusted, with a live author. */
async function releaseWithAPost(
  t: TestNextly,
  title: string
): Promise<{ id: string; memberId: string }> {
  const post = (await t.nextly.create({
    collection: "posts" as never,
    data: { title: "Draft", status: "draft" } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  const release = await t.nextly.releases.create({ title });
  const member = await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: String(post.item?.id ?? post.id),
    locale: null,
    action: "publish",
    userId: founder!,
  });
  return { id: release.id, memberId: member.id };
}

async function membersOf(t: TestNextly, releaseId: string): Promise<unknown[]> {
  return t.adapter.select("nextly_release_members", {
    where: { and: [{ column: "releaseId", op: "=", value: releaseId }] },
  });
}

/** A release in `state`, arrived at by the moves that produce it. */
async function releaseIn(
  t: TestNextly,
  state: "draft" | "scheduled" | "blocked" | "published" | "cancelled"
): Promise<string> {
  const { id } = await releaseWithAPost(t, `A ${state} release`);
  if (state === "draft") return id;
  if (state === "cancelled") {
    await t.nextly.releases.cancel({ id });
    return id;
  }
  const repo = new ReleasesRepository(t.adapter as never);
  const at = new Date(Date.now() + 86_400_000);
  expect(await scheduleAsItStands(repo, id, at, "UTC")).toBe(true);
  if (state === "blocked") {
    const [scheduled] = await repo.findReleases({ ids: [id] });
    expect(
      await repo.blockReleases([{ id, scheduledAt: scheduled.scheduledAt! }])
    ).toEqual([id]);
  }
  if (state === "published") {
    expect(await repo.markReleasePublished(id, new Date())).toBe(true);
  }
  const [row] = await repo.findReleases({ ids: [id] });
  expect(row.state).toBe(state);
  return id;
}

interface ActivityRow {
  actorType: string | null;
  userId: string;
  action: string;
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: string | Record<string, unknown> | null;
}

async function releaseActivity(t: TestNextly): Promise<ActivityRow[]> {
  return t.adapter.select<ActivityRow>("activity_log", {
    where: {
      and: [{ column: "collection", op: "=", value: "content-releases" }],
    },
  });
}

function metadataOf(row: ActivityRow): Record<string, unknown> {
  if (row.metadata === null) return {};
  return typeof row.metadata === "string"
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : row.metadata;
}

describe.each(getConfiguredTestDialects())(
  "renaming and deleting a release (%s)",
  dialect => {
    it("lets a holder of update rename a release and change its description through the Direct API, and refuses anyone else", async () => {
      const t = await boot(dialect);
      const renamer = await personHolding(t, [UPDATE]);
      const other = await personHolding(t, ALL_BUT(UPDATE));
      const release = await t.nextly.releases.create({
        title: "Spring launch",
        description: "First notes",
      });

      await expect(
        t.nextly.releases.update({
          id: release.id,
          title: "Taken over",
          userId: other,
          overrideAccess: false,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await titleOf(t, release.id)).toBe("Spring launch");

      const renamed = await t.nextly.releases.update({
        id: release.id,
        title: "Summer launch",
        description: "Moved to June",
        userId: renamer,
        overrideAccess: false,
      });
      expect(renamed).toMatchObject({
        title: "Summer launch",
        description: "Moved to June",
        // A fenced move: the revision a schedule judged before it is fenced
        // on has moved on.
        revision: release.revision + 1,
      });
      expect(await titleOf(t, release.id)).toBe("Summer launch");

      // The description alone, and cleared.
      const cleared = await t.nextly.releases.update({
        id: release.id,
        description: null,
        userId: renamer,
        overrideAccess: false,
      });
      expect(cleared).toMatchObject({
        title: "Summer launch",
        description: null,
      });
    });

    it("renames a release that ran without moving it in the Done tab", async () => {
      // A finished release's `updatedAt` is the instant it finished, and the
      // Done tab orders by it. A rename that touched it would bring an old
      // launch to the top of the history as if it had just happened.
      const t = await boot(dialect);
      for (const state of ["published", "cancelled"] as const) {
        const id = await releaseIn(t, state);
        // Finished a day ago, so a rename that stamped `updatedAt` with now
        // differs from it on every dialect, SQLite's whole seconds included.
        const finished = new Date(Date.now() - 86_400_000);
        await (
          t.adapter as unknown as {
            update: (
              table: string,
              values: Record<string, unknown>,
              where: unknown
            ) => Promise<unknown>;
          }
        ).update(
          "nextly_releases",
          { updatedAt: finished },
          { and: [{ column: "id", op: "=", value: id }] }
        );
        const before = await t.nextly.releases.findByID({ id });
        expect(
          Math.abs(new Date(before!.updatedAt).getTime() - finished.getTime())
        ).toBeLessThan(1000);
        const renamed = await t.nextly.releases.update({
          id,
          title: `Renamed ${state}`,
        });
        expect(renamed.title).toBe(`Renamed ${state}`);
        expect(renamed.state, state).toBe(state);
        expect(new Date(renamed.updatedAt).getTime(), state).toBe(
          new Date(before!.updatedAt).getTime()
        );
      }
    });

    it("decides a rename under the release's lock: a title another request already set is no change", async () => {
      const t = await boot(dialect);
      const release = await t.nextly.releases.create({ title: "Old" });
      // Another request sets the same title after this one could have read
      // the release, and before its transaction takes the lock.
      const { svc, recorded } = interleavedService(t, {
        before: () => competingWrite(t, release.id, { title: "Launch" }),
      });

      const answered = await svc.update(
        release.id,
        { title: "Launch" },
        { userId: null, overrideAccess: true }
      );

      expect(answered).toMatchObject({ title: "Launch", revision: 0 });
      // Nothing written by this request: the revision a schedule is fenced
      // on did not move, and nothing was recorded as its change.
      const stored = await t.nextly.releases.findByID({ id: release.id });
      expect(stored?.revision).toBe(0);
      expect(recorded).toEqual([]);
    });

    it("answers and records the row a rename wrote, not a later one", async () => {
      const t = await boot(dialect);
      const release = await t.nextly.releases.create({ title: "Old" });
      // Another request renames it again the moment this one commits.
      const { svc, recorded } = interleavedService(t, {
        after: () => competingWrite(t, release.id, { title: "Someone else's" }),
      });

      const answered = await svc.update(
        release.id,
        { title: "Launch" },
        { userId: null, overrideAccess: true }
      );

      expect(answered).toMatchObject({ title: "Launch", revision: 1 });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        action: "update",
        release: { id: release.id, title: "Launch" },
        changedFields: ["title"],
      });
      // The control: the later write did land, so the answer above is this
      // request's own row and not the stored one.
      expect(await titleOf(t, release.id)).toBe("Someone else's");
    });

    it("lets a key holding update rename a release over REST, and refuses a key without it", async () => {
      const t = await boot(dialect);
      const release = await t.nextly.releases.create({ title: "Spring" });

      const refused = await rest(
        await keyHolding(t, ALL_BUT(UPDATE)),
        "PATCH",
        release.id,
        { title: "Taken over" }
      );
      expect(refused.status).toBe(403);
      expect(await titleOf(t, release.id)).toBe("Spring");

      const allowed = await rest(
        await keyHolding(t, [UPDATE]),
        "PATCH",
        release.id,
        { title: "Summer", description: "Notes" }
      );
      expect(allowed.status).toBe(200);
      const body = (await allowed.json()) as {
        item: { title: string; description: string | null };
      };
      expect(body.item).toMatchObject({
        title: "Summer",
        description: "Notes",
      });
      expect(await titleOf(t, release.id)).toBe("Summer");
    });

    it("deletes a draft or a cancelled release, with its documents, for a holder of delete", async () => {
      const t = await boot(dialect);
      const deleter = await personHolding(t, [DELETE]);
      const other = await personHolding(t, ALL_BUT(DELETE));
      // A release that is not touched, holding a document of its own: the
      // control that a delete removes ONE release's documents.
      const bystander = await releaseWithAPost(t, "Bystander");

      for (const state of ["draft", "cancelled"] as const) {
        const id = await releaseIn(t, state);
        expect(await membersOf(t, id)).toHaveLength(1);

        await expect(
          t.nextly.releases.delete({ id, userId: other, overrideAccess: false })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await titleOf(t, id)).not.toBeNull();

        await t.nextly.releases.delete({
          id,
          userId: deleter,
          overrideAccess: false,
        });
        expect(await t.nextly.releases.findByID({ id }), state).toBeNull();
        expect(await membersOf(t, id), state).toEqual([]);
      }
      expect(await membersOf(t, bystander.id)).toHaveLength(1);
    });

    it("refuses to delete a cancelled release that was ever scheduled, and deletes one that never was", async () => {
      // Nothing stored says whether a cancelled release began to run: one
      // stopped part-way and then cancelled has put content live, and reads
      // like any other cancelled release. So every cancelled release that was
      // scheduled is kept; one cancelled while still a draft never could run.
      const t = await boot(dialect);
      const deleter = await personHolding(t, [DELETE]);
      const scheduled = await releaseIn(t, "scheduled");
      await t.nextly.releases.cancel({ id: scheduled });
      const neverScheduled = await releaseIn(t, "cancelled");

      const refusal = await t.nextly.releases
        .delete({ id: scheduled, userId: deleter, overrideAccess: false })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(refusal).toMatchObject({
        code: "CONFLICT",
        publicMessage:
          "This release was scheduled, so it's kept as a record. Cancelled releases that were never scheduled can be deleted.",
        publicData: { reason: "was-scheduled" },
      });
      expect((await t.nextly.releases.findByID({ id: scheduled }))?.state).toBe(
        "cancelled"
      );
      expect(await membersOf(t, scheduled)).toHaveLength(1);

      // REST answers the same, with the reason for the admin to name.
      const res = await rest(
        await keyHolding(t, [DELETE]),
        "DELETE",
        scheduled
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: "CONFLICT", data: { reason: "was-scheduled" } },
      });

      // The control: a cancelled release that was never scheduled goes.
      await t.nextly.releases.delete({
        id: neverScheduled,
        userId: deleter,
        overrideAccess: false,
      });
      expect(
        await t.nextly.releases.findByID({ id: neverScheduled })
      ).toBeNull();
    });

    it.each(["scheduled", "blocked", "published"] as const)(
      "refuses to delete a %s release, and leaves it and its documents",
      async state => {
        const t = await boot(dialect);
        const deleter = await personHolding(t, [DELETE]);
        const id = await releaseIn(t, state);

        await expect(
          t.nextly.releases.delete({
            id,
            userId: deleter,
            overrideAccess: false,
          })
        ).rejects.toMatchObject({ code: "CONFLICT" });
        const after = await t.nextly.releases.findByID({ id });
        expect(after?.state).toBe(state);
        expect(await membersOf(t, id)).toHaveLength(1);
      }
    );

    it("answers NOT_FOUND for a release that is not there", async () => {
      const t = await boot(dialect);
      const deleter = await personHolding(t, [DELETE]);
      await expect(
        t.nextly.releases.delete({
          id: "00000000-0000-4000-8000-00000000dead",
          userId: deleter,
          overrideAccess: false,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets a key holding delete delete a draft over REST, and refuses a key without it", async () => {
      const t = await boot(dialect);
      const id = await releaseIn(t, "draft");

      const refused = await rest(
        await keyHolding(t, ALL_BUT(DELETE)),
        "DELETE",
        id
      );
      expect(refused.status).toBe(403);
      expect(await titleOf(t, id)).not.toBeNull();

      const allowed = await rest(await keyHolding(t, [DELETE]), "DELETE", id);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({
        message: "Release deleted.",
        item: { id, title: "A draft release", state: "draft" },
      });
      expect(await t.nextly.releases.findByID({ id })).toBeNull();

      // A stopped release is refused over REST as it is on the Direct API.
      const stopped = await releaseIn(t, "blocked");
      const conflict = await rest(
        await keyHolding(t, [DELETE]),
        "DELETE",
        stopped
      );
      expect(conflict.status).toBe(409);
    });

    it("records each rename and deletion in the activity log, as the person who made it", async () => {
      const t = await boot(dialect);
      const renamer = await personHolding(t, [UPDATE]);
      const deleter = await personHolding(t, [DELETE]);
      const id = await releaseIn(t, "draft");
      const before = (await releaseActivity(t)).length;

      // A refused rename records nothing.
      await expect(
        t.nextly.releases.update({
          id,
          title: "Nope",
          userId: deleter,
          overrideAccess: false,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await releaseActivity(t)).toHaveLength(before);

      await t.nextly.releases.update({
        id,
        title: "Renamed launch",
        userId: renamer,
        overrideAccess: false,
      });
      await t.nextly.releases.delete({
        id,
        userId: deleter,
        overrideAccess: false,
      });

      const rows = (await releaseActivity(t)).filter(row => row.entryId === id);
      const update = rows.find(row => row.action === "update");
      const removal = rows.find(row => row.action === "delete");
      expect(rows).toHaveLength(2);
      expect(update).toMatchObject({
        actorType: "user",
        userId: renamer,
        entryTitle: "Renamed launch",
      });
      expect(metadataOf(update!)).toMatchObject({ changedFields: ["title"] });
      expect(removal).toMatchObject({
        actorType: "user",
        userId: deleter,
        entryTitle: "Renamed launch",
      });
      expect(metadataOf(removal!)).toMatchObject({ state: "draft" });
    });
  }
);
