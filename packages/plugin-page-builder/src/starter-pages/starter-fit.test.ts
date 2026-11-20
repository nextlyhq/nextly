/**
 * Why a site can't hold a starter page, in the words both pickers show and a
 * refused create says: what it lacks first, then the first page limit it
 * exceeds, with how much it needs and what the site allows.
 *
 * @module starter-pages/starter-fit.test
 */
import { createBlockRegistry, DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import {
  starterFit,
  starterMisfitReason,
  starterMisfitSentence,
} from "./starter-fit";
import { fixtureStarter } from "./starter-pages.fixture";

const blocks = createBlockRegistry();
blocks.register(coreBlocks, { source: "@nextlyhq/plugin-page-builder" });

/** The reason a site with `limits` gives for the fixture starter, if any. */
function reason(limits: Partial<typeof DEFAULT_LIMITS>): string | undefined {
  const misfit = starterFit(
    fixtureStarter(),
    { blocks },
    {
      ...DEFAULT_LIMITS,
      ...limits,
    }
  );
  return misfit === undefined ? undefined : starterMisfitReason(misfit);
}

describe("whether a site can hold a starter page", () => {
  it("holds one within its limits, and says nothing", () => {
    expect(reason({})).toBeUndefined();
  });

  it("names how deep it nests and how deep the site allows", () => {
    expect(reason({ maxDepth: 1 })).toMatch(
      /^Needs \d+ levels of nesting; this site allows 1\.$/
    );
  });

  it("names how many blocks it has and how many the site allows", () => {
    expect(reason({ maxNodes: 2 })).toMatch(
      /^Has \d+ blocks; this site allows 2\.$/
    );
  });

  it("names its size and the site's, in kilobytes", () => {
    expect(reason({ maxBytes: 100 })).toMatch(
      /^Is \d+ KB; this site allows 1 KB\.$/
    );
  });

  it("names a block the site doesn't have by the name an author knows it by", () => {
    const fewer = createBlockRegistry();
    fewer.register(
      coreBlocks.filter(block => block.name !== "core/button"),
      { source: "@nextlyhq/plugin-page-builder" }
    );
    const misfit = starterFit(fixtureStarter(), { blocks: fewer });
    expect(misfit && starterMisfitReason(misfit)).toBe(
      "Uses the Button block, which this site doesn't have."
    );
  });

  it("refuses a page made from it in the same words, naming the starter", () => {
    const misfit = starterFit(
      fixtureStarter(),
      { blocks },
      {
        ...DEFAULT_LIMITS,
        maxNodes: 2,
      }
    );
    if (misfit === undefined) throw new Error("expected a misfit");
    expect(starterMisfitSentence(fixtureStarter(), misfit)).toBe(
      `The starter page "${fixtureStarter().label}" isn't available on this site. ${starterMisfitReason(misfit)}`
    );
  });
});
