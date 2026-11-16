/**
 * A release's owner told when it misses its time, once for each instant it
 * missed, with the notice's email handed on in the notice's own transaction.
 *
 * Two paths record the notice: the drain's pass, for each release overdue as
 * it starts, and the transition to published, for one that ran that late.
 * Both key it on the missed instant, so the owner is told once whichever sees
 * the miss first, and a pass seen twice tells nobody again. Each new notice
 * adds a job in the same transaction, and the job queues the email through
 * core's queued send under the notice's key: a process that stops before the
 * job runs leaves it for the next jobs run, and a repeat of the job after the
 * email was sent sends nothing more.
 *
 * Email goes to a capturing provider, so what the owner would receive is read
 * as the provider was handed it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { container } from "../../../di/container";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NOTICES_TABLE } from "../../../schemas/notices/table-name";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ServiceContainer } from "../../../services/index";
import { defineEmailProvider } from "../../email/provider-definition";
import type { EmailService } from "../../email/services/email-service";
import type { EmailProviderAdapter } from "../../email/types";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { applyDueReleases } from "../apply-due-releases";
import {
  emailReleaseNotice,
  RELEASE_NOTICE_EMAIL_JOB,
} from "../release-notice-email";
import { createReleaseMutations } from "../release-mutations";
import { ReleasesRepository } from "../releases-repository";
import { RELEASES_RESOURCE } from "../releases-resource";

import { deactivate, seedLiveAuthor } from "./helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  lockServerOf,
  scheduleAsItStands,
} from "./helpers/release-writes";

const SLUG = "posts";
const PAST = new Date("2020-01-01T09:00:00.000Z");

const sent: Array<Parameters<EmailProviderAdapter["send"]>[0]> = [];
/**
 * How many of the next sends the provider fails, as one that is briefly
 * unreachable does: a failure it does not classify, which counts as one a
 * retry can help.
 */
const provider = { failing: 0, attempts: 0 };
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  sent.length = 0;
  provider.failing = 0;
  provider.attempts = 0;
});

const capturing = defineEmailProvider<Record<string, never>>({
  type: "capturing-release-notices",
  label: "Capturing",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: () => ({
    send: async options => {
      provider.attempts += 1;
      if (provider.failing > 0) {
        provider.failing -= 1;
        return { success: false };
      }
      sent.push(options);
      return { success: true, messageId: "captured" };
    },
  }),
});

/** An instance with one collection, and email set up unless told not to. */
async function boot(
  dialect: TestDialect,
  withEmail = true
): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "mailer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [capturing] },
      } as never),
    ],
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
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  if (withEmail) {
    await t.nextly.emailProviders.create({
      data: {
        name: "Capturing",
        type: "capturing-release-notices",
        fromEmail: "provider@example.com",
        configuration: {},
        isDefault: true,
      },
    });
  }
  return t;
}

/**
 * A release of one draft, owned by `owner` and its draft added by `author`
 * (the owner unless said), scheduled for `at`.
 */
async function scheduledRelease(
  t: TestNextly,
  owner: string,
  at: Date,
  author = owner
): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "First", status: "draft" }
  );
  const entryId = (created.data as { id?: string } | undefined)?.id;
  if (typeof entryId !== "string") throw new Error("no id from create");
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Launch",
    createdBy: owner,
  });
  await repo.addMember(
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
  await scheduleAsItStands(repo, release.id, at, "Europe/Berlin");
  return release.id;
}

/**
 * An owner who may read releases, as a person given release notices is: the
 * notice, and so its email, is shown only to them.
 */
async function releaseReader(t: TestNextly): Promise<string> {
  const owner = await seedLiveAuthor(t);
  await grantTo(t, owner, "read", [RELEASES_RESOURCE]);
  return owner;
}

/**
 * Take every role `userId` holds, as an administrator does, through the
 * service that also flushes the permission caches.
 */
