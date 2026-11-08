/**
 * The blog template's `bylineFromCreator` hook, run as written. A new post is
 * credited to the writer's own author profile, but only when nobody named one:
 * a byline an editor chose is never replaced, and an edit never re-credits a
 * post, whatever the profile lookup would answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bylineFromCreator } from "../../../../templates/blog/src/collections/Posts/hooks/byline-from-creator";

type Find = (args: Record<string, unknown>) => Promise<unknown>;

const WRITER = { id: "user-1" };

const run = (
  data: Record<string, unknown>,
  find: Find,
  operation: "create" | "update" = "create"
) =>
  bylineFromCreator({
    operation,
    data,
    user: WRITER,
    req: { nextly: { find } },
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

  it("saves the post uncredited, and logs, when the lookup fails", async () => {
    await expect(
      run({ title: "Hello" }, async () => {
        throw new Error("database unavailable");
      })
    ).resolves.toEqual({ title: "Hello" });
    expect(console.error).toHaveBeenCalled();
  });
});
