// A `beforeRead` hook that returns a narrowed filter narrows the rows the read
// returns, and the count beside it narrows identically.
//
// This is the test that proves the wiring. A unit test of the chain can only
// show the ordering is right; it cannot show `CollectionQueryService` actually
// calls it, which is precisely what was missing -- the hook ran, returned a
// filter, and the query was built from the caller's filter regardless.

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  json,
  text,
} from "../../../config";
import {
  registerBeforeOperationHook,
  registerHook,
  unregisterBeforeOperationHook,
  unregisterHook,
} from "../../../hooks";
import type { BeforeOperationHandler, HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// collection slug to avoid colliding with a concurrently-running file.
const SLUG = "readhook_articles";
// A second collection, for the reads a hook makes into something other than the
// collection it is running for.
const OTHER = "readhook_tenants";
const COMPONENT = "readhook_meta";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const articles = () =>
  defineCollection({
    slug: SLUG,
    fields: [
      text({ name: "title" }),
      text({ name: "tenant" }),
      // A geo predicate names a field holding a `[longitude, latitude]` tuple.
      json({ name: "location" }),
      // Component values live in their own table, so a predicate on one becomes
      // an EXISTS subquery rather than a column comparison.
      fieldGroup({ name: "meta", component: COMPONENT }),
    ],
  });

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    fieldGroups: [
      defineFieldGroup({
        slug: COMPONENT,
        fields: [text({ name: "heading" })],
      }),
    ],
    collections: [
      articles(),
      defineCollection({ slug: OTHER, fields: [text({ name: "name" })] }),
    ],
  });
  return current;
}

type ReadHandler = {
  listEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    statusCode?: number;
    message?: string;
    data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
  }>;
  countEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    statusCode?: number;
    message?: string;
    data: { totalDocs: number } | null;
  }>;
  getEntry: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: Record<string, unknown> | null;
  }>;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as ReadHandler;
}

async function seed(t: TestNextly): Promise<string[]> {
  const ids: string[] = [];
  for (const data of [
    {
      title: "a",
      tenant: "t1",
      location: [-74.006, 40.7128],
      meta: { heading: "keep" },
    },
    {
      title: "b",
      tenant: "t1",
      location: [-0.1276, 51.5074],
      meta: { heading: "drop" },
    },
    {
      title: "c",
      tenant: "t2",
      location: [-0.1276, 51.5074],
      meta: { heading: "drop" },
    },
  ]) {
    const row = await t.nextly.create({ collection: SLUG, data });
    ids.push(String((row as { id?: unknown }).id ?? ""));
  }
  await t.nextly.create({ collection: OTHER, data: { name: "t1" } });
  return ids;
}

