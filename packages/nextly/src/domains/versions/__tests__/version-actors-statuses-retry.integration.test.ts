/**
 * Every version names who wrote it, records its status truthfully, and takes
 * the next number when a concurrent write took the one it read, on every
 * dialect.
 *
 * - **Actors.** A person, an API key, a seed (the Direct API with no user) and
 *   a plugin acting as the system each write a version, and the history list
 *   names each as the record of content events has it: the person by name, the
 *   key by its own name rather than its owner's, the other two as "System".
 * - **Statuses.** Without the lifecycle, a document's own `status` is recorded
 *   as it is, never as "published"; one too long for the column is marked as
 *   shortened, kept whole in the snapshot, and reported once.
 * - **Clashes.** Two transactions capture the same document at once: the later
 *   insert retries under the next number rather than failing its write.
 */

// Set before the harness boots: signing API keys reads it once.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, select, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import {
  VersionCaptureService,
  type CaptureInput,
} from "../version-capture-service";

let current: TestNextly | undefined;
let services: PluginContext["services"] | undefined;
let founder: string | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
  founder = undefined;
  vi.restoreAllMocks();
});

interface VersionItem {
  versionNo: number;
  status: string;
  author: { kind?: string; id: string | null; name: string | null } | null;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const probe = definePlugin({
    name: "@test/version-actors",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        versions: true,
        fields: [text({ name: "title" })],
      }),
      // No lifecycle: `status` is the author's own field.
      defineCollection({
        slug: "tickets",
        versions: true,
        fields: [
          text({ name: "title" }),
          select({
            name: "status",
            options: [
              { label: "Open", value: "open" },
              { label: "Archived", value: "archived" },
            ],
          }),
        ],
      }),
      // Its slug per dialect: an overflow is reported once per process for
      // each collection, and the dialects share one process.
      defineCollection({
        slug: `memos-${dialect}`,
        versions: true,
        fields: [text({ name: "title" }), text({ name: "status" })],
      }),
    ],
    plugins: [probe],
  });
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(current);
  return current;
}

let roleSeq = 0;

/** A role-based API key, named, whose role holds exactly these permissions. */
async function keyNamed(
  t: TestNextly,
  name: string,
  slugs: string[]
): Promise<string> {
  const permissions = await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  );
  roleSeq += 1;
  const role = await new ServiceContainer(t.adapter).roles.createRole({
    name: `Actors role ${roleSeq}`,
    slug: `actors-role-${roleSeq}`,
    permissionIds: slugs.map(slug => {
      const found = permissions.find(p => p.slug === slug);
      expect(found, `${slug} is seeded`).toBeDefined();
      return String(found!.id);
    }),
  });
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
    roleId: role.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** A REST request as a key. */
