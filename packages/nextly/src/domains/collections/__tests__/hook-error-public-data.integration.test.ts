// A typed error thrown by a hook keeps the data its meaning lives in.
//
// A rate limit says how long to wait, and that interval lives in the error's
// `publicData`, not in its code. An envelope that drops it produces a 429 with
// no backoff: the caller is told to slow down without being told by how much,
// and the route cannot emit `Retry-After` at all.

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
const SLUG = "pubdata_articles";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
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
    ) => Promise<{
      success: boolean;
      statusCode?: number;
      code?: string;
      publicData?: unknown;
    }>;
  };
}

describe("a hook's typed error keeps its public data", () => {
  it("carries a rate limit's retry interval into the service envelope", async () => {
    const t = await boot();

    const limit: HookHandler = () => {
      throw NextlyError.rateLimited({ retryAfterSeconds: 30 });
    };
    registerHook("beforeCreate", SLUG, limit);

    try {
      const result = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "t" }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("RATE_LIMITED");
      expect(result.statusCode).toBe(429);
      // The half a boundary cannot reconstruct on its own.
      expect(result.publicData).toEqual({ retryAfterSeconds: 30 });
    } finally {
      unregisterHook("beforeCreate", SLUG, limit);
    }
  });

  it("leaves the envelope's public data absent when the error has none", async () => {
    // The control. Most errors carry nothing here, and an empty object would
    // reach the wire as `error.data: {}` where callers expect no key at all.
    const t = await boot();

    const deny: HookHandler = () => {
      throw NextlyError.forbidden();
    };
    registerHook("beforeCreate", SLUG, deny);

    try {
      const result = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "t" }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("FORBIDDEN");
      expect(result.publicData).toBeUndefined();
    } finally {
      unregisterHook("beforeCreate", SLUG, deny);
    }
  });
});
