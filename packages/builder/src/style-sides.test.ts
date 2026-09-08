import { STYLE_CATALOG } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { styleControlsFor } from "./style-controls";
import { logicalSideGroup, LOGICAL_SIDES } from "./style-sides";

/** One catalog entry, as the array actually stores them. */
interface CatalogEntry {
  readonly property: string;
  readonly shape: Record<string, unknown>;
}

const entry = (property: string): CatalogEntry => {
  const found = (STYLE_CATALOG as unknown as readonly CatalogEntry[]).find(
    candidate => candidate.property === property
  );
  if (found === undefined) throw new Error(`no catalog entry for ${property}`);
  return found;
};

/** The controls the real catalog produces for a property. */
const controlsOf = (property: string) =>
  styleControlsFor(entry(property) as never).controls;

describe("logicalSideGroup", () => {
  /*
   * The link to the SOURCE, and the reason the side names may be written here
   * at all. `logicalSides()` in the engine's catalog decides what a per-side
   * property expands into; this asserts the panel's list still describes it.
   * Rename a side there and this fails, rather than the box quietly becoming
   * four stacked rows again with nothing to say so.
   */
  it("groups the sides the catalog actually produces for padding", () => {
    const group = logicalSideGroup(controlsOf("padding"));

    expect(group).not.toBeUndefined();
    expect(group?.map(control => control.path[0])).toEqual([...LOGICAL_SIDES]);
  });

  it("groups margin the same way", () => {
    expect(logicalSideGroup(controlsOf("margin"))).not.toBeUndefined();
  });

  /*
   * A property that is not per-side must not be rearranged into a box. The
   * grouping is what licenses hiding the labels visually, so a false positive
   * would leave a set of controls positioned as sides they are not.
   */
  it("declines a property with a single control", () => {
    expect(logicalSideGroup(controlsOf("display"))).toBeUndefined();
  });

  it("declines a group of four that are not the sides", () => {
    const four = LOGICAL_SIDES.map((_, index) => ({
      path: [`other${index}`],
    })) as never;

    expect(logicalSideGroup(four)).toBeUndefined();
  });

  /*
   * The case the name check alone does not catch, and the reason the count is
   * checked as well as the names.
   *
   * A property offering the four sides AND something else would otherwise be
   * grouped, and the box has exactly four places — so the fifth control would
   * be dropped from the panel with nothing to say it had gone. The names alone
   * cannot refuse that set, which is why the count is checked as well.
   */
  it("declines a set that holds the four sides and something more", () => {
    const extra = [
      ...LOGICAL_SIDES.map(side => ({ path: [side] })),
      { path: ["somethingElse"] },
    ] as never;

    expect(logicalSideGroup(extra)).toBeUndefined();
  });

  it("declines when a side is missing, rather than drawing three of four", () => {
    const three = LOGICAL_SIDES.slice(0, 3).map(side => ({
      path: [side],
    })) as never;

    expect(logicalSideGroup(three)).toBeUndefined();
  });

  /*
   * Returned in box order rather than the order the walk produced, because the
   * order IS the layout: the caller places them into a grid by index.
   */
  it("returns the sides in the order the box draws them", () => {
    const scrambled = [...LOGICAL_SIDES]
      .reverse()
      .map(side => ({ path: [side] })) as never;

    expect(logicalSideGroup(scrambled)?.map(c => c.path[0])).toEqual([
      ...LOGICAL_SIDES,
    ]);
  });
});
