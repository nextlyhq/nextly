/**
 * The blog template's `bylineFromCreator` hooks, run as written. A new post is
 * credited to the writer's own author profile, but only when nobody named one:
 * a byline an editor chose is never replaced, and an edit never re-credits a
 * post, whatever the profile lookup would answer. The profile is read from the
 * authors collection the hooks were made for.
 *
 * Inside its caller's own transaction the write is not looked up there: the
 * credit waits until that transaction commits, and is then read and set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bylineFromCreator } from "../../../../templates/blog/src/collections/Posts/hooks/byline-from-creator";

type Find = (args: Record<string, unknown>) => Promise<unknown>;

const WRITER = { id: "user-1" };

const credit = bylineFromCreator({ authors: "authors" });

const run = (
  data: Record<string, unknown>,
  find: Find,
  operation: "create" | "update" = "create"
) =>
  credit.beforeChange({
    operation,
    data,
    user: WRITER,
    req: { nextly: { find } },
    context: {},
  } as never);

/** A lookup that finds the writer's profile, `author-1`. */
const profileFound = () =>
  vi.fn<Find>(async () => ({ items: [{ id: "author-1" }] }));

describe("blog template: bylineFromCreator", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("credits a new post with no byline to the writer's profile", async () => {
    const find = profileFound();
    await expect(run({ title: "Hello" }, find)).resolves.toEqual({
      title: "Hello",
      byline: "author-1",
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "authors",
        where: { account: { equals: "user-1" } },
      })
    );
  });

  it("treats an empty or null byline as none", async () => {
    for (const byline of ["", null]) {
      await expect(run({ byline }, profileFound())).resolves.toEqual({
        byline: "author-1",
      });
    }
  });

  it("never replaces a byline an editor chose, and does not look one up", async () => {
    const find = profileFound();
    await expect(run({ byline: "author-9" }, find)).resolves.toEqual({
      byline: "author-9",
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("never touches the byline on an edit, set or empty", async () => {
    const find = profileFound();
    await expect(run({ byline: "author-9" }, find, "update")).resolves.toEqual({
      byline: "author-9",
    });
    await expect(run({ title: "Edited" }, find, "update")).resolves.toEqual({
      title: "Edited",
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("leaves the byline empty when the writer has no profile", async () => {
    await expect(
      run({ title: "Hello" }, async () => ({ items: [] }))
    ).resolves.toEqual({ title: "Hello" });
  });

  it("reads the profile from the authors collection it was made for", async () => {
    const find = profileFound();
    await bylineFromCreator({ authors: "journal-authors" }).beforeChange({
      operation: "create",
      data: {},
      user: WRITER,
      req: { nextly: { find } },
      context: {},
    } as never);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "journal-authors" })
    );
  });

  it("saves the post uncredited, and logs, when the lookup fails", async () => {
    await expect(
      run({ title: "Hello" }, async () => {
        throw new Error("database unavailable");
      })
    ).resolves.toEqual({ title: "Hello" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("blog template: bylineFromCreator inside its caller's transaction", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A create made in a caller's transaction, through both hooks. */
  async function inTransaction(stored: Record<string, unknown>) {
    const find = profileFound();
    const findByID = vi.fn(async () => stored);
    const update = vi.fn(async () => ({}));
    const effects: (() => unknown)[] = [];
    const context: Record<string, unknown> = {};
    const nextly = { find, findByID, update };
    const before = await credit.beforeChange({
      operation: "create",
      data: { title: "Hello" },
      user: WRITER,
      req: { nextly },
      context,
      executor: {},
    } as never);
    await credit.afterChange({
      operation: "create",
      collection: "posts",
      data: { id: "post-1", title: "Hello" },
      user: WRITER,
      req: { nextly },
      context,
      afterCommit: async (effect: () => unknown) => {
        effects.push(effect);
      },
    } as never);
    return { before, find, update, effects };
  }

  it("reads nothing on the transaction's way, and credits the post once it commits", async () => {
    const { before, find, update, effects } = await inTransaction({
      id: "post-1",
      byline: null,
      _rev: "1",
    });
    expect(before).toEqual({ title: "Hello" });
    // Nothing read or written until the transaction commits.
    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(effects).toHaveLength(1);

    await effects[0]();
    expect(update).toHaveBeenCalledWith({
      collection: "posts",
      id: "post-1",
      data: { byline: "author-1", _rev: "1" },
    });
  });

  it("leaves a byline the post was given by then", async () => {
    const { update, effects } = await inTransaction({
      id: "post-1",
      byline: "author-9",
      _rev: "2",
    });
    await effects[0]();
    expect(update).not.toHaveBeenCalled();
  });

  it("waits for nothing when the post was credited before it was written", async () => {
    const effects: unknown[] = [];
    await credit.afterChange({
      operation: "create",
      collection: "posts",
      data: { id: "post-1" },
      user: WRITER,
      req: { nextly: {} },
      context: {},
      afterCommit: async (effect: unknown) => {
        effects.push(effect);
      },
    } as never);
    expect(effects).toEqual([]);
  });
});
