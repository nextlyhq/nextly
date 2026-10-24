/**
 * A field write rule is told the entry as it is stored: its id, and none of
 * the values only the service decides.
 *
 * MySQL matches an id without regard to case, so a request naming an entry in
 * another case still finds it. A rule told the request's id then judged a
 * different string than the one stored, and `({ id }) => id !== protectedId`
 * let the write through. Nor may a body put an `id`, or a timestamp, into the
 * `data` a rule reads: those are not what is stored either.
 *
 * @module domains/collections/__tests__/field-rules-told-the-stored-id.integration.test
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "notes";
/** A collection that keeps the id a create sends. */
const CHOSEN = "chosen";
const ADMIN = "user-admin";

/** The entry whose `secret` no one may change; set once it is created. */
let protectedId = "";
/** What the rule on `note` read from `data`, one record per write. */
let seen: { id: unknown; createdAt: unknown }[] = [];

/** A `note` that records what its rule read, on a create and an update. */
const recordingNote = () => {
  const record = ({ data }: { data?: Record<string, unknown> }) => {
    seen.push({ id: data?.id, createdAt: data?.createdAt });
    return true;
  };
  return text({
    name: "note",
    access: { create: record, update: record },
  } as never);
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  protectedId = "";
  seen = [];
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          text({
            name: "secret",
            access: { update: ({ id }: { id?: string }) => id !== protectedId },
          } as never),
          recordingNote(),
        ],
      }),
      defineCollection({
        slug: CHOSEN,
        db: { allowIdOnCreate: true },
        fields: [text({ name: "title" }), recordingNote()],
      }),
    ],
  });
  // A super-admin passes every collection rule, so only the field rules
  // judge these writes.
  const tables = getDialectTables();
  const db = current.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  const now = new Date();
  await db.insert(tables.roles).values({
    id: "role-super-admin",
    name: "Super Admin",
    slug: "super-admin",
    level: 1000,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tables.users).values({
    id: ADMIN,
    email: "admin@example.com",
    name: "admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tables.userRoles).values({
    id: "user-role-admin",
    userId: ADMIN,
    roleId: "role-super-admin",
    createdAt: now,
  });
  return current;
}

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function make(t: TestNextly, title: string): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title, secret: "original", note: "first" }
  );
  expect(created.success).toBe(true);
  return String((created.data as { id: unknown }).id);
}

const update = (
  t: TestNextly,
  entryId: string,
  body: Record<string, unknown>
) =>
  handlerOf(t).updateEntry(
    { collectionName: SLUG, entryId, user: { id: ADMIN } } as never,
    body
  );

/** The stored row titled `title`; throws when there is none. */
async function stored(
  t: TestNextly,
  title: string
): Promise<{ id: string; secret?: string | null; note?: string | null }> {
  const rows = await t.adapter.select<{
    id: string;
    title: string;
    secret?: string | null;
    note?: string | null;
  }>(`dc_${SLUG}`, {});
  const row = rows.find(r => r.title === title);
  if (row === undefined) throw new Error(`no row titled "${title}"`);
  return row;
}

describe.each(getConfiguredTestDialects())(
  "field write rules are told the entry as stored (%s)",
  dialect => {
    it("refuses a protected field to an update naming the entry in another case", async () => {
      const t = await boot(dialect);
      protectedId = await make(t, "kept");
      const named = protectedId.toUpperCase();
      // The case-variant id must be a different string, or nothing is tested.
      expect(named).not.toBe(protectedId);

      const result = await update(t, named, {
        secret: "changed",
        note: "second",
      });

      // MySQL finds the entry by the other case; the write goes through, and
      // only the protected field is held back.
      if (dialect === "mysql") {
        expect(result.success).toBe(true);
        expect((await stored(t, "kept")).note).toBe("second");
      }
      expect((await stored(t, "kept")).secret).toBe("original");
    });

    it("refuses it by the exact id, and lets another entry change it", async () => {
      // The control: the rule refuses the protected entry however it is
      // named, and the refusal is the rule's, not every update's.
      const t = await boot(dialect);
      protectedId = await make(t, "kept");
      await make(t, "free");

      await update(t, protectedId, { secret: "changed" });
      expect((await stored(t, "kept")).secret).toBe("original");

      const free = await stored(t, "free");
      const result = await update(t, free.id, { secret: "changed" });
      expect(result.success).toBe(true);
      expect((await stored(t, "free")).secret).toBe("changed");
    });

    it("tells a rule reading data the stored id, and no system value the body sent", async () => {
      const t = await boot(dialect);
      const id = await make(t, "kept");

      const result = await update(t, id, {
        note: "second",
        id: "forged-id",
        createdAt: "2000-01-01T00:00:00.000Z",
      });

      expect(result.success).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
      for (const read of seen) {
        expect(read).toEqual({ id, createdAt: undefined });
      }
      // The control: the rule ran on this very write, which went through.
      expect((await stored(t, "kept")).note).toBe("second");
    });

    it("tells a create rule no id the body sent, where the collection makes its own", async () => {
      const t = await boot(dialect);
      const result = await handlerOf(t).createEntry(
        { collectionName: SLUG, user: { id: ADMIN } } as never,
        { title: "made", note: "first", id: randomUUID() }
      );

      expect(result.success).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
      for (const read of seen) {
        expect(read).toEqual({ id: undefined, createdAt: undefined });
      }
    });

    it("tells a create rule the id the body sent, where the collection keeps it", async () => {
      // The control: there, the id sent is the id stored.
      const t = await boot(dialect);
      const id = randomUUID();
      const result = await handlerOf(t).createEntry(
        { collectionName: CHOSEN, user: { id: ADMIN } } as never,
        { title: "made", note: "first", id }
      );

      expect(result.success).toBe(true);
      expect(String((result.data as { id: unknown }).id)).toBe(id);
      expect(seen.length).toBeGreaterThan(0);
      for (const read of seen)
        expect(read).toEqual({ id, createdAt: undefined });
    });
  }
);
