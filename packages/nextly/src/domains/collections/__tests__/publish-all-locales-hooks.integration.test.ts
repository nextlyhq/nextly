/**
 * Publishing every locale runs the collection's `afterUpdate` hooks.
 *
 * This path already emitted its "updated" event and busted its cache tags, with
 * a comment saying it does so "matching a single-locale publish" — but a
 * single-locale publish also runs the declared hooks and this one ran none at
 * all. So a subscriber reached through a webhook and a hook declared in the same
 * codebase disagreed about whether the content had gone live.
 *
 * Post-commit, so the phase is side-effect only: a handler's return is ignored
 * and a throw is reported rather than raised, because the rows are durable by
 * the time it runs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slug to avoid colliding with a concurrently-running file.
const POSTS = "publishall_posts";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetHookRegistry();
  vi.restoreAllMocks();
});

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    publishAllLocales: (p: Record<string, unknown>) => Promise<{
      success: boolean;
    }>;
  };
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: { create: () => true, read: () => true, update: () => true },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
  });
  return current;
}

describe("publishAllLocales runs the collection's hooks", () => {
  it("fires afterUpdate for a publish that spans every locale", async () => {
    const t = await boot();
    const created = await t.nextly.create({
      collection: POSTS,
      data: { title: "hello" },
    });
    const id = String(created.item.id);

    // Registered AFTER the create so the create's own afterUpdate cannot be
    // mistaken for the publish's.
    let seen: unknown;
    let runs = 0;
    t.hooks.register("afterUpdate", POSTS, ctx => {
      runs++;
      seen = (ctx.data as Record<string, unknown> | undefined)?.id;
      return ctx.data;
    });

    const result = await handlerOf(t).publishAllLocales({
      collectionName: POSTS,
      entryId: id,
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
    expect(runs).toBe(1);
    // The published row, not an empty context: a hook that cannot tell WHICH
    // entry went live has not really been told anything.
    expect(seen).toBe(id);
  });

  it("reports a throwing hook instead of failing the committed publish", async () => {
    // The rows are durable before this phase runs, so raising here would tell a
    // caller its publish did not happen and invite a retry of one that did.
    const t = await boot();
    const created = await t.nextly.create({
      collection: POSTS,
      data: { title: "hello" },
    });
    const id = String(created.item.id);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    t.hooks.register("afterUpdate", POSTS, () => {
      throw new Error("publish observer failed");
    });

    const result = await handlerOf(t).publishAllLocales({
      collectionName: POSTS,
      entryId: id,
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
    // The failure still has to leave a trace, or a broken side effect vanishes.
    expect(logged).toHaveBeenCalled();
    // Read through `cause`: normalizeHookError wraps an untyped throw, so the
    // thrown text is on the wrapper rather than in its message.
    const reported = logged.mock.calls[0][1] as { cause?: unknown } | undefined;
    expect(String(reported?.cause ?? reported)).toContain(
      "publish observer failed"
    );
  });
});
