/**
 * The Get started steps against a real instance, on every configured dialect.
 *
 * What only a booted instance can show: that "fill in a Single" is answered by
 * the trail's record of a save, even one made in the second the Single was
 * created; that a Single saved before the trail recorded saves still counts
 * from its stored instants, and one never saved stays waiting; that each step
 * is offered only to a reader who could finish it; and that registries which
 * cannot be listed make setup "not known", which holds the setup condition.
 *
 * @module domains/widgets/__tests__/get-started.integration.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshContentSources } from "../collection-widgets";
import { conditionProbe } from "../condition-probe";
import { evaluateConditions } from "../conditions";
import { getStartedSteps } from "../get-started";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "gs_notes";
const HOME = "gs-home";
const LOCKED = "gs-locked";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

interface Handles {
  t: TestNextly;
  owner: ReadCaller;
  ownerId: string;
}

/** An instance with one collection and two Singles, and its first account, a super admin. */
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
        // Readable and not writable: a step this reader could not finish.
        access: { read: () => true, update: () => false },
        fields: [text({ name: "note" })],
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
  const owner = await users.create({
    data: {
      email: "owner@gs.test",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  // As the layout read does first: publish both kinds of source from the live registries.
  await refreshContentSources();
  return {
    t,
    ownerId: owner.item.id,
    owner: { user: { id: owner.item.id, roles: [] } },
  };
}

async function statusesFor(caller: ReadCaller) {
  const answer = await getStartedSteps(conditionProbe(caller));
  return {
    answer,
    byKey: Object.fromEntries(
      answer.steps.map(step => [step.key, step.status])
    ),
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

/** Saves the Single as a named writer, which is what the trail records. */
async function saveHome(h: Handles): Promise<void> {
  const singles = h.t.getService("singleEntryService") as unknown as {
    update: (
      slug: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  const saved = await singles.update(
    HOME,
    { headline: "Welcome" },
    {
      overrideAccess: true,
      user: { id: h.ownerId, name: "Owner", email: "owner@gs.test" },
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

describe.each(getConfiguredTestDialects())(
  "the Get started steps (integration, %s)",
  dialect => {
    it("offers each step only where the reader could finish it, and a Single never saved as waiting", async () => {
      const h = await boot(dialect);
      const { byKey, answer } = await statusesFor(h.owner);

      expect(answer.unknown).toBe(false);
      // A super admin may update both Singles: the bypass comes before any rule.
      expect(byKey).toEqual({
        collection: "done",
        entry: "open",
        [`single:${HOME}`]: "open",
        [`single:${LOCKED}`]: "open",
        invite: "open",
      });
    });

    it("ticks a Single from the trail's record, though its save fell in the second it was created", async () => {
      const h = await boot(dialect);
      await saveHome(h);
      // The stored instants now say nothing was written after creation, as a save in the same
      // second leaves them; only the trail can tell.
      await setWrittenAfterCreated(h, false);

      expect((await statusesFor(h.owner)).byKey[`single:${HOME}`]).toBe("done");
    });

    it("ticks a Single saved before the trail recorded saves from its stored instants, and only then", async () => {
      const h = await boot(dialect);
      await saveHome(h);
      // No trail row: as a save made before saves were recorded.
      await h.t.adapter.delete("activity_log", {
        and: [{ column: "collection", op: "=", value: HOME }],
      });

      await setWrittenAfterCreated(h, true);
      expect((await statusesFor(h.owner)).byKey[`single:${HOME}`]).toBe("done");

      // The must-differ half: the same Single, its instants equal, is waiting.
      await setWrittenAfterCreated(h, false);
      expect((await statusesFor(h.owner)).byKey[`single:${HOME}`]).toBe("open");
    });

    it("ticks the first entry from collection entries only, and inviting from a second account", async () => {
      const h = await boot(dialect);
      await saveHome(h);
      // A filled-in Single is not content.
      expect((await statusesFor(h.owner)).byKey.entry).toBe("open");

      await writeNote(h);
      await (
        h.t.nextly as unknown as {
          users: {
            create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
          };
        }
      ).users.create({
        data: {
          email: "teammate@gs.test",
          password: "Password123!",
          name: "Teammate",
          isActive: true,
        },
      });

      const { byKey, answer } = await statusesFor(h.owner);
      expect(byKey.entry).toBe("done");
      expect(byKey.invite).toBe("done");
      // Everything but the Single nobody saved: done, and counted as done.
      expect({ done: answer.done, total: answer.total }).toEqual({
        done: 4,
        total: 5,
      });
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
      const { byKey } = await statusesFor(key);
      expect(byKey[`single:${HOME}`]).toBe("open");
      expect(byKey).not.toHaveProperty(`single:${LOCKED}`);
      expect(byKey).not.toHaveProperty("invite");
    });

    it("says setup is not known when the registries cannot be listed, and holds the setup condition", async () => {
      const h = await boot(dialect);
      await writeNote(h);
      // Every step the condition reads is done for this reader, so it lapses: the must-differ
      // half, and what makes "not known" the only thing that can hold it below.
      const before = await evaluateConditions(
        new Set(["onboarding:incomplete"]),
        h.owner
      );
      expect(before.get("onboarding:incomplete")).toBe(false);

      // The read the registry answers its listings with.
      const registry = h.t.getService(
        "collectionRegistryService"
      ) as unknown as {
        getAllSlugs: () => Promise<string[]>;
      };
      vi.spyOn(registry, "getAllSlugs").mockRejectedValue(
        new Error("registry down")
      );

      const { answer, byKey } = await statusesFor(h.owner);
      expect(answer.unknown).toBe(true);
      // Neither shown as waiting on the strength of a registry that did not answer.
      expect(byKey.collection === "open" || byKey.entry === "open").toBe(false);
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
