// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { measureTopBar, topBarCrowded } from "./top-bar-room";

/**
 * When the top bar is crowded: its controls, the title at its floor and
 * every word drawn, need more than its room. The browser test
 * (`builder-chrome-fit.spec.ts`) holds the order on a real bar; these hold
 * the arithmetic, and what a bar with no layout reads as.
 *
 * @module top-bar-room.test
 */
describe("topBarCrowded", () => {
  it("is not crowded while the controls and every word fit", () => {
    expect(
      topBarCrowded({ available: 1000, controls: 900, gaps: 16, words: 0 })
    ).toBe(false);
  });

  it("is crowded once the controls need more than the room", () => {
    expect(
      topBarCrowded({ available: 1000, controls: 990, gaps: 16, words: 0 })
    ).toBe(true);
  });

  it("stays crowded while the words it hid would not fit back", () => {
    // Hidden, the bar fits; drawn again, it would not, so it holds still
    // rather than drawing and hiding the words in turn.
    expect(
      topBarCrowded({ available: 1000, controls: 940, gaps: 16, words: 55 })
    ).toBe(true);
  });

  it("is no longer crowded once the words fit back", () => {
    expect(
      topBarCrowded({ available: 1000, controls: 900, gaps: 16, words: 55 })
    ).toBe(false);
  });

  it("reads a width that rounds to the room as fitting", () => {
    expect(
      topBarCrowded({ available: 1000, controls: 984.4, gaps: 16, words: 0 })
    ).toBe(false);
  });
});

describe("measureTopBar", () => {
  it("counts a hidden word's whole width, which a clipped word still reports", () => {
    const bar = document.createElement("header");
    const end = document.createElement("div");
    const word = document.createElement("span");
    word.setAttribute("data-topbar-word", "");
    word.style.position = "absolute";
    Object.defineProperty(word, "scrollWidth", { value: 47 });
    end.append(word);
    bar.append(end);
    document.body.append(bar);
    expect(measureTopBar(bar).words).toBe(47);
    bar.remove();
  });

  it("leaves out a word that is drawn, whose width the controls already hold", () => {
    const bar = document.createElement("header");
    const end = document.createElement("div");
    const word = document.createElement("span");
    word.setAttribute("data-topbar-word", "");
    Object.defineProperty(word, "scrollWidth", { value: 47 });
    end.append(word);
    bar.append(end);
    document.body.append(bar);
    expect(measureTopBar(bar).words).toBe(0);
    bar.remove();
  });
});
