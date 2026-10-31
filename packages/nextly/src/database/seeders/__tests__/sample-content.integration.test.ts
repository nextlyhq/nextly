/**
 * The site's one sample-content load against a real `nextly_meta`, on every
 * configured dialect, through the project route's POST (`sampleContentPost`)
 * and core's `/api/dashboard/setup`:
 *
 * - two administrators who start a load at the same moment: exactly one load
 *   runs, and the other is refused with nothing loaded;
 * - a load left unfinished, read long after it started: still unfinished,
 *   holding every other start and the decline, and the setup step open on it;
 * - a load whose record failed: recorded on its own, without loading again;
 * - a failed load: no second load until the person confirms it;
 * - a decline in one session refusing a load in another.
 *
 * What the in-memory store cannot show: that the claim is decided by the
 * database's own key on each dialect, with both claims reaching it.
 *
 * @module database/seeders/__tests__/sample-content.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import type { MetaService } from "../../../domains/meta/services/meta-service";
import { conditionProbe } from "../../../domains/widgets/condition-probe";
import { refreshContentSources } from "../../../domains/widgets/content-sources";
import type { SampleSetupStep } from "../../../domains/widgets/setup-steps";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import {
  SAMPLE_LOADED_KEY,
  sampleContentPost,
  type SampleContentStore,
} from "../sample-content";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "sc_notes";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

interface Handles {
  t: TestNextly;
  meta: MetaService;
  /** The first account: a super-admin. */
  ownerId: string;
}