async function revokeRoles(t: TestNextly, userId: string): Promise<void> {
  const roles = new ServiceContainer(t.adapter).userRoles;
  const held = await t.adapter.select<{ roleId: string }>("user_roles", {
    columns: ["roleId"],
    where: { and: [{ column: "userId", op: "=", value: userId }] },
  });
  for (const { roleId } of held) {
    await roles.unassignRoleFromUser(userId, roleId);
  }
}

/** A stored JSON value: text on SQLite, a value elsewhere. */
function parsed(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

/** The overdue notices this release's owner has been given. */
async function overdueNotices(t: TestNextly, releaseId: string) {
  const rows = await t.adapter.select<{
    id: string;
    userId: string;
    occurrence: string;
    data: unknown;
  }>(NOTICES_TABLE, {
    columns: ["id", "userId", "occurrence", "data"],
    where: {
      and: [
        { column: "kind", op: "=", value: "releases.overdue" },
        { column: "subjectId", op: "=", value: releaseId },
      ],
    },
  });
  return rows.map(row => ({ ...row, data: parsed(row.data) }));
}

/** Every notice email job, with its input as stored. */
async function emailJobs(t: TestNextly) {
  const rows = await t.adapter.select<{ input: unknown; state: string }>(
    "nextly_jobs",
    {
      columns: ["input", "state"],
      where: {
        and: [{ column: "slug", op: "=", value: RELEASE_NOTICE_EMAIL_JOB }],
      },
    }
  );
  return rows.map(row => ({ ...row, input: parsed(row.input) }));
}

async function emailOf(t: TestNextly, userId: string): Promise<string> {
  const [row] = await t.adapter.select<{ email: string }>("users", {
    columns: ["email"],
    where: { and: [{ column: "id", op: "=", value: userId }] },
  });
  if (row === undefined) throw new Error(`no user ${userId}`);
  return row.email;
}

/** What was sent to this address about a release. */
function sentTo(address: string) {
  return sent.filter(
    message => message.to === address && /Launch/.test(message.subject)
  );
}

/** One jobs trigger, as `/api/jobs/run` makes it. */
function trigger(t: TestNextly, now?: Date) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    retentionMs: null,
    ...(now === undefined ? {} : { now: () => now }),
  });
}

/** A time past any backoff a job's retries could have scheduled from now. */
function pastEveryBackoff(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60_000);
}

/** One drain pass with no overdue pass before it: a runner catching up. */
function catchUp(t: TestNextly) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({
      contentApi: t.nextly,
      lockServer: lockServerOf(t),
    }),
    runAs: {
      findUser: async id => ({ id, isActive: true }),
      listRoleSlugs: async () => [],
    },
  });
}

async function stateOf(t: TestNextly, id: string): Promise<string | undefined> {
  return (await t.nextly.releases.findByID({ id }))?.state;
}

