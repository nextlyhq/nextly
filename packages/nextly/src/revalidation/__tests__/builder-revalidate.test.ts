/**
 * The one mapping every Builder write path uses for the cache-revalidation
 * switch. Revalidation is on by default, so the boolean is inverted from the
 * versions switch: off is the only value that persists a config.
 */
import { describe, expect, it } from "vitest";

import { resolveBuilderRevalidate } from "../builder-revalidate";

describe("resolveBuilderRevalidate", () => {
  it("resolves off to the disable config", () => {
    // The write path reads `revalidate.disable`, so turning the switch off has
    // to land a config that sets it — a null column would still bust tags.
    expect(resolveBuilderRevalidate(false)).toEqual({ disable: true });
  });

  it("resolves on and absent to no config at all", () => {
    // On is the default: null means the write path computes the standard
    // nextly:* tags with no override. Absent is treated the same as on.
    expect(resolveBuilderRevalidate(true)).toBeNull();
    expect(resolveBuilderRevalidate(undefined)).toBeNull();
  });
});
