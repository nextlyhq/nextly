/**
 * The versions this CLI scaffolds sit inside the ranges it holds an existing
 * app to. That every Nextly package declares those same ranges as its peers is
 * checked from the manifests by `scripts/supported-peer-ranges.test.mjs`.
 */
import { describe, expect, it } from "vitest";

import {
  REVIEWED_VERSIONS,
  SUPPORTED_RANGES,
  scaffoldRange,
} from "../supported-versions";
import { satisfiesRange } from "../utils/version-range";

describe("the supported Next.js and React ranges", () => {
  it("scaffolds a version inside each supported range", () => {
    expect(satisfiesRange(REVIEWED_VERSIONS.next, SUPPORTED_RANGES.next)).toBe(
      true
    );
    expect(
      satisfiesRange(REVIEWED_VERSIONS.react, SUPPORTED_RANGES.react)
    ).toBe(true);
    expect(
      satisfiesRange(
        REVIEWED_VERSIONS["react-dom"],
        SUPPORTED_RANGES["react-dom"]
      )
    ).toBe(true);
    // eslint-config-next ships with Next.js, release for release.
    expect(REVIEWED_VERSIONS["eslint-config-next"]).toBe(
      REVIEWED_VERSIONS.next
    );
  });

  it("derives the scaffold range from the reviewed version", () => {
    expect(scaffoldRange("next")).toBe(`~${REVIEWED_VERSIONS.next}`);
  });
});
