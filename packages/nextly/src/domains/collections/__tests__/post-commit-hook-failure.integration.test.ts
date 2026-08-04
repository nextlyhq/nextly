// A hook that throws AFTER the write has committed does not fail the write.
//
// The row is durable by then and the phase cannot change it, so reporting
// failure would tell a caller its write did not happen. Every client treats a
// non-2xx as "retry", and the retry writes the row a second time -- so the
// honest-looking answer is the one that corrupts data.

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// collection slug to avoid colliding with a concurrently-running file.
const SLUG = "postcommit_articles";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.restoreAllMocks();
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
    ],
  });
  return current;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      params: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ success: boolean; data: Record<string, unknown> | null }>;
    listEntries: (p: Record<string, unknown>) => Promise<{
      success: boolean;
      data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
    }>;
  };
}

describe("a post-commit hook failure does not fail the write", () => {
  it("reports success and returns the entry the caller needs", async () => {
    // Without the entry the caller cannot even reference the row that now
    // exists: retry and it is written twice, do not retry and it is orphaned.
    const t = await boot();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const boom: HookHandler = () => {
      throw NextlyError.internal({ logContext: { reason: "notify failed" } });
    };
    registerHook("afterCreate", SLUG, boom);

    try {
      const created = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "durable" }
      );

      expect(created.success).toBe(true);
      expect(created.data?.id).toBeTruthy();
    } finally {
      unregisterHook("afterCreate", SLUG, boom);
    }
  });

  it("leaves exactly one row, which is what the caller was told", async () => {
    const t = await boot();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const boom: HookHandler = () => {
      throw NextlyError.internal({ logContext: { reason: "notify failed" } });
    };
    registerHook("afterCreate", SLUG, boom);

    try {
      const created = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "durable" }
      );

      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      // The row lands either way -- the transaction had already committed. What
      // this pins is that the answer MATCHES it: reporting failure beside a row
      // that exists is what makes a client retry and write a second one.
      expect(listed.data!.docs).toHaveLength(1);
      expect(created.success).toBe(true);
    } finally {
      unregisterHook("afterCreate", SLUG, boom);
    }
  });

  it("logs the failure, so a side effect never vanishes silently", async () => {
    // The operation reports success, so this log is the only trace an operator
    // has that the hook broke.
    const t = await boot();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const boom: HookHandler = () => {
      throw NextlyError.internal({ logContext: { reason: "notify failed" } });
    };
    registerHook("afterCreate", SLUG, boom);

    try {
      await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "durable" }
      );

      expect(logged).toHaveBeenCalled();
      expect(String(logged.mock.calls[0][0])).toContain("afterCreate");
    } finally {
      unregisterHook("afterCreate", SLUG, boom);
    }
  });

  it("still refuses the write when a BEFORE hook throws", async () => {
    // The mirror, and the reason this is safe: gating is what `before*` is for,
    // and it is untouched. Without this, "post-commit failures are tolerated"
    // could just as well be satisfied by a registry that swallows everything.
    const t = await boot();

    const deny: HookHandler = () => {
      throw NextlyError.forbidden();
    };
    registerHook("beforeCreate", SLUG, deny);

    try {
      const created = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "rejected" }
      );

      expect(created.success).toBe(false);

      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });
      expect(listed.data!.docs).toHaveLength(0);
    } finally {
      unregisterHook("beforeCreate", SLUG, deny);
    }
  });
});
