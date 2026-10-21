/**
 * A release's history in the record of content events, on every dialect.
 *
 * Each release operation records its event, with the release as the subject
 * and with who did it, in the transaction of the change: created, documents
 * added, removed or switched, scheduled, rescheduled, Publish now, started,
 * published, stopped, cancelled, renamed, described and deleted.
 *
 * A person is recorded as that person, an API key as the key and never its
 * owner, and the drain's run and stops as the system. A change whose event
 * cannot be written does not happen.
 *
 * And the delete rule the history decides: a cancelled release is deletable
 * only when its history shows no run, so one scheduled and cancelled before
 * its moment goes, and one that started publishing (stopped part-way, or
 * cancelled mid-run) stays. A release made before releases recorded their
 * history has no `release-created` event, and keeps the earlier rule: once
 * scheduled, it stays.
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
import { CONTENT_EVENTS_TABLE } from "../../../schemas/content-events";
import { ServiceContainer } from "../../../services/index";
import { applyDueReleases, type ReleaseMutations } from "../apply-due-releases";
import { createReleaseMutations } from "../release-mutations";
import {
  ReleasesRepository,
  type ReleasesDbApi,
  type ReleasesTxApi,
} from "../releases-repository";
import { ReleasesService } from "../services/releases-service";

import { seedLiveAuthor } from "./helpers/live-author";
import { READY_CHECKS } from "./helpers/ready-checks";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
  lockServerOf,
} from "./helpers/release-writes";

const DAY = 86_400_000;
const PAST = new Date("2020-01-01T00:00:00Z");
const ALL_RELEASE_PERMISSIONS = [
  "read-content-releases",
  "create-content-releases",
  "publish-content-releases",
  "update-content-releases",
  "delete-content-releases",
];

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
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
      // Read by nobody but a super-admin, whom every rule admits: a release
      // reader's history must not name its documents.
      defineCollection({
        slug: "memos",
        status: true,
        access: {
          read: () => false,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(current);
  return current;
}

/** An instant in whole seconds, which SQLite stores without loss. */
function inDays(days: number): Date {
  return new Date(Math.floor((Date.now() + days * DAY) / 1000) * 1000);
}

async function draft(t: TestNextly, collection = "posts"): Promise<string> {
  const created = (await t.nextly.create({
    collection: collection as never,
    data: { title: "Draft", status: "draft" } as never,
  })) as unknown as { item?: { id?: string }; id?: string };
  return String(created.item?.id ?? created.id);
}

interface EventRow {
  id: string;
  subjectKind: string;
  subjectId: string;
  kind: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  fromState: string | null;
  toState: string | null;
  endsSubject: boolean | number;
  endedBy: string | null;
  payload: unknown;
}

/** A release's events as stored, oldest first by their time-ordered id. */
async function eventsOf(t: TestNextly, releaseId: string): Promise<EventRow[]> {
  const rows = await t.adapter.select<EventRow>(CONTENT_EVENTS_TABLE, {
    where: {
      and: [
        { column: "subjectKind", op: "=", value: "release" },
        { column: "subjectId", op: "=", value: releaseId },
      ],
    },
  });
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function payloadOf(row: EventRow | undefined): Record<string, unknown> {
  const raw = row?.payload ?? null;
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (parsed ?? {}) as Record<string, unknown>;
}

function only(rows: EventRow[], kind: string): EventRow {
  const found = rows.filter(row => row.kind === kind);
  expect(found, kind).toHaveLength(1);
  return found[0]!;
}

async function userName(t: TestNextly, id: string): Promise<string | null> {
  const [row] = await t.adapter.select<{ name: string | null }>("users", {
    columns: ["name"],
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.name ?? null;
}

let roleSeq = 0;

/** A role holding exactly these permissions, by slug. */
async function roleHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const permissions = (await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  )) as Array<{ id: string; slug: string }>;
  roleSeq += 1;
  const role = await new ServiceContainer(t.adapter).roles.createRole({
    name: `History role ${roleSeq}`,
    slug: `history-role-${roleSeq}`,
    permissionIds: slugs.map(slug => {
      const found = permissions.find(p => p.slug === slug);
      // Asserted, so a refusal below cannot be for a permission never seeded.
      expect(found, `${slug} is seeded`).toBeDefined();
      return String(found!.id);
    }),
  });
  return role.id;
}

/** An active person, not the super-admin, whose only role holds these. */
async function personHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const user = await seedLiveAuthor(t);
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(user, await roleHolding(t, slugs));
  expect(assigned.success).toBe(true);
  return user;
}