async function rest(
  key: string,
  method: "GET" | "POST",
  segments: string[],
  body?: unknown
): Promise<Response> {
  const request = new Request(`http://localhost/api/${segments.join("/")}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const handlers = createDynamicHandlers();
  const context = { params: Promise.resolve({ params: segments }) };
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.POST(request, context);
}

/** A document's history as REST lists it, newest first. */
async function historyOf(
  key: string,
  collection: string,
  id: string
): Promise<VersionItem[]> {
  const response = await rest(key, "GET", [
    "collections",
    collection,
    "entries",
    id,
    "versions",
  ]);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { items: VersionItem[] }).items;
}

const idOf = (result: { item?: unknown }) => (result.item as { id: string }).id;

/** The version reference of a note. */
function notesRef(entryId: string) {
  return {
    scopeKind: "collection" as const,
    scopeSlug: "notes",
    entryId,
  };
}

/**
 * Two transactions capturing at once: the first takes the next number and
 * holds it uncommitted while the second reads the same newest number, so the
 * second's insert clashes once the first commits.
 */
async function captureConcurrently(t: TestNextly, input: CaptureInput) {
  const capture = new VersionCaptureService();
  let inserted!: () => void;
  const firstInserted = new Promise<void>(resolve => (inserted = resolve));
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));

  const first = t.adapter.transaction(async tx => {
    const result = await capture.capture(tx, input);
    inserted();
    await gate;
    return result;
  });
  await firstInserted;
  const second = t.adapter.transaction(tx => capture.capture(tx, input));
  await new Promise(resolve => setTimeout(resolve, 300));
  release();
  return Promise.all([first, second]);
}

/** A document's durable version numbers, ascending. */
async function versionNumbersOf(t: TestNextly, id: string): Promise<number[]> {
  return (
    await t.adapter.select<{ entryId: string; versionNo: number | null }>(
      "nextly_versions",
      {}
    )
  )
    .flatMap(row =>
      row.entryId === id && row.versionNo !== null ? [row.versionNo] : []
    )
    .sort((x, y) => x - y);
}

describe.each(getConfiguredTestDialects())(
  "version actors, statuses and number clashes (integration, %s)",
  dialect => {
    it("names each version's actor: a person, an API key by its own name, and the system for a seed and a plugin", async () => {
      const t = await boot(dialect);
      const person = await seedLiveAuthor(t);
      const reader = await keyNamed(t, "History reader", ["read-notes"]);
      const writer = await keyNamed(t, "Import robot", [
        "create-notes",
        "read-notes",
      ]);

      // A person, through the Direct API.
      const byPerson = idOf(
        await t.nextly.create({
          collection: "notes",
          data: { title: "by a person" },
          user: { id: person },
        })
      );
      // An API key, through REST: owned by the founder, named for itself.
      const created = await rest(
        writer,
        "POST",
        ["collections", "notes", "entries"],
        {
          title: "by a key",
        }
      );
      expect(created.status, await created.clone().text()).toBeLessThan(300);
      const byKey = ((await created.json()) as { item: { id: string } }).item
        .id;
      // A seed: the Direct API with no user.
      const bySeed = idOf(
        await t.nextly.create({
          collection: "notes",
          data: { title: "seeded" },
        })
      );
      // A plugin acting for itself.
      const fromPlugin = (await services!.collections.createEntry(
        "notes",
        { title: "by a plugin" },
        { as: "system" }
      )) as { id?: string; item?: { id: string } };
      const byPlugin = fromPlugin.item?.id ?? fromPlugin.id ?? "";

      const authorOf = async (id: string) =>
        (await historyOf(reader, "notes", id))[0]?.author;
      expect(await authorOf(byPerson)).toMatchObject({
        kind: "person",
        id: person,
        name: expect.stringMatching(/^Release Author/),
      });
      expect(await authorOf(byKey)).toMatchObject({
        kind: "apiKey",
        name: "Import robot",
      });
      for (const id of [bySeed, byPlugin]) {
        expect(await authorOf(id)).toEqual({
          kind: "system",
          id: null,
          name: "System",
        });
      }
    }, 120_000);

    it("records a status the lifecycle does not know as it is, never as published", async () => {
      const t = await boot(dialect);
      const reader = await keyNamed(t, "Reader", ["read-tickets"]);
      const id = idOf(
        await t.nextly.create({
          collection: "tickets",
          data: { title: "old", status: "archived" },
        })
      );
      expect((await historyOf(reader, "tickets", id))[0]?.status).toBe(
        "archived"
      );
    }, 120_000);

    it("marks a status too long for the column as shortened, keeps it whole in the snapshot, and reports it once", async () => {
      const t = await boot(dialect);
      const collection = `memos-${dialect}`;
      const reader = await keyNamed(t, "Reader", [`read-${collection}`]);
      const error = vi.spyOn(
        t.getService("logger") as { error: (...args: unknown[]) => void },
        "error"
      );
      const long = "waiting on the legal team's review";
      expect(long.length).toBeGreaterThan(32);

      const id = idOf(
        await t.nextly.create({
          collection,
          data: { title: "one", status: long },
        })
      );
      await t.nextly.update({
        collection,
        id,
        data: { title: "two", status: long },
      });

      const versions = await historyOf(reader, collection, id);
      expect(versions.map(v => v.status)).toEqual([
        `${long.slice(0, 31)}…`,
        `${long.slice(0, 31)}…`,
      ]);
      const reported = error.mock.calls.filter(([message]) =>
        String(message).includes("longer than a version can record")
      );
      expect(reported).toHaveLength(1);
      // The whole value, in the version's snapshot.
      const row = (
        await t.adapter.select<{ snapshot: unknown; versionNo: number }>(
          "nextly_versions",
          {}
        )
      ).find(r => r.versionNo === versions[0]!.versionNo);
      const snapshot =
        typeof row?.snapshot === "string"
          ? (JSON.parse(row.snapshot) as Record<string, unknown>)
          : (row?.snapshot as Record<string, unknown>);
      expect(snapshot.status).toBe(long);
    }, 120_000);

    it("retries a version insert under the next number when a concurrent write took it", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await t.nextly.create({ collection: "notes", data: { title: "x" } })
      );
      const [a, b] = await captureConcurrently(t, {
        ref: notesRef(id),
        status: "draft",
        snapshot: { title: "x" },
        lifecycle: true,
      });
      expect(a.versionNo).not.toBe(b.versionNo);
      const numbers = await versionNumbersOf(t, id);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers).toHaveLength(3);
    }, 120_000);

    it("counts the version that won the race when the retried write trims history to its cap", async () => {
      const t = await boot(dialect);
      const id = idOf(
        await t.nextly.create({ collection: "notes", data: { title: "x" } })
      );
      // Two captures over the first version, kept to two: the write that lost
      // the race inserts third and must see the winner's version to remove
      // the first.
      await captureConcurrently(t, {
        ref: notesRef(id),
        status: "published",
        snapshot: { title: "x" },
        lifecycle: true,
        maxPerDoc: 2,
      });
      expect(await versionNumbersOf(t, id)).toEqual([2, 3]);
    }, 120_000);
  }
);
