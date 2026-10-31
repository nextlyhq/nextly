/**
 * The tags one cached read carries: its own first, the caller's after, each
 * once, and no more than the 128 Next.js keeps. Past the limit Next.js drops
 * the LAST tags, so the order decides which survive: the collection's or
 * Single's own tag, which every write to it expires, must not be among them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as logger from "../../../observability/logger";
import { MAX_TAGS_PER_READ, readTags } from "../nextly-tags";

afterEach(() => {
  vi.restoreAllMocks();
});

/** `count` distinct caller tags. */
function extra(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `app:related-${i}`);
}

describe("readTags", () => {
  it("keeps its own tags first and every caller tag once, under the limit", () => {
    expect(
      readTags(["nextly:posts"], ["app:a", "nextly:posts", "app:a"])
    ).toEqual(["nextly:posts", "app:a"]);
  });

  it("caps at the limit with its own tags kept, however many the caller names", () => {
    const warn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);

    const own = ["nextly:posts", "nextly:posts:id:p1"];
    const tags = readTags(own, extra(300));

    expect(tags).toHaveLength(MAX_TAGS_PER_READ);
    expect(tags.slice(0, 2)).toEqual(own);
    expect(tags.at(-1)).toBe(`app:related-${MAX_TAGS_PER_READ - 3}`);

    // Reported once, not on every read of a busy page.
    readTags(own, extra(300));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "read-tags-dropped", named: 302 })
    );
  });

  it("keeps exactly the limit untouched", () => {
    const tags = readTags(["nextly:posts"], extra(MAX_TAGS_PER_READ - 1));
    expect(tags).toHaveLength(MAX_TAGS_PER_READ);
    expect(tags.at(-1)).toBe(`app:related-${MAX_TAGS_PER_READ - 2}`);
  });
});
