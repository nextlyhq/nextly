/**
 * Where a block is hidden, device by device, as Hide on, the panel's line and
 * a Layers row read it: the resolved state, and the widths each device covers.
 *
 * @module layer-row-actions.test
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { hideOnWrites } from "../../code-hints";

import {
  deviceStates,
  hiddenDeviceNames,
  listedNames,
} from "./layer-row-actions";

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
  ],
  container: [],
};

describe("deviceStates", () => {
  it("reads each device as a visitor gets it, through the cascade", () => {
    const states = deviceStates(
      { devices: { base: false, mobile: true } },
      SITE
    );
    expect(states.map(state => [state.label, state.hidden])).toEqual([
      ["Desktop", true],
      ["Tablet", true],
      ["Mobile", false],
    ]);
  });

  it("gives each device the widths it covers, desktop first", () => {
    expect(deviceStates(undefined, SITE).map(state => state.widths)).toEqual([
      { from: 1024, to: undefined },
      { from: 768, to: 1023 },
      { from: undefined, to: 767 },
    ]);
  });

  it("says what hiding each device writes, at its widths alone", () => {
    expect(
      deviceStates(undefined, SITE).map(state => hideOnWrites(state.widths))
    ).toEqual([
      "display: none at 1024px and wider",
      "display: none at 768–1023px",
      "display: none at 767px and narrower",
    ]);
  });

  it("is one device covering every width on a site with no breakpoints", () => {
    const [only] = deviceStates(undefined, undefined);
    expect(only?.widths).toEqual({ from: undefined, to: undefined });
    expect(hideOnWrites(only?.widths ?? {})).toBe("display: none");
  });
});

describe("hiddenDeviceNames", () => {
  it("names the devices hidden on, widest first, and none when shown everywhere", () => {
    expect(hiddenDeviceNames({ devices: { tablet: false } }, SITE)).toEqual([
      "Tablet",
      "Mobile",
    ]);
    expect(hiddenDeviceNames(undefined, SITE)).toEqual([]);
  });

  it("lists them as a sentence says them", () => {
    expect(listedNames(["Mobile"])).toBe("Mobile");
    expect(listedNames(["Tablet", "Mobile"])).toBe("Tablet and Mobile");
    expect(listedNames(["Desktop", "Tablet", "Mobile"])).toBe(
      "Desktop, Tablet and Mobile"
    );
  });
});
