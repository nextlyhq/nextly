/**
 * The setup card against a real instance, on every configured dialect, as the
 * reader.
 *
 * What only a booted instance can show:
 *
 * - each step's rule over real rows: a Single ticked by the trail's record of
 *   a save, even one made in the second it was created, and never by a save of
 *   an earlier Single under its slug; one saved before the trail recorded saves
 *   counted from its stored instants; the first entry from collection entries
 *   only; inviting from a second account; sample content from the site's
 *   answer;
 * - each step offered only to a reader who could finish it, a key judged on
 *   its own scope;
 * - the card for super-admins only: an editor's default dashboard on a new
 *   project carries no setup card;
 * - what each reader's card remembers, kept on the server per reader through
 *   `/api/dashboard/setup`: collapsed, dismissed (and the card then out of
 *   their dashboard), and skipped;
 * - "You're all set" said once: the load that finds every step done records
 *   it, and the next layout read carries no setup card and offers no Resume;
 * - registries that cannot be listed make setup "not known", never a step
 *   shown open.
 *
 * @module domains/widgets/__tests__/setup.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { conditionProbe } from "../condition-probe";
import { evaluateConditions } from "../conditions";
import { refreshContentSources } from "../content-sources";
import { setupCardData, setupShownTo } from "../setup-card";
import type { SetupAnswer, SetupStep } from "../setup-steps";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "su_notes";
const HOME = "su-home";
const LOCKED = "su-locked";
const SETUP = "core/setup";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

interface Handles {
  t: TestNextly;
  /** The first account: the super-admin. */
  owner: ReadCaller;
  ownerId: string;
}

async function account(t: TestNextly, email: string): Promise<string> {
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
    data: { email, password: "Password123!", name: email, isActive: true },
  });
  return created.item.id;
}

/** An instance with one collection and two Singles, and its first account, a super-admin. */
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
    singles: [
      defineSingle({
        slug: HOME,
        label: { singular: "Home" },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: LOCKED,
        label: { singular: "Locked" },
        // Readable and not writable by its rule: a key cannot finish it.
        access: { read: () => true, update: () => false },
        fields: [text({ name: "note" })],
      }),
    ],
  });
  current = t;
  const ownerId = await account(t, "owner@su.test");
  // As the layout read does first: publish both kinds of source from the live registries.
  await refreshContentSources();
  return { t, ownerId, owner: { user: { id: ownerId, roles: [] } } };
}

/** The steps by kind, for one reader, before any skips. */
async function stepsFor(caller: ReadCaller): Promise<{
  answer: SetupAnswer;
  byKind: Partial<Record<SetupStep["kind"], SetupStep>>;
}> {
  const answer = await conditionProbe(caller).setup();
  return {
    answer,
    byKind: answer.known
      ? Object.fromEntries(answer.steps.map(step => [step.kind, step]))
      : {},
  };
}

/** Writes a collection entry, and refuses to continue if it did not land. */
async function writeNote(h: Handles): Promise<void> {
  const handler = h.t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  const written = await handler.createEntry(
    { collectionName: NOTES, overrideAccess: true },
    { title: "First" }
  );
  expect(written.success).toBe(true);
}