describe("read hooks narrow the query", () => {
  it("without hooks, every row is returned and counted", async () => {
    // The control. Without it, "the hook narrowed the read" cannot be told
    // apart from a read that broke.
    const t = await boot();
    await seed(t);

    const listed = await handlerOf(t).listEntries({
      collectionName: SLUG,
      overrideAccess: true,
    });
    expect(listed.data!.docs).toHaveLength(3);
    expect(listed.data!.totalDocs).toBe(3);
  });

  it("a beforeRead return narrows both the rows and the total", async () => {
    const t = await boot();
    await seed(t);

    const scope: HookHandler = ctx => ({
      ...(ctx.data as Record<string, unknown>),
      tenant: { equals: "t1" },
    });
    registerHook("beforeRead", SLUG, scope);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });

      // The rows the hook meant to allow...
      expect(listed.data!.docs).toHaveLength(2);
      expect(
        (listed.data!.docs as { tenant?: string }[]).every(
          d => d.tenant === "t1"
        )
      ).toBe(true);
      // ...and the total describing the same set. A total of 3 beside 2 rows
      // tells the caller a third row exists, which is the fact the hook was
      // written to withhold -- so an inflated total leaks what the filtered
      // rows were meant to hide.
      expect(listed.data!.totalDocs).toBe(2);
    } finally {
      unregisterHook("beforeRead", SLUG, scope);
    }
  });

  it("a standalone count runs the hooks too", async () => {
    // `countEntries` ran none, so a caller refused rows still learned how many
    // existed.
    const t = await boot();
    await seed(t);

    const scope: HookHandler = ctx => ({
      ...(ctx.data as Record<string, unknown>),
      tenant: { equals: "t1" },
    });
    registerHook("beforeRead", SLUG, scope);

    try {
      const counted = await handlerOf(t).countEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(counted.data!.totalDocs).toBe(2);
    } finally {
      unregisterHook("beforeRead", SLUG, scope);
    }
  });

  it("beforeOperation sees the caller's filter and can replace it", async () => {
    const t = await boot();
    await seed(t);

    const seen: unknown[] = [];
    const swap: BeforeOperationHandler = ctx => {
      seen.push((ctx.args as { where?: unknown }).where);
      return { ...(ctx.args as object), where: { tenant: { equals: "t2" } } };
    };
    registerBeforeOperationHook(SLUG, swap);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
        where: { tenant: { equals: "t1" } },
      });

      // It was handed `{ where: {} }` before, so this is the half that proves
      // the hook can narrow what the caller actually asked for.
      expect(seen).toEqual([{ tenant: { equals: "t1" } }]);
      expect(listed.data!.docs).toHaveLength(1);
      expect((listed.data!.docs[0] as { tenant?: string }).tenant).toBe("t2");
    } finally {
      unregisterBeforeOperationHook(SLUG, swap);
    }
  });

  it("a beforeRead returning null clears the filter rather than being ignored", async () => {
    // `HookRegistry.execute` distinguishes `null` (a deliberate return) from
    // `undefined` (no return), so a `??` fallback here would leave a hook
    // unable to widen a read it had decided should not be narrowed.
    const t = await boot();
    await seed(t);

    const clear: HookHandler = () => null;
    registerHook("beforeRead", SLUG, clear);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
        where: { tenant: { equals: "t1" } },
      });

      // The caller asked for t1; the hook cleared that, so every row comes back.
      expect(listed.data!.docs).toHaveLength(3);
      expect(listed.data!.totalDocs).toBe(3);
    } finally {
      unregisterHook("beforeRead", SLUG, clear);
    }
  });

  it("a predicate on a component field narrows the total, not only the rows", async () => {
    // Component predicates become EXISTS subqueries and are held apart from the
    // rest of the filter while that happens. Handing the count the filter with
    // them already removed leaves it counting every row, so a caller sees one
    // row beside a total of three.
    const t = await boot();
    await seed(t);

    const listed = await handlerOf(t).listEntries({
      collectionName: SLUG,
      overrideAccess: true,
      where: { "meta.heading": { equals: "keep" } },
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs).toHaveLength(1);
    expect(listed.data!.totalDocs).toBe(1);
  });

  it("beforeOperation returning args without a filter clears it", async () => {
    // Returning an args object replaces the arguments, so omitting `where` is a
    // decision to drop the caller's filter. Falling back to the caller's filter
    // when the returned one is absent would make that impossible to express.
    const t = await boot();
    await seed(t);

    const dropFilter: BeforeOperationHandler = () => ({});
    registerBeforeOperationHook(SLUG, dropFilter);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
        where: { tenant: { equals: "t1" } },
      });

      // The caller asked for t1 -- two rows -- and the hook dropped that.
      expect(listed.data!.docs).toHaveLength(3);
    } finally {
      unregisterBeforeOperationHook(SLUG, dropFilter);
    }
  });

  it("beforeRead can scope an unfiltered read by assigning in place", async () => {
    // Hooks documented as modifying query parameters assign onto what they are
    // given and return nothing. On a read with no filter there is nothing to
    // assign onto unless the phase is handed an object, and such a handler would
    // throw on exactly the reads that most need scoping.
    const t = await boot();
    await seed(t);

    const scopeInPlace: HookHandler = ctx => {
      (ctx.data as Record<string, unknown>).tenant = { equals: "t1" };
    };
    registerHook("beforeRead", SLUG, scopeInPlace);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });

      expect(listed.success).toBe(true);
      expect(listed.data!.docs).toHaveLength(2);
      expect(listed.data!.totalDocs).toBe(2);
    } finally {
      unregisterHook("beforeRead", SLUG, scopeInPlace);
    }
  });

  it("a geo predicate is refused on a count rather than silently ignored", async () => {
    // Geo operators are evaluated over fetched rows, and a count fetches none.
    // No SQL is emitted for them, so counting one returns the total the geo
    // filter was meant to reduce -- every row, beside a list showing far fewer.
    const t = await boot();
    await seed(t);

    const refused = await handlerOf(t).countEntries({
      collectionName: SLUG,
      overrideAccess: true,
      where: { location: { near: "-74.006,40.7128,10000" } },
    });

    expect(refused.success).toBe(false);
    expect(refused.statusCode).toBe(400);
    expect(refused.message).toContain("geo filter cannot be counted");

    // The control: the same count without the geo operator answers normally, so
    // the refusal is the geo predicate and not a broken count.
    const counted = await handlerOf(t).countEntries({
      collectionName: SLUG,
      overrideAccess: true,
      where: { tenant: { equals: "t1" } },
    });
    expect(counted.success).toBe(true);
    expect(counted.data!.totalDocs).toBe(2);
  });

  it("a read hook reading another collection runs that collection's hooks", async () => {
    // The other collection's hooks may be what scopes it to a tenant or hides
    // soft-deleted rows. Suppressing them because some read is in progress hands
    // the handler rows that collection withholds from everyone else.
    const t = await boot();
    await seed(t);

    let otherRuns = 0;
    const otherHook: HookHandler = ctx => {
      otherRuns++;
      return ctx.data;
    };
    const readsOther: HookHandler = async ctx => {
      await handlerOf(t).listEntries({
        collectionName: OTHER,
        overrideAccess: true,
      });
      return ctx.data;
    };
    registerHook("beforeRead", OTHER, otherHook);
    registerHook("beforeRead", SLUG, readsOther);

    try {
      await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(otherRuns).toBe(1);
    } finally {
      unregisterHook("beforeRead", SLUG, readsOther);
      unregisterHook("beforeRead", OTHER, otherHook);
    }
  });

  it("a read hook reading its own collection by id does not re-enter itself", async () => {
    // The detail path runs the same phase the handler is already in, so without
    // the guard the handler calls itself through every nested read. The counter
    // caps it because an unguarded run does not stop on its own.
    const t = await boot();
    const ids = await seed(t);

    let runs = 0;
    const readsSelf: HookHandler = async ctx => {
      runs++;
      if (runs < 10) {
        await handlerOf(t).getEntry({
          collectionName: SLUG,
          entryId: ids[0],
          overrideAccess: true,
        });
      }
      return ctx.data;
    };
    registerHook("beforeRead", SLUG, readsSelf);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(listed.success).toBe(true);
      expect(runs).toBe(1);
    } finally {
      unregisterHook("beforeRead", SLUG, readsSelf);
    }
  });

  it("a list runs its read hooks once, not once per nested count", async () => {
    // `listEntries` calls `countEntries` for the total. Running the chain in
    // both would fire every side effect twice for one request.
    const t = await boot();
    await seed(t);

    let runs = 0;
    const counter: HookHandler = ctx => {
      runs++;
      return ctx.data;
    };
    registerHook("beforeRead", SLUG, counter);

    try {
      await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(runs).toBe(1);
    } finally {
      unregisterHook("beforeRead", SLUG, counter);
    }
  });
});
