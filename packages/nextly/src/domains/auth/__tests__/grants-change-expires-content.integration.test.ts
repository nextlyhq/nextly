/**
 * A change to what a role grants expires every cached content read.
 *
 * A cached public read holds what the Public role let a visitor read when it
 * ran, and taking a read away from Public writes no content, so no content
 * write expires it. Against a real database, through the role screen's writer
 * and through a sweep of permission-row writes such as boot's seeding makes,
 * which names no role: the change flushes the tags every
 * collection's and Single's writes flush, leaves out one that opts out of
 * revalidation, and an unchanged set flushes nothing.
 *
 * The expiry is owed until it lands: queued as a job before it is tried and
 * withdrawn once it lands, so when the registries cannot be read, the job is
 * left for a jobs run to perform after the process that owed it is gone, and
 * a process still running tries again until it lands. Landing means every tag
 * expired or was recorded for every instance, not kept by this process alone,
 * and a row whose attempts run out leaves a successor queued.
 *
 * The job is queued before the grants write starts, due only after a margin
 * of minutes, so it is owed before the change commits and no jobs run takes it
 * before then: a process stopped right after the commit still leaves it.
 *
 * SQLite needs no URL, and the flush is post-commit bookkeeping that no
 * dialect changes.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { container } from "../../../di/container";
import type { JobRegistry } from "../../../domains/jobs/job-registry";
import type { JobRow } from "../../../domains/jobs/jobs-repository";
import { runJobsPass } from "../../../domains/jobs/jobs-runner";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  FlushOutcome,
  RevalidationIntent,
} from "../../../revalidation/types";
import {
  inPermissionSweep,
  writingPermissions,
} from "../../../services/lib/permissions";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import { PUBLIC_ROLE_SLUG } from "../services/public-role";

/** The slug the queued expiry carries, as stored: a row an earlier process queued must match. */
const GRANTS_EXPIRY_JOB = "nextly:grants-content-expiry";

/** The process's own tries at an owed expiry, as a process holds them. */
const retryKey = "__nextly_grants_expiry_retry";
type RetryHolder = Record<
  typeof retryKey,
  { timer?: ReturnType<typeof setTimeout> } | undefined
>;

/** Past the margin a row queued ahead of a write waits before a jobs run may take it. */
function pastTheMargin(): Date {
  return new Date(Date.now() + 6 * 60_000);
}

/**
 * The table the step right after a grants write commits asks after first (the
 * retirement of stored permission answers), so a test can stop that step
 * there, as a process stopped right after the commit would.
 */
const FIRST_ASKED_AFTER_COMMIT = "user_permission_cache";

/** Forgets what this process owes, as a restart does: only what the database holds is left. */
function forgetThisProcess(): void {
  const holder = globalThis as unknown as RetryHolder;
  const timer = holder[retryKey]?.timer;
  if (timer !== undefined) clearTimeout(timer);
  holder[retryKey] = undefined;
}