async function boot(dialect: TestDialect): Promise<Handles> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  const users = (
    t.nextly as unknown as {
      users: {
        create: (a: {
          data: Record<string, unknown>;
        }) => Promise<{ item: { id: string } }>;
      };
    }
  ).users;
  const created = await users.create({
    data: {
      email: "owner@sc.test",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  await refreshContentSources();
  return {
    t,
    meta: t.getService("metaService") as unknown as MetaService,
    ownerId: created.item.id,
  };
}

/** Writes one entry, as a load does. */
async function writeNote(h: Handles, title: string): Promise<void> {
  const handler = h.t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  const written = await handler.createEntry(
    { collectionName: NOTES, overrideAccess: true },
    { title }
  );
  expect(written.success).toBe(true);
}

/** The project route's POST, as an administrator starts a load from the card. */
function start(
  store: SampleContentStore,
  by: string,
  load: () => Promise<unknown>,
  body?: unknown
): Promise<Response> {
  return sampleContentPost(
    new Request("http://localhost/admin/api/seed", {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { store, by, load }
  );
}

async function cookie(userId: string, session: number): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}-${session}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/** One PUT to core's `/api/dashboard/setup`, signed in as `userId`. */
async function putSetup(
  userId: string,
  body: unknown,
  session = 1
): Promise<Response> {
  const request = new Request("http://localhost/api/dashboard/setup", {
    method: "PUT",
    headers: {
      cookie: await cookie(userId, session),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return createDynamicHandlers().PUT(request, {
    params: Promise.resolve({ params: ["dashboard", "setup"] }),
  });
}

/** The setup card's sample step for the owner, as the card's load reads it. */
async function sampleStep(h: Handles): Promise<SampleSetupStep | undefined> {
  const answer = await conditionProbe({
    user: { id: h.ownerId, roles: [] },
  }).setup();
  if (!answer.known) throw new Error("setup not known");
  return answer.steps.find(
    (step): step is SampleSetupStep => step.kind === "sample"
  );
}

/**
 * The real store, with every first read of the first claim held until both
 * starts have made it: so both find nobody started, and both claims reach the
 * database together, where its key alone can decide.
 */
function bothReadFirst(meta: MetaService): SampleContentStore {
  let waiting = 0;
  let release: () => void = () => undefined;
  const bothRead = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    getEntry: async <T>(key: string) => {
      const entry = await meta.getEntry<T>(key);
      if (key === "seed.run.1" && waiting < 2) {
        waiting += 1;
        if (waiting === 2) release();
        await bothRead;
      }
      return entry;
    },
    insertIfAbsent: (key, value) => meta.insertIfAbsent(key, value),
    set: (key, value) => meta.set(key, value),
  };
}

describe.each(getConfiguredTestDialects())(
  "sample content, one load at a time (integration, %s)",
  dialect => {
    it("runs exactly one load when two administrators start one at the same moment", async () => {
      const h = await boot(dialect);
      const store = bothReadFirst(h.meta);
      let loads = 0;
      const load = async () => {
        loads += 1;
        await writeNote(h, "Sample");
        return { posts: 1 };
      };
      const [one, two] = await Promise.all([
        start(store, "admin-a", load),
        start(store, "admin-b", load),
      ]);
      expect(loads).toBe(1);
      expect([one.status, two.status].sort()).toEqual([200, 409]);
      const refused = one.status === 409 ? one : two;
      expect(await refused.json()).toMatchObject({
        outcome: "refused",
        errors: [{ message: expect.any(String) }],
      });
      expect(await h.meta.get(SAMPLE_LOADED_KEY)).toEqual(expect.any(String));
      expect((await sampleStep(h))?.status).toBe("done");
    });

    it("keeps a load that never reported unfinished however long after it started, holding every other start and the decline", async () => {
      const h = await boot(dialect);
      let finish: () => void = () => undefined;
      const hanging = new Promise<void>(resolve => {
        finish = resolve;
      });
      // Started years ago, by the clock the claim is stamped with; still running.
      vi.useFakeTimers({
        toFake: ["Date"],
        now: new Date("2020-01-01T00:00:00Z"),
      });
      const first = start(h.meta, h.ownerId, async () => {
        await writeNote(h, "Half-loaded");
        await hanging;
        return "late";
      });
      // Polled by hand: only the date is faked, and the claim lands within a few reads.
      for (let read = 0; read < 200; read += 1) {
        if ((await h.meta.getEntry("seed.run.1")).present) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      vi.useRealTimers();
      expect((await h.meta.getEntry("seed.run.1")).present).toBe(true);

      // Read now, long after: the step is open on the load, though the site holds an entry.
      await vi.waitFor(async () =>
        expect(await sampleStep(h)).toEqual({
          kind: "sample",
          status: "open",
          run: { state: "unfinished", startedAt: "2020-01-01T00:00:00.000Z" },
        })
      );
      const second = vi.fn(async () => "second");
      const refused = await start(h.meta, "admin-b", second, { confirm: true });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ reason: "in-progress" });
      expect(second).not.toHaveBeenCalled();
      const decline = await putSetup(h.ownerId, { sample: "decline" });
      expect(decline.status).toBe(409);
      expect(await h.meta.get("seed.skippedAt")).toBeNull();

      finish();
      expect((await first).status).toBe(200);
    });

    it("records a load whose record failed on its own, without loading again", async () => {
      const h = await boot(dialect);
      const realSet = h.meta.set.bind(h.meta);
      const once = vi
        .spyOn(h.meta, "set")
        .mockImplementation(async (key, value) => {
          if (key === SAMPLE_LOADED_KEY) throw new Error("disk full");
          return realSet(key, value);
        });
      let loads = 0;
      const load = async () => {
        loads += 1;
        await writeNote(h, "Sample");
        return { posts: 1 };
      };
      const loaded = await start(h.meta, h.ownerId, load);
      expect(loaded.status).toBe(200);
      const body = (await loaded.json()) as { outcome: string; run: string };
      expect(body.outcome).toBe("unrecorded");
      once.mockRestore();

      // Every reader sees it loaded and not recorded, and no load is started over it.
      expect((await sampleStep(h))?.run).toEqual({
        state: "unrecorded",
        startedAt: expect.any(String),
        run: body.run,
      });
      const again = await start(h.meta, "admin-b", load, { confirm: true });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ reason: "unrecorded" });

      // A run that is not the waiting one records nothing.
      expect(
        (await putSetup(h.ownerId, { sample: { record: "someone-else" } }))
          .status
      ).toBe(409);
      const recorded = await putSetup(h.ownerId, {
        sample: { record: body.run },
      });
      expect(recorded.status).toBe(200);
      expect(await recorded.json()).toMatchObject({
        item: { sample: { answer: "loaded" } },
      });
      expect(loads).toBe(1);
      expect((await sampleStep(h))?.status).toBe("done");
    });

    it("allows no second load after a failure until the person confirms it", async () => {
      const h = await boot(dialect);
      const failing = vi.fn(async () => {
        await writeNote(h, "Partial");
        throw new Error("post hello-world: media missing");
      });
      const failed = await start(h.meta, h.ownerId, failing);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toMatchObject({
        outcome: "failed",
        failure: "post hello-world: media missing",
      });
      // Kept for every reader, with what failed, though the failed load left an entry.
      expect((await sampleStep(h))?.run).toEqual({
        state: "failed",
        startedAt: expect.any(String),
        failure: "post hello-world: media missing",
      });

      const load = vi.fn(async () => "ok");
      const unconfirmed = await start(h.meta, h.ownerId, load);
      expect(unconfirmed.status).toBe(409);
      expect(await unconfirmed.json()).toMatchObject({ reason: "confirm" });
      expect(load).not.toHaveBeenCalled();
      expect(failing).toHaveBeenCalledTimes(1);

      const confirmed = await start(h.meta, h.ownerId, load, { confirm: true });
      expect(confirmed.status).toBe(200);
      expect(load).toHaveBeenCalledTimes(1);
      expect((await sampleStep(h))?.status).toBe("done");
    });

    it("refuses a load in one session once another declined, and records the decline for the site", async () => {
      const h = await boot(dialect);
      const declined = await putSetup(h.ownerId, { sample: "decline" }, 1);
      expect(declined.status).toBe(200);
      expect(await declined.json()).toMatchObject({
        item: { sample: { answer: "declined" } },
      });

      const load = vi.fn(async () => "ok");
      const refused = await start(h.meta, h.ownerId, load);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        reason: "answered",
        state: { answer: "declined" },
      });
      expect(load).not.toHaveBeenCalled();
      // Declining again in the second session is the same answer, not a refusal.
      expect((await putSetup(h.ownerId, { sample: "decline" }, 2)).status).toBe(
        200
      );
      expect(await h.meta.get("seed.skippedAt")).toEqual(expect.any(String));
    });
  }
);
