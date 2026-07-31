// A read hook's typed error keeps its own status and code.
//
// The read paths recorded only a status in their catch, so the code-keyed
// rebuild at the boundary had nothing to key on: a `beforeRead` throwing
// `rateLimited()` reached the caller as a generic 500, and a read by id
// hardcoded 500 regardless of what was raised.

import { afterEach, describe, expect, it } from "vitest";

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
const SLUG = "readtyped_articles";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Envelope = {
  success: boolean;
  statusCode?: number;
  code?: string;
  publicData?: unknown;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    listEntries: (p: Record<string, unknown>) => Promise<Envelope>;
    countEntries: (p: Record<string, unknown>) => Promise<Envelope>;
    getEntry: (p: Record<string, unknown>) => Promise<Envelope>;
  };
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
    ],
  });
  return current;
}

describe("a read hook's typed error survives the read path", () => {
  it("keeps the code and status on a list", async () => {
    const t = await boot();
    const limit: HookHandler = () => {
      throw NextlyError.rateLimited({ retryAfterSeconds: 30 });
    };
    registerHook("beforeRead", SLUG, limit);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });

      expect(listed.success).toBe(false);
      expect(listed.statusCode).toBe(429);
      expect(listed.code).toBe("RATE_LIMITED");
      // The interval the route needs for `Retry-After`.
      expect(listed.publicData).toEqual({ retryAfterSeconds: 30 });
    } finally {
      unregisterHook("beforeRead", SLUG, limit);
    }
  });

  it("keeps the code and status on a count", async () => {
    const t = await boot();
    const deny: HookHandler = () => {
      throw NextlyError.authRequired();
    };
    registerHook("beforeRead", SLUG, deny);

    try {
      const counted = await handlerOf(t).countEntries({
        collectionName: SLUG,
        overrideAccess: true,
      });

      expect(counted.success).toBe(false);
      expect(counted.statusCode).toBe(401);
      expect(counted.code).toBe("AUTH_REQUIRED");
    } finally {
      unregisterHook("beforeRead", SLUG, deny);
    }
  });

  it("keeps the code and status on a read by id", async () => {
    // This path hardcoded 500, so even the status was lost.
    const t = await boot();
    await t.nextly.create({ collection: SLUG, data: { title: "t" } });
    const deny: HookHandler = () => {
      throw NextlyError.forbidden();
    };
    registerHook("beforeRead", SLUG, deny);

    try {
      const got = await handlerOf(t).getEntry({
        collectionName: SLUG,
        entryId: "does-not-matter",
        overrideAccess: true,
      });

      expect(got.success).toBe(false);
      expect(got.statusCode).toBe(403);
      expect(got.code).toBe("FORBIDDEN");
    } finally {
      unregisterHook("beforeRead", SLUG, deny);
    }
  });
});
