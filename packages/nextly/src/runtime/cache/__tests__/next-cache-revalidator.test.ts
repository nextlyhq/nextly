/**
 * The Next cache adapter maps intents to `next/cache` calls with a fake module
 * (no real Next runtime), no-ops when the module is absent, and never throws.
 */
import { describe, expect, it, vi } from "vitest";

import type { RevalidationIntent } from "../../../revalidation/types";
import {
  NextCacheRevalidator,
  type NextCacheModule,
} from "../next-cache-revalidator";

function fakeNextCache() {
  return {
    revalidateTag:
      vi.fn<(tag: string, profile?: string | { expire?: number }) => void>(),
    revalidatePath: vi.fn<(path: string, type?: "page" | "layout") => void>(),
  } satisfies NextCacheModule;
}

describe("NextCacheRevalidator", () => {
  it("busts every tag in every intent via revalidateTag", () => {
    const next = fakeNextCache();
    const revalidator = new NextCacheRevalidator(() => next);
    const intents: RevalidationIntent[] = [
      { tags: ["nextly:posts", "nextly:posts:id:1"] },
      { tags: ["nextly:single:header"] },
    ];

    revalidator.flush(intents);

    expect(next.revalidateTag).toHaveBeenCalledTimes(3);
    // The { expire: 0 } profile expires immediately (an unpublish/delete stops
    // being served on the next request) and silences the Next 16 single-arg
    // deprecation warning; ignored on Next 14/15.
    const immediate = { expire: 0 };
    expect(next.revalidateTag).toHaveBeenCalledWith("nextly:posts", immediate);
    expect(next.revalidateTag).toHaveBeenCalledWith(
      "nextly:posts:id:1",
      immediate
    );
    expect(next.revalidateTag).toHaveBeenCalledWith(
      "nextly:single:header",
      immediate
    );
  });

  it("revalidates path targets with their type", () => {
    const next = fakeNextCache();
    const revalidator = new NextCacheRevalidator(() => next);

    revalidator.flush([
      {
        tags: ["nextly:posts:id:1"],
        paths: [{ path: "/blog/[slug]", type: "page" }, { path: "/blog/old" }],
      },
    ]);

    expect(next.revalidatePath).toHaveBeenCalledWith("/blog/[slug]", "page");
    expect(next.revalidatePath).toHaveBeenCalledWith("/blog/old", undefined);
  });

  it("no-ops when next/cache is unavailable", () => {
    const revalidator = new NextCacheRevalidator(() => null);
    // Must not throw when there is no Next cache to talk to.
    expect(() => revalidator.flush([{ tags: ["nextly:posts"] }])).not.toThrow();
  });

  it("swallows a throwing next/cache so a committed write never errors", () => {
    const next = fakeNextCache();
    // revalidateTag throws outside a request scope (a CLI/background write).
    next.revalidateTag.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    const revalidator = new NextCacheRevalidator(() => next);

    expect(() => revalidator.flush([{ tags: ["a", "b"] }])).not.toThrow();
    // One throwing tag does not stop the rest.
    expect(next.revalidateTag).toHaveBeenCalledTimes(2);
  });
});
