/**
 * A change to what a role grants expires every cached content read.
 *
 * A cached public read holds what the Public role let a visitor read when it
 * ran, and taking a read away from Public writes no content, so no content
 * write expires it. Through the role screen's writer, against a real database:
 * the change flushes the tags every collection's and Single's writes flush,
 * leaves out one that opts out of revalidation, and an unchanged set flushes
 * nothing.
 *
 * SQLite needs no URL, and the flush is post-commit bookkeeping that no
 * dialect changes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import { PUBLIC_ROLE_SLUG } from "../services/public-role";

/** Every intent flushed to it, so a test sees exactly which tags expired. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("a change to a role's grants and the cached content reads (sqlite)", () => {
  let t: TestNextly | undefined;
  let spy: RecordingRevalidator;

  beforeEach(() => {
    spy = new RecordingRevalidator();
    // Registered first, so the harness keeps it rather than the no-op default.
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
  });

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  /**
   * Boots with posts anyone may read, a Single anyone may read, and a
   * collection that opts out of revalidation; boot grants Public both reads.
   */
  async function boot(): Promise<TestNextly> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    t = await createTestNextly({
      adapter,
      seedPublic: true,
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          access: { read: () => true },
          fields: [text({ name: "title" }), text({ name: "slug" })],
        }),
        defineCollection({
          slug: "unrevalidated",
          access: { read: () => true },
          revalidate: { disable: true },
          fields: [text({ name: "title" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "header",
          access: { read: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    return t;
  }

  /** The Public role's id and the ids of the permissions it holds. */
  async function publicRole(
    nextly: TestNextly
  ): Promise<{ id: string; held: Array<{ id: string; slug: string }> }> {
    const role = (await nextly.nextly.roles.find({ limit: 100 })).items.find(
      found => found.slug === PUBLIC_ROLE_SLUG
    );
    if (!role) throw new Error("boot made no Public role");
    const id = String(role.id);
    const held = (await nextly.nextly.roles.getPermissions({ id })).map(
      permission => ({ id: String(permission.id), slug: permission.slug })
    );
    return { id, held };
  }

  it("expires every collection's and Single's reads when Public loses a read", async () => {
    const nextly = await boot();
    const { id, held } = await publicRole(nextly);
    expect(held.map(permission => permission.slug)).toContain("read-posts");
    spy.flushed.length = 0;

    await nextly.nextly.roles.setPermissions({
      roleId: id,
      permissionIds: held
        .filter(permission => permission.slug !== "read-posts")
        .map(permission => permission.id),
    });

    expect(spy.tags).toEqual(
      expect.arrayContaining(["nextly:posts", "nextly:single:header"])
    );
    expect(spy.tags.some(tag => tag.includes("unrevalidated"))).toBe(false);
  });

  it("expires nothing when the role is set to what it already holds", async () => {
    const nextly = await boot();
    const { id, held } = await publicRole(nextly);
    spy.flushed.length = 0;

    await nextly.nextly.roles.setPermissions({
      roleId: id,
      permissionIds: held.map(permission => permission.id),
    });

    expect(spy.flushed).toEqual([]);
  });
});
