// What a read hook is handed, and where a target's own hooks reach.
//
// Two halves of one promise: a hook is documented against the value the field
// was configured with, and a related row is documented as getting the target
// collection's own treatment. Both were true only for a direct read.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, json, relationship, text } from "../../../config";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const DOCS = "finalval_docs";
const AUTHORS = "finalval_authors";
const POSTS = "finalval_posts";

// What the related-row field hook was handed. The hook is declared inside the
// fixture, so the assertion reads it from here.
const profileHookSaw: unknown[] = [];

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
      defineCollection({
        slug: AUTHORS,
        fields: [
          text({ name: "name" }),
          // The transforming half of a field's read protections: the value the
          // target's own endpoint returns is the masked one.
          text({
            name: "secret",
            hooks: { afterRead: [() => "REDACTED"] },
          }),
          // A hook doing ordinary object work. Handed the storage encoding it
          // throws, and the relationship fetch reads the failure as an absent
          // row.
          json({
            name: "profile",
            hooks: {
              afterRead: [
                ({ value }) => {
                  // A row that has no profile at all is not what this is
                  // about, so it passes through.
                  if (value === null || value === undefined) return value;
                  // Ordinary object work. Handed the storage encoding, `tags`
                  // is undefined and this throws -- and the relationship fetch
                  // reads that failure as an absent row.
                  const v = value as { tags: string[] };
                  profileHookSaw.push(v.tags.length);
                  return value;
                },
              ],
            },
          }),
        ],
      }),
      defineCollection({
        slug: POSTS,
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: AUTHORS }),
        ],
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

  it("a target's field afterRead applies to a row reached through a relationship", async () => {
    // The control below shows the target masks the field on its own endpoint.
    // Reaching the same row through a relationship must not be the way around
    // that: expansion may be stricter than the target's endpoint, never looser.
    const t = await boot();
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "a", secret: "TOP_SECRET" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    // Control: the target's own endpoint masks it.
    const direct = await handlerOf(t).getEntry({
      collectionName: AUTHORS,
      entryId: authorId,
      overrideAccess: true,
    });
    expect(direct.data!.secret).toBe("REDACTED");

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 1,
    });

    const related = expanded.data!.author as Record<string, unknown>;
    expect(related).toBeTruthy();
    expect(related.secret).toBe("REDACTED");
  });
  it("a target's field hook is handed decoded values through a relationship", async () => {
    // Related rows are read straight from the table, so on SQLite their JSON
    // columns are strings. A hook doing object work throws on one, and the
    // relationship fetch reports that failure as an absent row -- the relation
    // disappears rather than erroring.
    profileHookSaw.length = 0;
    const t = await boot();
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "a", secret: "s", profile: { tags: ["x", "y"] } },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "p", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    // The reads above went through the DIRECT path, which decodes and runs the
    // same hook. Cleared here so what follows can only have come from the
    // expansion.
    profileHookSaw.length = 0;

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 1,
    });

    // The relation survived, and the hook read the tags rather than choking on
    // a string. The row itself keeps its stored encoding on the way out, which
    // is why this asserts what the hook was handed.
    expect(expanded.data!.author).toBeTruthy();
    expect(profileHookSaw).toContain(2);
  });

  it("related field hooks stay out of an evidence-gathering read", async () => {
    // A caller clearing `enforceFieldAccess` is assembling the row a
    // document-dependent access rule is judged on, and wants it unredacted. A
    // masking hook running there would rewrite the evidence before the rule
    // sees it, and would fire its side effects for a request not yet allowed.
    const t = await boot();
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "a", secret: "TOP_SECRET", profile: { tags: [] } },
    });
    const authorId = await onlyId(t, AUTHORS);

    const service = t.getService("relationshipService") as unknown as {
      batchFetchRelatedEntries: (
        target: string,
        ids: string[],
        field: Record<string, unknown>,
        access: Record<string, unknown>
      ) => Promise<Map<string, Record<string, unknown>>>;
    };
    const field = { name: "author", type: "relationship", relationTo: AUTHORS };

    const evidence = await service.batchFetchRelatedEntries(
      AUTHORS,
      [authorId],
      field,
      { enforceFieldAccess: false, overrideAccess: true }
    );
    expect(evidence.get(authorId)!.secret).toBe("TOP_SECRET");

    // The control: the same fetch for a real read does mask it, so the
    // difference is the flag and not a hook that never ran.
    const served = await service.batchFetchRelatedEntries(
      AUTHORS,
      [authorId],
      field,
      { enforceFieldAccess: true, overrideAccess: true }
    );
    expect(served.get(authorId)!.secret).toBe("REDACTED");
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