/** Saves a Single as a named writer, which is what the trail records. */
async function saveSingle(h: Handles, slug: string): Promise<void> {
  const singles = h.t.getService("singleEntryService") as unknown as {
    update: (
      slug: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  const saved = await singles.update(
    slug,
    slug === HOME ? { headline: "Welcome" } : { note: "Kept" },
    {
      overrideAccess: true,
      user: { id: h.ownerId, name: "Owner", email: "owner@su.test" },
    }
  );
  expect(saved.success).toBe(true);
}

/** The Single's own table, by the registry's record of it. */
async function homeTable(h: Handles): Promise<string> {
  const registry = h.t.getService("singleRegistryService") as unknown as {
    getSingleBySlug: (slug: string) => Promise<{ tableName: string } | null>;
  };
  const single = await registry.getSingleBySlug(HOME);
  expect(single).not.toBeNull();
  return single!.tableName;
}

/** Sets the Single's stored `updated_at` relative to its `created_at`. */
async function setWrittenAfterCreated(
  h: Handles,
  later: boolean
): Promise<void> {
  const table = await homeTable(h);
  const row = await h.t.adapter.selectOne<{ id: string; created_at: Date }>(
    table,
    { columns: ["id", "created_at"] }
  );
  expect(row).not.toBeNull();
  const created = new Date(row!.created_at);
  await h.t.adapter.update(
    table,
    {
      updated_at: later ? new Date(created.getTime() + 86_400_000) : created,
    },
    { and: [{ column: "id", op: "=", value: row!.id }] }
  );
}

/** Whether the Home Single reads as filled in, for this reader. */
async function homeFilledIn(caller: ReadCaller): Promise<boolean | undefined> {
  const singles = (await stepsFor(caller)).byKind.singles;
  return singles?.kind === "singles"
    ? singles.singles.find(single => single.slug === HOME)?.filledIn
    : undefined;
}

async function cookie(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/** One request to `/api/dashboard/<route>` through the real catch-all handler, signed in as `userId`. */
async function call(
  userId: string,
  route: "layout" | "setup",
  method: "GET" | "PUT",
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const request = new Request(`http://localhost/api/dashboard/${route}`, {
    method,
    headers: {
      cookie: await cookie(userId),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ params: ["dashboard", route] }) };
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.PUT(request, context);
}

/** The widget ids of the cards a layout read hands this reader. */
async function dashboardOf(userId: string): Promise<string[]> {
  const res = await call(userId, "layout", "GET");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    placements: Array<{ widgetId: string; removed: boolean }>;
  };
  return body.placements.filter(p => !p.removed).map(p => p.widgetId);
}

describe.each(getConfiguredTestDialects())(
  "the setup card (integration, %s)",
  dialect => {
    it("offers a super-admin on a new project each step they could finish, in order", async () => {
      const h = await boot(dialect);
      const { answer, byKind } = await stepsFor(h.owner);

      expect(answer.known).toBe(true);
      expect(answer.known && answer.steps.map(step => step.kind)).toEqual([
        "sample",
        "collection",
        "entry",
        "singles",
        "invite",
      ]);
      expect(byKind.sample?.status).toBe("open");
      expect(byKind.collection?.status).toBe("done");
      // Opens a new entry of the first collection they may create in.
      expect(byKind.entry).toEqual({
        kind: "entry",
        status: "open",
        collection: NOTES,
      });
      // ONE step for both Singles: a super-admin may update either.
      expect(byKind.singles).toEqual({
        kind: "singles",
        status: "open",
        singles: [
          { slug: HOME, filledIn: false },
          { slug: LOCKED, filledIn: false },
        ],
      });
      expect(byKind.invite?.status).toBe("open");
    });

    it("ticks a Single from the trail's record, though its save fell in the second it was created", async () => {
      const h = await boot(dialect);
      await saveSingle(h, HOME);
      // The stored instants now say nothing was written after creation, as a save in the same
      // second leaves them; only the trail can tell.
      await setWrittenAfterCreated(h, false);
      expect(await homeFilledIn(h.owner)).toBe(true);
    });

    it("ticks a Single saved before the trail recorded saves from its stored instants, and only then", async () => {
      const h = await boot(dialect);
      await saveSingle(h, HOME);
      // No trail row: as a save made before saves were recorded.
      await h.t.adapter.delete("activity_log", {
        and: [{ column: "collection", op: "=", value: HOME }],
      });
      await setWrittenAfterCreated(h, true);
      expect(await homeFilledIn(h.owner)).toBe(true);
      // The must-differ half: the same Single, its instants equal, is not filled in.
      await setWrittenAfterCreated(h, false);
      expect(await homeFilledIn(h.owner)).toBe(false);
    });

    it("does not tick a Single from the saves of the one its slug named before", async () => {
      const h = await boot(dialect);
      await saveSingle(h, HOME);
      await setWrittenAfterCreated(h, false);
      // As a Single deleted and made again under its slug: the registry's row
      // is newer than the save the trail kept.
      await h.t.adapter.update(
        "dynamic_singles",
        { created_at: new Date(Date.now() + 60_000) },
        { and: [{ column: "slug", op: "=", value: HOME }] }
      );
      expect(await homeFilledIn(h.owner)).toBe(false);
      // The must-differ half: a save of the Single as it is now counts.
      await h.t.adapter.update(
        "dynamic_singles",
        { created_at: new Date(Date.now() - 60_000) },
        { and: [{ column: "slug", op: "=", value: HOME }] }
      );
      expect(await homeFilledIn(h.owner)).toBe(true);
    });

    it("ticks the first entry from collection entries only, the Singles once both are saved, inviting from a second account, and sample content once it is declined", async () => {
      const h = await boot(dialect);
      await saveSingle(h, HOME);
      // A filled-in Single is not content.
      expect((await stepsFor(h.owner)).byKind.entry?.status).toBe("open");
      // One Single of two: the step is still open.
      expect((await stepsFor(h.owner)).byKind.singles?.status).toBe("open");

      await saveSingle(h, LOCKED);
      await writeNote(h);
      await account(h.t, "teammate@su.test");
      await h.t
        .getService("metaService")
        .set("seed.skippedAt", new Date().toISOString());

      const { answer, byKind } = await stepsFor(h.owner);
      expect(byKind.sample?.status).toBe("done");
      expect(byKind.entry).toEqual({ kind: "entry", status: "done" });
      expect(byKind.singles?.status).toBe("done");
      expect(byKind.invite?.status).toBe("done");
      expect(
        answer.known && { done: answer.done, total: answer.total }
      ).toEqual({ done: 5, total: 5 });
    });

    it("leaves sample content out once the site has an entry and nobody answered the offer", async () => {
      const h = await boot(dialect);
      await writeNote(h);
      expect((await stepsFor(h.owner)).byKind).not.toHaveProperty("sample");
    });

    it("offers a key only the steps its scope and the rules let it finish", async () => {
      const h = await boot(dialect);
      // Stamped to update both Singles and to read, not create, users. A key is judged on its
      // own scope and then each Single's own rule, which refuses the locked one.
      const key: ReadCaller = {
        user: { id: h.ownerId, roles: [] },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [
            `read-${NOTES}`,
            "read-users",
            `read-${HOME}`,
            `read-${LOCKED}`,
            `update-${HOME}`,
            `update-${LOCKED}`,
          ],
        },
      };
      const { byKind } = await stepsFor(key);
      expect(byKind.singles).toEqual({
        kind: "singles",
        status: "open",
        singles: [{ slug: HOME, filledIn: false }],
      });
      expect(byKind).not.toHaveProperty("invite");
      // And the card itself is a person's: a key is never shown it.
      expect(await setupShownTo(key)).toBe(false);
    });

    it("shows the card to the super-admin only: an editor's default on a new project carries none", async () => {
      const h = await boot(dialect);
      const editor = await account(h.t, "editor@su.test");

      expect(await setupShownTo(h.owner)).toBe(true);
      expect(await setupShownTo({ user: { id: editor, roles: [] } })).toBe(
        false
      );
      expect(await dashboardOf(h.ownerId)).toContain(SETUP);
      expect(await dashboardOf(editor)).not.toContain(SETUP);
      // The editor may not read or change the card's state either.
      expect((await call(editor, "setup", "GET")).status).toBe(403);
      expect(
        (await call(editor, "setup", "PUT", { collapsed: true })).status
      ).toBe(403);
    });

    it("keeps a collapse per reader on the server, and the card reads it back", async () => {
      const h = await boot(dialect);
      const now = new Date();
      expect((await setupCardData(h.owner, now)).collapsed).toBe(false);

      const res = await call(h.ownerId, "setup", "PUT", { collapsed: true });
      expect(res.status).toBe(200);
      expect((await setupCardData(h.owner, now)).collapsed).toBe(true);

      // Expanded again, from any device: the same row.
      await call(h.ownerId, "setup", "PUT", { collapsed: false });
      expect((await setupCardData(h.owner, now)).collapsed).toBe(false);
    });

    it("keeps a skip of a skippable step, counts it done, and refuses a skip of any other", async () => {
      const h = await boot(dialect);
      const skip = await call(h.ownerId, "setup", "PUT", {
        skip: { kind: "invite", skipped: true },
      });
      expect(skip.status).toBe(200);
      const card = await setupCardData(h.owner, new Date());
      const invite = card.setup.known
        ? card.setup.steps.find(step => step.kind === "invite")
        : undefined;
      expect(invite?.status).toBe("skipped");

      const refused = await call(h.ownerId, "setup", "PUT", {
        skip: { kind: "entry", skipped: true },
      });
      expect(refused.status).toBe(400);
    });

    it("keeps a dismissal per reader: the card leaves their dashboard and Resume is offered, until they resume it", async () => {
      const h = await boot(dialect);
      expect(
        (await call(h.ownerId, "setup", "PUT", { dismissed: true })).status
      ).toBe(200);

      expect(await setupShownTo(h.owner)).toBe(false);
      expect(await dashboardOf(h.ownerId)).not.toContain(SETUP);
      const state = (await (await call(h.ownerId, "setup", "GET")).json()) as {
        dismissed: boolean;
        resumable: boolean;
      };
      expect(state).toMatchObject({ dismissed: true, resumable: true });

      await call(h.ownerId, "setup", "PUT", { dismissed: false });
      expect(await dashboardOf(h.ownerId)).toContain(SETUP);
    });

    it('says "You\'re all set" once: the second load carries no setup card and offers no Resume', async () => {
      const h = await boot(dialect);
      await saveSingle(h, HOME);
      await saveSingle(h, LOCKED);
      await writeNote(h);
      await account(h.t, "teammate@su.test");
      await h.t
        .getService("metaService")
        .set("seed.completedAt", new Date().toISOString());

      // The first load that finds every step done says so.
      expect(await dashboardOf(h.ownerId)).toContain(SETUP);
      const first = await setupCardData(h.owner, new Date());
      expect(first.allSet).toBe(true);

      // The next carries no card, and the header has nothing to resume.
      expect(await dashboardOf(h.ownerId)).not.toContain(SETUP);
      await call(h.ownerId, "setup", "PUT", { dismissed: true });
      const state = (await (await call(h.ownerId, "setup", "GET")).json()) as {
        resumable: boolean;
      };
      expect(state.resumable).toBe(false);
    });

    it("says setup is not known when the registries cannot be listed, never a step open, and holds the setup condition", async () => {
      const h = await boot(dialect);
      // Known first: the must-differ half.
      expect((await stepsFor(h.owner)).answer.known).toBe(true);

      const registry = h.t.getService(
        "collectionRegistryService"
      ) as unknown as {
        getAllSlugs: () => Promise<string[]>;
      };
      vi.spyOn(registry, "getAllSlugs").mockRejectedValue(
        new Error("registry down")
      );

      expect((await stepsFor(h.owner)).answer).toEqual({ known: false });
      // The card is still shown, to say so with Retry.
      expect(await setupShownTo(h.owner)).toBe(true);
      expect((await setupCardData(h.owner, new Date())).setup).toEqual({
        known: false,
      });
      const during = await evaluateConditions(
        new Set(["onboarding:incomplete", "content:empty"]),
        h.owner
      );
      expect(during.get("onboarding:incomplete")).toBe(true);
      // Not known is not empty.
      expect(during.get("content:empty")).toBe(false);
    });
  }
);