/** A role-based API key holding these permissions (every release one by default). */
async function releaseKey(
  t: TestNextly,
  slugs: string[] = ALL_RELEASE_PERMISSIONS
): Promise<{ key: string; id: string; name: string }> {
  const roleId = await roleHolding(t, slugs);
  const name = `history key ${roleSeq}`;
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
    name,
    tokenType: "role-based",
    roleId,
    expiresIn: "unlimited",
  });
  const [row] = await t.adapter.select<{ id: string }>("api_keys", {
    columns: ["id"],
    where: { and: [{ column: "name", op: "=", value: name }] },
  });
  return { key, id: String(row!.id), name };
}

/** One REST call to `/api/<path>` as the key, answered as status and body. */
async function rest(
  key: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: unknown,
  query = ""
): Promise<{ status: number; json: Record<string, unknown> }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** A due release of these drafts, written as the system by the repository. */
async function dueRelease(
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
        scopeSlug: "posts",
        entryId,
        locale: null,
        action: "publish",
        createdBy: founder!,
      },
      ANY_EDITABLE_STATE
    );
  }
  expect(await scheduleAsItStands(repo, release.id, PAST, "UTC")).toBe(true);
  return release.id;
}

const never = (): Promise<never> => new Promise<never>(() => {});

async function until(condition: () => boolean): Promise<void> {
  for (let n = 0; n < 2000; n++) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error("the pass never reached the point it was to be ended at");
}

/**
 * A drain pass the host ends once `writes` documents have been written: the
 * next write never returns, as a host's time limit leaves it. Resolves once
 * every write before that one has committed.
 */
async function passEndedAfter(t: TestNextly, writes: number): Promise<void> {
  const real = createReleaseMutations({
    contentApi: t.nextly,
    lockServer: lockServerOf(t),
  });
  let started = 0;
  const cut =
    (write: ReleaseMutations["publish"]): ReleaseMutations["publish"] =>
    input =>
      started++ >= writes ? never() : write(input);
  void applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: {
      publish: cut(input => real.publish(input)),
      unpublish: cut(input => real.unpublish(input)),
    },
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
  await until(() => started > writes);
}

/**
 * A release service over the real database whose transactions refuse to
 * write a content event: the record's insert throws, as a failing database
 * would, after the change it belongs to has been written.
 */