describe.each(getConfiguredTestDialects())(
  "an overdue release tells its owner (%s)",
  dialect => {
    it("once, however often the overdue pass runs, with its email handed on once", async () => {
      const t = await boot(dialect, false);
      const owner = await seedLiveAuthor(t);
      const id = await scheduledRelease(t, owner, PAST);
      const repo = new ReleasesRepository(t.adapter);

      expect(await repo.recordOverdueReleases(new Date())).toBe(1);
      expect(await repo.recordOverdueReleases(new Date())).toBe(0);

      const notices = await overdueNotices(t, id);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        userId: owner,
        occurrence: PAST.toISOString(),
        data: {
          title: "Launch",
          scheduledAt: PAST.toISOString(),
          timezone: "Europe/Berlin",
          ranAt: null,
        },
      });
      expect((await emailJobs(t)).map(job => job.input)).toEqual([
        { noticeId: notices[0].id },
      ]);
    });

    it("tells nobody of a release still within its grace after its time", async () => {
      const t = await boot(dialect, false);
      const owner = await seedLiveAuthor(t);
      const id = await scheduledRelease(
        t,
        owner,
        new Date(Date.now() - 60_000)
      );

      expect(
        await new ReleasesRepository(t.adapter).recordOverdueReleases(
          new Date()
        )
      ).toBe(0);
      expect(await overdueNotices(t, id)).toEqual([]);
      expect(await emailJobs(t)).toEqual([]);
    });

    it("says a release ran late when a runner catches up, once, and the overdue pass adds nothing", async () => {
      const t = await boot(dialect, false);
      const owner = await seedLiveAuthor(t);
      const id = await scheduledRelease(t, owner, PAST);

      expect(await catchUp(t)).toMatchObject({ published: 1 });
      expect(await stateOf(t, id)).toBe("published");

      const notices = await overdueNotices(t, id);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        occurrence: PAST.toISOString(),
        data: { ranAt: expect.any(String) },
      });
      expect(
        await new ReleasesRepository(t.adapter).recordOverdueReleases(
          new Date()
        )
      ).toBe(0);
      expect(await overdueNotices(t, id)).toHaveLength(1);
      expect(await emailJobs(t)).toHaveLength(1);
    });

    it("is told by the drain's own pass before the release runs, and emailed once, in its zone", async () => {
      const t = await boot(dialect);
      // The site's first account is its super-admin, who may read and publish
      // everything; it adds the document, and the owner is an ordinary
      // person given release reads, whose standing is what decides.
      const admin = await seedLiveAuthor(t);
      const owner = await releaseReader(t);
      const id = await scheduledRelease(t, owner, PAST, admin);
      const address = await emailOf(t, owner);

      await trigger(t);

      expect(await stateOf(t, id)).toBe("published");
      // Told by the pass that then ran it, so it says the release had missed
      // its time; the run, keyed on the same instant, adds no second notice.
      const notices = await overdueNotices(t, id);
      expect(notices).toHaveLength(1);
      expect(notices[0].data).toMatchObject({ ranAt: null });
      // Its email job was added during that pass, so the next trigger runs it.
      expect(await emailJobs(t)).toEqual([
        { input: { noticeId: notices[0].id }, state: "pending" },
      ]);
      expect(sentTo(address)).toEqual([]);

      await trigger(t);

      expect(await emailJobs(t)).toEqual([
        { input: { noticeId: notices[0].id }, state: "done" },
      ]);
      const mail = sentTo(address);
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toBe("“Launch” missed its time");
      // 09:00 UTC, written in the zone it was scheduled in, and named.
      expect(mail[0].text).toContain("10:00 (Europe/Berlin)");
    });

    it("is emailed by the next run when the process stopped after the notice, and a repeat sends nothing more", async () => {
      const t = await boot(dialect);
      // The site's first account is its super-admin, who may read and publish
      // everything; it adds the document, and the owner is an ordinary
      // person given release reads, whose standing is what decides.
      const admin = await seedLiveAuthor(t);
      const owner = await releaseReader(t);
      const id = await scheduledRelease(t, owner, PAST, admin);
      const address = await emailOf(t, owner);

      // The notice and its job are committed, and the process stops before
      // any jobs run: nothing has been sent.
      await new ReleasesRepository(t.adapter).recordOverdueReleases(new Date());
      expect(sentTo(address)).toEqual([]);
      const [notice] = await overdueNotices(t, id);

      await trigger(t);

      expect(sentTo(address)).toHaveLength(1);
      expect(await emailJobs(t)).toEqual([
        { input: { noticeId: notice.id }, state: "done" },
      ]);

      // The job again, as a retry after its email was queued would run it:
      // queued under the same key, and answered without a second send.
      await emailReleaseNotice(
        {
          db: t.adapter,
          email: container.get<EmailService>("emailService"),
        },
        notice.id
      );
      expect(sentTo(address)).toHaveLength(1);
    });

    it("is not emailed to an owner whose release access was revoked after the notice", async () => {
      const t = await boot(dialect);
      // The site's first account is its super-admin, who may read and publish
      // everything; it adds the document, and the owner is an ordinary
      // person given release reads, whose standing is what decides.
      const admin = await seedLiveAuthor(t);
      const owner = await releaseReader(t);
      const id = await scheduledRelease(t, owner, PAST, admin);
      const address = await emailOf(t, owner);
      await new ReleasesRepository(t.adapter).recordOverdueReleases(new Date());

      // Revoked between the notice and the run of its email job: their list
      // now hides the notice, so its email is not sent either.
      await revokeRoles(t, owner);
      await trigger(t);

      expect(await overdueNotices(t, id)).toHaveLength(1);
      expect(await emailJobs(t)).toEqual([
        { input: expect.any(Object), state: "done" },
      ]);
      expect(sentTo(address)).toEqual([]);
    });

    it("is not emailed to an owner deactivated after the notice", async () => {
      const t = await boot(dialect);
      // The site's first account is its super-admin, who may read and publish
      // everything; it adds the document, and the owner is an ordinary
      // person given release reads, whose standing is what decides.
      const admin = await seedLiveAuthor(t);
      const owner = await releaseReader(t);
      const id = await scheduledRelease(t, owner, PAST, admin);
      const address = await emailOf(t, owner);
      await new ReleasesRepository(t.adapter).recordOverdueReleases(new Date());

      // Deactivated between the notice and the run of its email job, with
      // their roles, and so their release access, left as they were. The
      // drain then stops the release, whose document they added, and the
      // stop's email job runs on the trigger after.
      await deactivate(t, owner);
      await trigger(t);
      await trigger(t);

      expect(await overdueNotices(t, id)).toHaveLength(1);
      const jobs = await emailJobs(t);
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.map(job => job.state)).toEqual(jobs.map(() => "done"));
      expect(sentTo(address)).toEqual([]);
    });

    it("is emailed by the retry after a failed attempt, once", async () => {
      const t = await boot(dialect);
      // The site's first account is its super-admin, who may read and publish
      // everything; it adds the document, and the owner is an ordinary
      // person given release reads, whose standing is what decides.
      const admin = await seedLiveAuthor(t);
      const owner = await releaseReader(t);
      await scheduledRelease(t, owner, PAST, admin);
      const address = await emailOf(t, owner);
      await new ReleasesRepository(t.adapter).recordOverdueReleases(new Date());

      provider.failing = 1;
      await trigger(t);
      expect(sentTo(address)).toEqual([]);
      await trigger(t, pastEveryBackoff());
      await trigger(t, pastEveryBackoff());

      expect(sentTo(address)).toHaveLength(1);
    });

    for (const [losing, lose] of [
      [
        "is deactivated",
        (t: TestNextly, owner: string) => deactivate(t, owner),
      ],
      [
        "loses release access",
        (t: TestNextly, owner: string) => revokeRoles(t, owner),
      ],
    ] as const) {
      it(`is not emailed on a retry when the owner ${losing} after a failed attempt`, async () => {
        const t = await boot(dialect);
        // The site's first account is its super-admin, who may read and publish
        // everything; it adds the document, and the owner is an ordinary
        // person given release reads, whose standing is what decides.
        const admin = await seedLiveAuthor(t);
        const owner = await releaseReader(t);
        const id = await scheduledRelease(t, owner, PAST, admin);
        const address = await emailOf(t, owner);
        await new ReleasesRepository(t.adapter).recordOverdueReleases(
          new Date()
        );

        // The first attempt fails as a briefly unreachable provider does.
        provider.failing = 1;
        await trigger(t);
        expect(provider.attempts).toBe(1);
        expect(sentTo(address)).toEqual([]);

        // Between that attempt and the retry, the owner may no longer see
        // the notice, so the retry, whenever it runs, sends nothing.
        await lose(t, owner);
        await trigger(t, pastEveryBackoff());
        await trigger(t, pastEveryBackoff());

        expect(await overdueNotices(t, id)).toHaveLength(1);
        expect(sentTo(address)).toEqual([]);
      });
    }

    it("is told without email where the site sends none, and the job completes", async () => {
      const t = await boot(dialect, false);
      const owner = await seedLiveAuthor(t);
      const id = await scheduledRelease(t, owner, PAST);

      // The drain's pass, then the one that runs the email job it added.
      await trigger(t);
      await trigger(t);

      expect(await overdueNotices(t, id)).toHaveLength(1);
      expect(await emailJobs(t)).toEqual([
        { input: expect.any(Object), state: "done" },
      ]);
      expect(sent).toEqual([]);
    });
  }
);