/** Every intent flushed to it, so a test sees exactly which tags expired. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  /** Whether it answers as a revalidator whose hand-off kept the tags in this process only. */
  keepInProcess = false;
  flush(intents: RevalidationIntent[]): FlushOutcome | void {
    this.flushed.push(...intents);
    if (!this.keepInProcess) return;
    const tags = intents.flatMap(intent => intent.tags);
    return { deferredTags: tags, keptInProcess: tags };
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("a change to a role's grants and the cached content reads (sqlite)", () => {
  let t: TestNextly | undefined;
  let spy: RecordingRevalidator;

  beforeEach(() => {
    spy = new RecordingRevalidator();
    // Registered first, so the harness keeps it rather than the no-op default.
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    forgetThisProcess();
    await t?.destroy();
    t = undefined;
  });

  /** The grants expiry jobs in the queue, whatever their state. */
  async function grantsExpiryJobs(nextly: TestNextly): Promise<JobRow[]> {
    return nextly.adapter.select<JobRow>("nextly_jobs", {
      where: { and: [{ column: "slug", op: "=", value: GRANTS_EXPIRY_JOB }] },
    });
  }

  /** Makes every read of the collection registry's settings fail, until restored. */
  function failRegistryReads() {
    return vi
      .spyOn(
        container.get<CollectionRegistryService>("collectionRegistryService"),
        "getAllRevalidateConfigs"
      )
      .mockRejectedValue(new Error("database unavailable"));
  }

  /** Takes the read of posts away from Public. */
  async function removePublicRead(nextly: TestNextly): Promise<void> {
    const { id, held } = await publicRole(nextly);
    await nextly.nextly.roles.setPermissions({
      roleId: id,
      permissionIds: held
        .filter(permission => permission.slug !== "read-posts")
        .map(permission => permission.id),
    });
  }

  /**
   * Boots with posts anyone may read, a Single anyone may read, and a
   * collection that opts out of revalidation; boot grants Public both reads.
   */
  async function boot(): Promise<TestNextly> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    t = await createTestNextly({
      adapter,
      seedPublic: true,
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          access: { read: () => true },
          fields: [text({ name: "title" }), text({ name: "slug" })],
        }),
        defineCollection({
          slug: "unrevalidated",
          access: { read: () => true },
          revalidate: { disable: true },
          fields: [text({ name: "title" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "header",
          access: { read: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    return t;
  }

  /** The Public role's id and the ids of the permissions it holds. */
  async function publicRole(
    nextly: TestNextly
  ): Promise<{ id: string; held: Array<{ id: string; slug: string }> }> {
    const role = (await nextly.nextly.roles.find({ limit: 100 })).items.find(
      found => found.slug === PUBLIC_ROLE_SLUG
    );
    if (!role) throw new Error("boot made no Public role");
    const id = String(role.id);
    const held = (await nextly.nextly.roles.getPermissions({ id })).map(
      permission => ({ id: String(permission.id), slug: permission.slug })
    );
    return { id, held };
  }

  it("expires every collection's and Single's reads when Public loses a read", async () => {
    const nextly = await boot();
    const { id, held } = await publicRole(nextly);
    expect(held.map(permission => permission.slug)).toContain("read-posts");
    spy.flushed.length = 0;

    await nextly.nextly.roles.setPermissions({
      roleId: id,
      permissionIds: held
        .filter(permission => permission.slug !== "read-posts")
        .map(permission => permission.id),
    });

    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:single:header"])
    );
    expect(spy.tags.some(tag => tag.includes("unrevalidated"))).toBe(false);
  });

  it("expires them once after a sweep of permission-row writes, as boot's seeding makes", async () => {
    const nextly = await boot();
    const { held } = await publicRole(nextly);
    const readPosts = held.find(permission => permission.slug === "read-posts");
    if (!readPosts) throw new Error("boot granted Public no read-posts");
    const { permissions } = getDialectTables();
    const db = nextly.adapter.getDrizzle() as unknown as {
      update(table: unknown): {
        set(values: Record<string, unknown>): {
          where(condition: unknown): Promise<unknown>;
        };
      };
    };
    spy.flushed.length = 0;

    // Two writes to a row Public holds, as the seeder writes them: each through
    // the permission rows' own gate, the sweep around them both.
    await inPermissionSweep(async () => {
      for (const name of ["Read posts (renamed)", "Read posts"]) {
        await writingPermissions(permissions, table =>
          db.update(table).set({ name }).where(eq(permissions.id, readPosts.id))
        );
      }
    });

    expect(spy.flushed).toHaveLength(1);
    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:single:header"])
    );
    // One row queued ahead of the sweep's writes, withdrawn once it landed.
    expect(await grantsExpiryJobs(nextly)).toEqual([]);
  });

  it("expires nothing when the role is set to what it already holds", async () => {
    const nextly = await boot();
    const { id, held } = await publicRole(nextly);
    spy.flushed.length = 0;

    await nextly.nextly.roles.setPermissions({
      roleId: id,
      permissionIds: held.map(permission => permission.id),
    });

    expect(spy.flushed).toEqual([]);
    // The row queued ahead of the write is withdrawn: nothing changed.
    expect(await grantsExpiryJobs(nextly)).toEqual([]);
  });

  it("leaves no job queued once the expiry lands", async () => {
    const nextly = await boot();
    spy.flushed.length = 0;

    await removePublicRead(nextly);

    expect(spy.tags).toContain("nextly:posts");
    expect(await grantsExpiryJobs(nextly)).toEqual([]);
  });

  it("leaves the expiry queued when it fails, and a jobs run after a restart expires it", async () => {
    const nextly = await boot();
    const reads = failRegistryReads();
    spy.flushed.length = 0;

    await removePublicRead(nextly);

    expect(spy.flushed).toEqual([]);
    const owed = await grantsExpiryJobs(nextly);
    expect(owed.map(job => job.state)).toEqual(["pending"]);

    // The process that owed it is gone; the database is reachable again.
    forgetThisProcess();
    reads.mockRestore();
    await runJobsPass(
      nextly.adapter,
      container.get<JobRegistry>("jobRegistry"),
      { now: pastTheMargin }
    );

    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:single:header"])
    );
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "done",
    ]);
  });

  it("tries again in a process still running until the expiry lands, and withdraws the job", async () => {
    const nextly = await boot();
    const reads = failRegistryReads();
    spy.flushed.length = 0;

    await removePublicRead(nextly);
    expect(spy.flushed).toEqual([]);

    reads.mockRestore();

    // The first retry comes a second after the failure.
    await vi.waitFor(
      () => {
        expect(spy.tags).toEqual(
          expect.arrayContaining(["nextly:posts", "nextly:single:header"])
        );
      },
      { timeout: 5_000, interval: 50 }
    );
    await vi.waitFor(
      async () => {
        expect(await grantsExpiryJobs(nextly)).toEqual([]);
      },
      { timeout: 5_000, interval: 50 }
    );
  });

  it("keeps the job while the expiry's tags are kept in this process only, until they are recorded", async () => {
    const nextly = await boot();
    spy.keepInProcess = true;
    spy.flushed.length = 0;

    await removePublicRead(nextly);

    // Flushed, but not for good: the job stays queued for a jobs run.
    expect(spy.tags).toContain("nextly:posts");
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "pending",
    ]);

    spy.keepInProcess = false;
    await vi.waitFor(
      async () => {
        expect(await grantsExpiryJobs(nextly)).toEqual([]);
      },
      { timeout: 5_000, interval: 50 }
    );
  });

  it("leaves a successor queued when a row's last attempt fails", async () => {
    const nextly = await boot();
    failRegistryReads();
    await removePublicRead(nextly);
    forgetThisProcess();
    const [owed] = await grantsExpiryJobs(nextly);
    if (!owed) throw new Error("the failed expiry left no job");
    const registry = container.get<JobRegistry>("jobRegistry");
    const last = registry.get(GRANTS_EXPIRY_JOB)?.retry.maxAttempts;
    if (last === undefined)
      throw new Error("the grants expiry job is not registered");
    // Every attempt but the last already spent.
    await nextly.adapter.update(
      "nextly_jobs",
      { attempt_count: last - 1 },
      { and: [{ column: "id", op: "=", value: owed.id }] }
    );

    await runJobsPass(nextly.adapter, registry, { now: pastTheMargin });

    const rows = await grantsExpiryJobs(nextly);
    expect(rows.find(job => job.id === owed.id)?.state).toBe("failed");
    const successors = rows.filter(job => job.id !== owed.id);
    expect(successors.map(job => job.state)).toEqual(["pending"]);
  });

  it("leaves a pending job when the process stops right after the grants write commits", async () => {
    const nextly = await boot();
    const registry = container.get<JobRegistry>("jobRegistry");
    spy.flushed.length = 0;
    let resume = (): void => undefined;
    const stopped = new Promise<void>(resolve => {
      resume = resolve;
    });
    const tableExists = nextly.adapter.tableExists.bind(nextly.adapter);
    vi.spyOn(nextly.adapter, "tableExists").mockImplementation(
      async (name: string) => {
        if (name === FIRST_ASKED_AFTER_COMMIT) await stopped;
        return tableExists(name);
      }
    );

    const writing = removePublicRead(nextly);
    // The change commits; the step after it never gets on.
    await vi.waitFor(
      async () => {
        const { held } = await publicRole(nextly);
        expect(held.map(permission => permission.slug)).not.toContain(
          "read-posts"
        );
      },
      { timeout: 5_000, interval: 20 }
    );
    expect(spy.flushed).toEqual([]);
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "pending",
    ]);

    // A jobs run now leaves it: it cannot run before the write it follows commits.
    await runJobsPass(nextly.adapter, registry);
    expect(spy.flushed).toEqual([]);

    // The process is gone; a jobs run past the margin expires the pages.
    forgetThisProcess();
    await runJobsPass(nextly.adapter, registry, { now: pastTheMargin });
    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:single:header"])
    );
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "done",
    ]);

    resume();
    await writing;
  });

  it("leaves one job for a grants write that rolls back, which a jobs run completes", async () => {
    const nextly = await boot();
    const { id } = await publicRole(nextly);
    spy.flushed.length = 0;

    await expect(
      nextly.nextly.roles.setPermissions({
        roleId: id,
        permissionIds: ["no-such-permission"],
      })
    ).rejects.toThrow();

    expect(spy.flushed).toEqual([]);
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "pending",
    ]);
    await runJobsPass(
      nextly.adapter,
      container.get<JobRegistry>("jobRegistry"),
      {
        now: pastTheMargin,
      }
    );
    expect(spy.tags).toContain("nextly:posts");
    expect((await grantsExpiryJobs(nextly)).map(job => job.state)).toEqual([
      "done",
    ]);
  });
});