function serviceWithoutEvents(t: TestNextly): ReleasesService {
  const base = t.adapter as unknown as ReleasesDbApi;
  const refusingTx = (tx: ReleasesTxApi): ReleasesTxApi =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "insert") {
          return async (table: string, ...rest: unknown[]) => {
            if (table === CONTENT_EVENTS_TABLE) {
              throw new Error("the event could not be written");
            }
            return (target.insert as (...a: unknown[]) => unknown)(
              table,
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
          target.transaction(tx => work(refusingTx(tx)));
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new ReleasesService({
    repository: new ReleasesRepository(db),
    targets: {
      readDocument: async () => null,
      declaresLifecycle: async () => false,
    },
    canManageReleases: async () => true,
    canActOnDocument: async () => true,
    runDrainNow: async () => undefined,
    readableMembers: async (members: readonly { id: string }[]) =>
      new Set(members.map(member => member.id)),
    checks: READY_CHECKS,
  });
}

/** A document's stored status, read from its row. */
async function storedStatus(
  t: TestNextly,
  collection: string,
  id: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ status?: string }>(
    `dc_${collection}`,
    { where: { and: [{ column: "id", op: "=", value: id }] } }
  );
  return row?.status;
}

/**
 * A release service over the real database whose release transactions run
 * `before` once, just before writing their first content event, so a case
 * can act while one is open.
 */
function serviceWithPause(
  t: TestNextly,
  before: () => Promise<void>
): ReleasesService {
  const base = t.adapter as unknown as ReleasesDbApi;
  let paused = false;
  const pausingTx = (tx: ReleasesTxApi): ReleasesTxApi =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "insert") {
          return async (table: string, ...rest: unknown[]) => {
            if (table === CONTENT_EVENTS_TABLE && !paused) {
              paused = true;
              await before();
            }
            return (target.insert as (...a: unknown[]) => unknown)(
              table,
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
          target.transaction(tx => work(pausingTx(tx)));
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new ReleasesService({
    repository: new ReleasesRepository(db),
    targets: {
      readDocument: async () => null,
      declaresLifecycle: async () => false,
    },
    canManageReleases: async () => true,
    canActOnDocument: async () => true,
    runDrainNow: async () => undefined,
    readableMembers: async (members: readonly { id: string }[]) =>
      new Set(members.map(member => member.id)),
    checks: READY_CHECKS,
  });
}

/** Wait until `condition` holds, or `ms` have passed; whether it held. */
async function within(
  ms: number,
  condition: () => Promise<boolean>
): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return condition();
}

describe.each(getConfiguredTestDialects())(
  "a release's history in the record of content events (%s)",
  dialect => {
    it("records each operation a person makes, as that person, in the order made", async () => {
      const t = await boot(dialect);
      const me = { userId: founder!, overrideAccess: false } as const;
      const [a, b] = [await draft(t), await draft(t)];
      const first = inDays(7);
      const second = inDays(8);

      const release = await t.nextly.releases.create({
        title: "Spring",
        ...me,
      });
      const id = release.id;
      const member = (entryId: string) => ({
        releaseId: id,
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId,
        locale: null,
        action: "publish" as const,
        ...me,
      });
      await t.nextly.releases.addMember(member(a));
      const added = await t.nextly.releases.addMember(member(b));
      await t.nextly.releases.changeMemberAction({
        releaseId: id,
        memberId: added.id,
        action: "unpublish",
        ...me,
      });
      await t.nextly.releases.removeMember({
        releaseId: id,
        memberId: added.id,
        ...me,
      });
      await t.nextly.releases.schedule({
        id,
        at: first,
        timezone: "UTC",
        ...me,
      });
      await t.nextly.releases.schedule({
        id,
        at: second,
        timezone: "Europe/Berlin",
        ...me,
      });
      await t.nextly.releases.update({ id, title: "Summer", ...me });
      await t.nextly.releases.update({ id, description: "Launch", ...me });
      await t.nextly.releases.cancel({ id, ...me });
      await t.nextly.releases.delete({ id, ...me });

      const events = await eventsOf(t, id);
      expect(events.map(event => event.kind)).toEqual([
        "release-created",
        "release-document-added",
        "release-document-added",
        "release-document-action-changed",
        "release-document-removed",
        "release-scheduled",
        "release-rescheduled",
        "release-renamed",
        "release-description-changed",
        "release-cancelled",
        "release-deleted",
      ]);
      // Every one by the person, named as they were when it was recorded.
      const name = await userName(t, founder!);
      expect(name).not.toBeNull();
      for (const event of events) {
        expect(event, event.kind).toMatchObject({
          actorKind: "person",
          actorId: founder,
          actorName: name,
        });
      }

      // What each says, as its payload carries it.
      expect(payloadOf(events[1])).toMatchObject({
        entryId: a,
        action: "publish",
      });
      expect(payloadOf(events[3])).toMatchObject({
        entryId: b,
        from: "publish",
        action: "unpublish",
      });
      expect(payloadOf(events[4])).toMatchObject({
        entryId: b,
        action: "unpublish",
      });
      expect(payloadOf(events[5])).toEqual({
        at: first.toISOString(),
        timezone: "UTC",
      });
      expect(payloadOf(events[6])).toEqual({
        from: first.toISOString(),
        at: second.toISOString(),
        timezone: "Europe/Berlin",
      });
      expect(payloadOf(events[7])).toEqual({ from: "Spring", to: "Summer" });

      // The deletion ends the release's history: every event of it names the
      // deletion, so retention later removes exactly these.
      const deleted = only(events, "release-deleted");
      expect(Boolean(deleted.endsSubject)).toBe(true);
      for (const event of events) expect(event.endedBy).toBe(deleted.id);
    });

    it("records Publish now as the person, and the run that follows as the system", async () => {
      const t = await boot(dialect);
      const me = { userId: founder!, overrideAccess: false } as const;
      const release = await t.nextly.releases.create({ title: "Now", ...me });
      for (const entryId of [await draft(t), await draft(t)]) {
        await t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId,
          locale: null,
          action: "publish",
          ...me,
        });
      }
      await t.nextly.releases.schedule({
        id: release.id,
        at: inDays(7),
        timezone: "UTC",
        ...me,
      });

      const ran = await t.nextly.releases.publishNow({ id: release.id, ...me });
      expect(ran.state).toBe("published");

      const events = await eventsOf(t, release.id);
      expect(events.map(event => event.kind).slice(-3)).toEqual([
        "release-publish-now",
        "release-started",
        "release-published",
      ]);
      expect(only(events, "release-publish-now")).toMatchObject({
        actorKind: "person",
        actorId: founder,
      });
      // One start for the run, though it wrote two documents: the second
      // write found the first's.
      const started = only(events, "release-started");
      expect(started).toMatchObject({ actorKind: "system", actorId: null });
      expect(payloadOf(started)).toEqual({ revision: expect.any(Number) });
      expect(only(events, "release-published")).toMatchObject({
        actorKind: "system",
        actorId: null,
        fromState: "scheduled",
        toState: "published",
      });
    });

    it("records a stop as the system, with the moment it stopped at", async () => {
      const t = await boot(dialect);
      const repo = new ReleasesRepository(t.adapter);
      const release = await t.nextly.releases.create({ title: "Stops" });
      const at = inDays(3);
      expect(await scheduleAsItStands(repo, release.id, at, "UTC")).toBe(true);

      expect(
        await repo.blockReleases([{ id: release.id, scheduledAt: at }])
      ).toEqual([release.id]);

      const stopped = only(await eventsOf(t, release.id), "release-stopped");
      expect(stopped).toMatchObject({
        actorKind: "system",
        fromState: "scheduled",
        toState: "blocked",
      });
      expect(payloadOf(stopped)).toEqual({ scheduledAt: at.toISOString() });
    });

    it("names an API key as the key, never as the person who owns it", async () => {
      const t = await boot(dialect);
      const key = await releaseKey(t);

      const created = await rest(key.key, "POST", ["releases"], {
        title: "Keyed",
      });
      expect(created.status).toBe(201);
      const id = String((created.json.item as { id: string }).id);
      expect(
        (await rest(key.key, "PATCH", ["releases", id], { title: "Rekeyed" }))
          .status
      ).toBe(200);
      expect((await rest(key.key, "DELETE", ["releases", id])).status).toBe(
        200
      );

      const events = await eventsOf(t, id);
      expect(events.map(event => event.kind)).toEqual([
        "release-created",
        "release-renamed",
        "release-deleted",
      ]);
      for (const event of events) {
        expect(event, event.kind).toMatchObject({
          actorKind: "apiKey",
          actorId: key.id,
          actorName: key.name,
        });
        // The key's owner, the founder, is never named for its change.
        expect(event.actorId).not.toBe(founder);
      }
    });

    it("makes no change whose event cannot be written", async () => {
      const t = await boot(dialect);
      const svc = serviceWithoutEvents(t);
      const actor = { userId: founder!, overrideAccess: true };

      // A create: no release is left without its event.
      await expect(svc.create({ title: "Never" }, actor)).rejects.toThrow(
        "the event could not be written"
      );
      const titled = await t.adapter.select<{ id: string }>("nextly_releases", {
        where: { and: [{ column: "title", op: "=", value: "Never" }] },
      });
      expect(titled).toEqual([]);

      // A rename and a cancel of a release that exists: each stays undone.
      const release = await t.nextly.releases.create({ title: "Kept" });
      await expect(
        svc.update(release.id, { title: "Changed" }, actor)
      ).rejects.toThrow("the event could not be written");
      await expect(svc.cancel(release.id, actor)).rejects.toThrow(
        "the event could not be written"
      );
      const row = await t.nextly.releases.findByID({ id: release.id });
      expect(row).toMatchObject({ title: "Kept", state: "draft" });
      expect((await eventsOf(t, release.id)).map(e => e.kind)).toEqual([
        "release-created",
      ]);
    });

    it("deletes a cancelled release whose history shows no run, and keeps one that started publishing", async () => {
      const t = await boot(dialect);
      const me = { userId: founder!, overrideAccess: false } as const;
      const deletable = async (id: string): Promise<boolean> => {
        const [row] = await new ReleasesRepository(t.adapter).findReleases({
          ids: [id],
        });
        const caps = await t.nextly.releases.capabilities({
          releases: [row!],
          ...me,
        });
        return caps.get(id)?.delete ?? false;
      };
      const refusalOf = (id: string) =>
        t.nextly.releases.delete({ id, ...me }).then(
          () => null,
          (error: unknown) => error
        );

      // Scheduled, then cancelled before its moment: it never ran, and goes.
      const calledOff = await t.nextly.releases.create({
        title: "Called off",
        ...me,
      });
      await t.nextly.releases.schedule({
        id: calledOff.id,
        at: inDays(7),
        timezone: "UTC",
        ...me,
      });
      await t.nextly.releases.cancel({ id: calledOff.id, ...me });
      expect(await deletable(calledOff.id)).toBe(true);
      await t.nextly.releases.delete({ id: calledOff.id, ...me });
      expect(await t.nextly.releases.findByID({ id: calledOff.id })).toBeNull();

      // Stopped part-way, then cancelled: one document went live first.
      const stoppedId = await dueRelease(t, [await draft(t), await draft(t)]);
      await passEndedAfter(t, 1);
      const [due] = await new ReleasesRepository(t.adapter).findReleases({
        ids: [stoppedId],
      });
      expect(
        await new ReleasesRepository(t.adapter).blockReleases([
          { id: stoppedId, scheduledAt: due!.scheduledAt! },
        ])
      ).toEqual([stoppedId]);
      await t.nextly.releases.cancel({ id: stoppedId, ...me });
      expect((await eventsOf(t, stoppedId)).map(event => event.kind)).toContain(
        "release-started"
      );
      expect(await deletable(stoppedId)).toBe(false);
      expect(await refusalOf(stoppedId)).toMatchObject({
        code: "CONFLICT",
        publicMessage:
          "This release began publishing before it was cancelled, so it's kept as the record of what went live.",
        publicData: { reason: "was-scheduled" },
      });
      expect((await t.nextly.releases.findByID({ id: stoppedId }))?.state).toBe(
        "cancelled"
      );

      // Cancelled part-way through a run, with no stop: it started, so it
      // stays as well.
      const midRunId = await dueRelease(t, [await draft(t), await draft(t)]);
      await passEndedAfter(t, 1);
      await t.nextly.releases.cancel({ id: midRunId, ...me });
      expect(await deletable(midRunId)).toBe(false);
      expect(await refusalOf(midRunId)).toMatchObject({
        code: "CONFLICT",
        publicData: { reason: "was-scheduled" },
      });

      // REST answers the same, with the reason for the admin to name.
      const key = await releaseKey(t);
      const res = await rest(key.key, "DELETE", ["releases", stoppedId]);
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({
        error: { code: "CONFLICT", data: { reason: "was-scheduled" } },
      });
    });

    it("keeps a scheduled-then-cancelled release whose history was never recorded", async () => {
      // A release made before releases recorded their history: its events
      // are not there, so nothing says whether it ran.
      const t = await boot(dialect);
      const me = { userId: founder!, overrideAccess: false } as const;
      const release = await t.nextly.releases.create({ title: "Older" });
      await t.nextly.releases.schedule({
        id: release.id,
        at: inDays(7),
        timezone: "UTC",
      });
      await t.nextly.releases.cancel({ id: release.id });
      await t.adapter.delete(CONTENT_EVENTS_TABLE, {
        and: [
          { column: "subjectKind", op: "=", value: "release" },
          { column: "subjectId", op: "=", value: release.id },
        ],
      });

      const refusal = await t.nextly.releases
        .delete({ id: release.id, ...me })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(refusal).toMatchObject({
        code: "CONFLICT",
        publicMessage:
          "This release was scheduled before its history was recorded, so whether it began publishing is unknown and it's kept as a record.",
        publicData: { reason: "was-scheduled" },
      });
      expect(
        (await t.nextly.releases.findByID({ id: release.id }))?.state
      ).toBe("cancelled");

      // The control: a cancelled release never scheduled goes, history or not.
      const draftOnly = await t.nextly.releases.create({ title: "Draft only" });
      await t.nextly.releases.cancel({ id: draftOnly.id });
      await t.adapter.delete(CONTENT_EVENTS_TABLE, {
        and: [{ column: "subjectId", op: "=", value: draftOnly.id }],
      });
      await t.nextly.releases.delete({ id: draftOnly.id, ...me });
      expect(await t.nextly.releases.findByID({ id: draftOnly.id })).toBeNull();
    });

    it("lists in a release's history only the documents the reader may read", async () => {
      const t = await boot(dialect);
      const [post, memo] = [await draft(t), await draft(t, "memos")];
      const release = await t.nextly.releases.create({ title: "Mixed" });
      for (const [scopeSlug, entryId] of [
        ["posts", post],
        ["memos", memo],
      ] as const) {
        await t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug,
          entryId,
          locale: null,
          action: "publish",
          userId: founder!,
        });
      }
      const subject = { kind: "release" as const, id: release.id };

      // A trusted read is the control: it names both documents, so the
      // reads below leave the memo out because it is hidden, not missing.
      const all = JSON.stringify(
        (await t.nextly.contentEvents.list({ subject })).items
      );
      expect(all).toContain(memo);
      expect(all).toContain(post);

      // A person who may read releases and posts, but not memos.
      const reader = await personHolding(t, [
        "read-content-releases",
        "read-posts",
      ]);
      const asReader = (
        await t.nextly.contentEvents.list({
          subject,
          user: { id: reader },
          overrideAccess: false,
        })
      ).items;
      expect(asReader.map(event => event.kind)).toEqual([
        "release-document-added",
        "release-created",
      ]);
      expect(JSON.stringify(asReader)).toContain(post);
      expect(JSON.stringify(asReader)).not.toContain(memo);
      expect(JSON.stringify(asReader)).not.toContain("memos");

      // REST, as a key with the same grants, answers the same.
      const key = await releaseKey(t, ["read-content-releases", "read-posts"]);
      const res = await rest(
        key.key,
        "GET",
        ["content-events"],
        undefined,
        `?subject=release&id=${release.id}`
      );
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.json);
      expect(body).toContain(post);
      expect(body).not.toContain(memo);
      expect(body).not.toContain("memos");
    });

    it("leaves a document as it was when its release is deleted between the run's read and its write", async () => {
      // The run has planned the release and is about to write its one
      // document. Before the write, the release is cancelled and, its history
      // showing no run yet, deleted. The write must then not happen.
      const t = await boot(dialect);
      const post = await draft(t);
      const id = await dueRelease(t, [post]);
      const real = createReleaseMutations({
        contentApi: t.nextly,
        lockServer: lockServerOf(t),
      });
      let deleted = false;
      const afterDelete =
        (write: ReleaseMutations["publish"]): ReleaseMutations["publish"] =>
        async input => {
          if (!deleted) {
            deleted = true;
            await t.nextly.releases.cancel({ id });
            await t.nextly.releases.delete({ id });
          }
          return write(input);
        };
      await applyDueReleases({
        repository: new ReleasesRepository(t.adapter),
        mutations: {
          publish: afterDelete(input => real.publish(input)),
          unpublish: afterDelete(input => real.unpublish(input)),
        },
        runAs: {
          findUser: async userId => ({ id: userId, isActive: true }),
          listRoleSlugs: async () => [],
        },
      });

      expect(deleted).toBe(true);
      expect(await t.nextly.releases.findByID({ id })).toBeNull();
      expect(await storedStatus(t, "posts", post)).toBe("draft");
    });

    it("leaves a document as it was when it is taken out of its release just before the run writes it", async () => {
      // The release stays scheduled and runs; only the document taken out
      // between the run's plan and its write must not take the action.
      const t = await boot(dialect);
      const [kept, taken] = [await draft(t), await draft(t)];
      const id = await dueRelease(t, [kept, taken]);
      const members = await new ReleasesRepository(t.adapter).listMembers(id);
      const takenMember = members.find(member => member.entryId === taken)!;
      const real = createReleaseMutations({
        contentApi: t.nextly,
        lockServer: lockServerOf(t),
      });
      let removed = false;
      const publish: ReleaseMutations["publish"] = async input => {
        if (input.ref.entryId === taken && !removed) {
          removed = true;
          await t.nextly.releases.removeMember({
            releaseId: id,
            memberId: takenMember.id,
          });
        }
        return real.publish(input);
      };
      await applyDueReleases({
        repository: new ReleasesRepository(t.adapter),
        mutations: { publish, unpublish: input => real.unpublish(input) },
        runAs: {
          findUser: async userId => ({ id: userId, isActive: true }),
          listRoleSlugs: async () => [],
        },
      });

      expect(removed).toBe(true);
      expect(await storedStatus(t, "posts", taken)).toBe("draft");
      // The control: the document still in the release was written.
      expect(await storedStatus(t, "posts", kept)).toBe("published");
    });

    it("leaves a document as it was when its release is cancelled between the run's plan and its write", async () => {
      // The release still exists and still holds the document, but it has
      // moved on: cancelled, its revision raised. The write must not happen.
      const t = await boot(dialect);
      const post = await draft(t);
      const id = await dueRelease(t, [post]);
      const real = createReleaseMutations({
        contentApi: t.nextly,
        lockServer: lockServerOf(t),
      });
      let cancelled = false;
      const afterCancel =
        (write: ReleaseMutations["publish"]): ReleaseMutations["publish"] =>
        async input => {
          if (!cancelled) {
            cancelled = true;
            await t.nextly.releases.cancel({ id });
          }
          return write(input);
        };
      await applyDueReleases({
        repository: new ReleasesRepository(t.adapter),
        mutations: {
          publish: afterCancel(input => real.publish(input)),
          unpublish: afterCancel(input => real.unpublish(input)),
        },
        runAs: {
          findUser: async userId => ({ id: userId, isActive: true }),
          listRoleSlugs: async () => [],
        },
      });

      expect(cancelled).toBe(true);
      expect((await t.nextly.releases.findByID({ id }))?.state).toBe(
        "cancelled"
      );
      expect(await storedStatus(t, "posts", post)).toBe("draft");
    });

    it("pages a release's history so a page of events the reader may not see never stops the walk", async () => {
      // Newest first, the two newest events are about a memo the reader may
      // not read: a raw page of two holds nothing for them, and the walk must
      // still reach the post and the release's creation.
      const t = await boot(dialect);
      const [post, memo] = [await draft(t), await draft(t, "memos")];
      const release = await t.nextly.releases.create({ title: "Paged" });
      const add = (scopeSlug: string, entryId: string) =>
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug,
          entryId,
          locale: null,
          action: "publish",
          userId: founder!,
        });
      await add("posts", post);
      const memoMember = await add("memos", memo);
      await t.nextly.releases.changeMemberAction({
        releaseId: release.id,
        memberId: memoMember.id,
        action: "unpublish",
      });
      const reader = await personHolding(t, [
        "read-content-releases",
        "read-posts",
      ]);
      const page = await t.nextly.contentEvents.list({
        subject: { kind: "release", id: release.id },
        limit: 2,
        user: { id: reader },
        overrideAccess: false,
      });
      expect(page.items.map(event => event.kind)).toEqual([
        "release-document-added",
        "release-created",
      ]);
      expect(JSON.stringify(page.items)).toContain(post);
      expect(page.meta.hasNext).toBe(false);
    });

    it("stops scanning hidden history after a bounded number of reads, and says where it stopped", async () => {
      // Newest first, fifteen events about a memo the reader may not read
      // stand before the post's. A page of one scans its first read and ten
      // more, finds nothing to show, and answers where the scan stopped; the
      // walk goes on from there and reaches the post.
      const t = await boot(dialect);
      const [post, memo] = [await draft(t), await draft(t, "memos")];
      const release = await t.nextly.releases.create({
        title: "Mostly hidden",
      });
      const add = (scopeSlug: string, entryId: string) =>
        t.nextly.releases.addMember({
          releaseId: release.id,
          scopeKind: "collection",
          scopeSlug,
          entryId,
          locale: null,
          action: "publish",
          userId: founder!,
        });
      await add("posts", post);
      const memoMember = await add("memos", memo);
      for (let i = 0; i < 14; i += 1) {
        await t.nextly.releases.changeMemberAction({
          releaseId: release.id,
          memberId: memoMember.id,
          action: i % 2 === 0 ? "unpublish" : "publish",
        });
      }
      const reader = await personHolding(t, [
        "read-content-releases",
        "read-posts",
      ]);
      const read = (before?: string) =>
        t.nextly.contentEvents.list({
          subject: { kind: "release", id: release.id },
          limit: 1,
          ...(before === undefined ? {} : { before }),
          user: { id: reader },
          overrideAccess: false,
        });

      const first = await read();
      expect(first.items).toEqual([]);
      expect(first.meta.hasNext).toBe(true);
      const cursor = first.meta.nextBefore;
      expect(typeof cursor).toBe("string");

      const second = await read(cursor);
      expect(second.items.map(event => event.kind)).toEqual([
        "release-document-added",
      ]);
      expect(JSON.stringify(second.items)).toContain(post);
    });

    it("refuses to record Publish now on a release that moved since it was judged due", async () => {
      const t = await boot(dialect);
      const id = await dueRelease(t, [await draft(t)]);
      const repo = new ReleasesRepository(t.adapter);
      const [due] = await repo.findReleases({ ids: [id] });
      // Rescheduled after it was judged: its revision moved on.
      expect(await scheduleAsItStands(repo, id, inDays(7), "UTC")).toBe(true);
      expect(
        await repo.recordPublishNow(
          id,
          { kind: "person", userId: founder! },
          due!.revision
        )
      ).toBe(false);
      expect((await eventsOf(t, id)).map(event => event.kind)).not.toContain(
        "release-publish-now"
      );
    });

    it("records Publish now on a release already due, and refuses a key that does not say which it is", async () => {
      const t = await boot(dialect);
      const me = { userId: founder!, overrideAccess: false } as const;
      const id = await dueRelease(t, [await draft(t)]);

      // A key's scope without its id: refused before anything runs.
      await expect(
        t.nextly.releases.publishNow({
          id,
          userId: founder!,
          overrideAccess: false,
          authenticatedScope: {
            actorType: "apiKey",
            permissions: ["publish-content-releases"],
          },
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await t.nextly.releases.findByID({ id }))?.state).toBe(
        "scheduled"
      );

      // Due already, so it is not moved, but the history names who asked.
      await t.nextly.releases.publishNow({ id, ...me });
      const events = await eventsOf(t, id);
      expect(only(events, "release-publish-now")).toMatchObject({
        actorKind: "person",
        actorId: founder,
      });
      // Not moved: the one schedule is the fixture's, and none follows it.
      expect(
        events.filter(event =>
          ["release-scheduled", "release-rescheduled"].includes(event.kind)
        )
      ).toHaveLength(1);
    });

    it.skipIf(dialect === "sqlite")(
      "keeps no name for a person whose account is deleted while their release change is being written",
      async () => {
        // SQLite has one writer, so a deletion cannot run inside the change's
        // transaction at all. Elsewhere the deletion is asked for while the
        // change's transaction is open and has read the person's name, and
        // given time to finish before the change writes its event. Read under
        // the account's lock, the deletion waits for the change and then
        // erases the name with the rest of the person's events.
        const t = await boot(dialect);
        const person = await seedLiveAuthor(t);
        // The change's transaction stops just before its event, says so, and
        // waits; the deletion runs from here, as another request would, on a
        // flow of its own rather than the change's.
        let reached!: () => void;
        const atEvent = new Promise<void>(resolve => (reached = resolve));
        let proceed!: () => void;
        const goOn = new Promise<void>(resolve => (proceed = resolve));
        const svc = serviceWithPause(t, async () => {
          reached();
          await goOn;
        });
        const creating = svc.create(
          { title: "Named" },
          { userId: person, overrideAccess: true }
        );
        await atEvent;
        const deletion = t.nextly.users.delete({ id: person });
        // Time for an unhindered deletion to finish, sweep included; one held
        // by the change's lock is still waiting when this ends.
        await within(1500, async () => {
          const rows = await t.adapter.select<{ id: string }>("users", {
            columns: ["id"],
            where: { and: [{ column: "id", op: "=", value: person }] },
          });
          return rows.length === 0;
        });
        proceed();
        const release = await creating;
        await deletion;

        const created = only(await eventsOf(t, release.id), "release-created");
        expect(created.actorId).toBe(person);
        expect(created.actorName).toBeNull();
      }
    );
  }
);
