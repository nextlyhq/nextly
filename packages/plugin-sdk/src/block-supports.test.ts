import { allSupports } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockSupportKeys } from "@nextlyhq/plugin-sdk/blocks";

/**
 * The keys the authoring type accepts, as a value so they can be compared with
 * what the registry accepts. Typed rather than hand-listed: a key added to the
 * interface and forgotten here fails to compile.
 */
const AUTHORING_KEYS: Record<keyof BlockSupportKeys, true> = {
  spacing: true,
  layout: true,
  dimensions: true,
  typography: true,
  color: true,
  background: true,
  border: true,
  shadow: true,
  effects: true,
  position: true,
  container: true,
  customCss: true,
};

describe("the authoring vocabulary matches the registry's", () => {
  it("accepts exactly the supports registration accepts", () => {
    // Two lists in two packages, and neither can move without the other. A
    // narrower authoring type refuses a capability the registry grants, so a
    // block that would have worked will not compile; a wider one lets a typo
    // through to boot, which is the thing the strict type exists to prevent.
    expect(Object.keys(AUTHORING_KEYS).sort()).toEqual(
      allSupports()
        .map(support => support.key)
        .sort()
    );
  });
});
