// A `beforeRead` hook that returns a narrowed filter narrows the rows the read
// returns, and the count beside it narrows identically.
//
// This is the test that proves the wiring. A unit test of the chain can only
// show the ordering is right; it cannot show `CollectionQueryService` actually
// calls it, which is precisely what was missing -- the hook ran, returned a
// filter, and the query was built from the caller's filter regardless.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
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

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const articles = () =>
  defineCollection({
    slug: SLUG,
    fields: [text({ name: "title" }), text({ name: "tenant" })],
  });

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({ collections: [articles()] });
  return current;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
    }>;
    countEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { totalDocs: number } | null;
    }>;
  };
}

async function seed(t: TestNextly): Promise<void> {
  for (const data of [
    { title: "a", tenant: "t1" },
    { title: "b", tenant: "t1" },
    { title: "c", tenant: "t2" },
  ]) {
    await t.nextly.create({ collection: SLUG, data });
  }
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
      // discloses that a third exists, which is what #348 established as a
      // disclosure rather than a rounding error.
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
