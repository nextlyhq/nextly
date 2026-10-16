/**
 * The blog template's `requireFeaturedAlt` hook, run as written. A featured
 * image must have alt text, and an image the hook could not check is refused
 * like one without it: passing it would let a post publish past the rule
 * whenever the media read fails. `nextly` resolves to the suite's stub, whose
 * `NextlyError` carries the real one's `code` and `publicData`, so the refusal
 * is checked in the shape the admin reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireFeaturedAlt } from "../../../../templates/blog/src/collections/Posts/hooks/require-featured-alt";

/** The rejection a writer sees: a validation failure on the featured image. */
const refusal = (message: string) =>
  expect.objectContaining({
    code: "VALIDATION_ERROR",
    publicData: {
      errors: [
        expect.objectContaining({
          path: "featuredImage",
          message: expect.stringContaining(message),
        }),
      ],
    },
  });

type FindByID = (args: { id: string }) => Promise<unknown>;
const run = (findByID: FindByID | null) =>
  requireFeaturedAlt({
    data: { featuredImage: "m1" },
    req: findByID ? { nextly: { media: { findByID } } } : {},
  } as never);

describe("blog template: requireFeaturedAlt", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("lets a featured image with alt text through", async () => {
    await expect(
      run(async () => ({ id: "m1", altText: "A lake at dawn" }))
    ).resolves.toEqual({ featuredImage: "m1" });
  });

  it("refuses a featured image without alt text", async () => {
    await expect(
      run(async () => ({ id: "m1", altText: null }))
    ).rejects.toEqual(refusal("Featured image must have alt text"));
  });

  it("refuses the save, and logs, when the media cannot be read", async () => {
    await expect(
      run(async () => {
        throw new Error("database unavailable");
      })
    ).rejects.toEqual(refusal("could not be checked for alt text"));
    expect(console.error).toHaveBeenCalled();
  });

  it("refuses a featured image that no longer exists", async () => {
    await expect(run(async () => null)).rejects.toEqual(
      refusal("no longer exists")
    );
  });

  it("reads the image through the media API, by its id", async () => {
    const findByID = vi.fn(async () => ({ id: "m1", altText: "alt" }));
    await run(findByID);
    expect(findByID).toHaveBeenCalledWith({ id: "m1" });
  });

  it("skips the check, with a warning, where the Direct API is absent", async () => {
    await expect(run(null)).resolves.toEqual({ featuredImage: "m1" });
    expect(console.warn).toHaveBeenCalled();
  });
});
