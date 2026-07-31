// What a read hook is handed.
//
// A hook is documented against the value the field was configured with, but
// `afterRead` ran before JSON columns were decoded, so on SQLite every handler
// received the storage encoding instead.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, json, text } from "../../../config";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const DOCS = "finalval_docs";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type ReadHandler = {
  listEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { docs: Record<string, unknown>[]; totalDocs: number } | null;
  }>;
  getEntry: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: Record<string, unknown> | null;
  }>;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as ReadHandler;
}

// The id is read back rather than taken from the create call, so the fixture
// does not depend on that call's envelope shape.
async function onlyId(t: TestNextly, collection: string): Promise<string> {
  const listed = await handlerOf(t).listEntries({
    collectionName: collection,
    overrideAccess: true,
  });
  return String(listed.data!.docs[0].id);
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: DOCS,
        fields: [text({ name: "title" }), json({ name: "config" })],
      }),
    ],
  });
  return current;
}

describe("read hooks see the values a caller sees", () => {
  it("afterRead is handed a decoded JSON value, not the storage encoding", async () => {
    // SQLite has no JSON type, so these columns come back as strings. A hook
    // that reads `entry.config.mode` gets `undefined` from a string, and one
    // that assigns onto it throws -- on SQLite only, which is the default
    // development database.
    const t = await boot();
    await t.nextly.create({
      collection: DOCS,
      data: { title: "d", config: { mode: "live" } },
    });

    const seen: unknown[] = [];
    const record: HookHandler = ctx => {
      const rows = ctx.data as Record<string, unknown>[];
      seen.push(rows[0]?.config);
      return ctx.data;
    };
    registerHook("afterRead", DOCS, record);

    try {
      await handlerOf(t).listEntries({
        collectionName: DOCS,
        overrideAccess: true,
      });

      expect(seen).toHaveLength(1);
      expect(typeof seen[0]).toBe("object");
      expect(seen[0]).toEqual({ mode: "live" });
    } finally {
      unregisterHook("afterRead", DOCS, record);
    }
  });

  it("afterRead on a read by id is handed a decoded JSON value too", async () => {
    const t = await boot();
    await t.nextly.create({
      collection: DOCS,
      data: { title: "d", config: { mode: "live" } },
    });
    const docId = await onlyId(t, DOCS);

    const seen: unknown[] = [];
    const record: HookHandler = ctx => {
      seen.push((ctx.data as Record<string, unknown>).config);
      return ctx.data;
    };
    registerHook("afterRead", DOCS, record);

    try {
      await handlerOf(t).getEntry({
        collectionName: DOCS,
        entryId: docId,
        overrideAccess: true,
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ mode: "live" });
    } finally {
      unregisterHook("afterRead", DOCS, record);
    }
  });

  it("a value a hook returns is not decoded a second time", async () => {
    // The decode cannot tell an already-decoded string from storage encoding,
    // so a second pass over what the hooks returned re-parses anything that
    // still looks like JSON. Running it once, before the hooks, is what makes
    // a hook's own value survive intact.
    const t = await boot();
    await t.nextly.create({
      collection: DOCS,
      data: { title: "d", config: { mode: "live" } },
    });

    const jsonLooking = '{"mode":"live"}';
    const setString: HookHandler = ctx => {
      const rows = ctx.data as Record<string, unknown>[];
      rows[0].config = jsonLooking;
      return ctx.data;
    };
    registerHook("afterRead", DOCS, setString);

    try {
      const listed = await handlerOf(t).listEntries({
        collectionName: DOCS,
        overrideAccess: true,
      });

      // The hook set a string. A second decode would hand the caller an object
      // the hook never produced.
      expect(listed.data!.docs[0].config).toBe(jsonLooking);
    } finally {
      unregisterHook("afterRead", DOCS, setString);
    }
  });
});
