/**
 * What each background size choice writes, and how a stored size reads back:
 * Cover and Fit stop the image repeating, Tile repeats it at its own size, and
 * any other stored size is "Custom" rather than a choice it isn't.
 */
import { describe, expect, it } from "vitest";

import {
  BACKGROUND_SIZE_CHOICES,
  backgroundSizeChoiceOf,
} from "./background-placement";

describe("the size choices", () => {
  it("writes cover without repeating for Cover", () => {
    expect(
      BACKGROUND_SIZE_CHOICES.find(c => c.label === "Cover")
    ).toMatchObject({ size: "cover", repeat: "no-repeat" });
  });

  it("writes contain without repeating for Fit, so the image is not tiled", () => {
    expect(BACKGROUND_SIZE_CHOICES.find(c => c.label === "Fit")).toMatchObject({
      size: "contain",
      repeat: "no-repeat",
    });
  });

  it("writes the image's own size, repeated, for Tile", () => {
    expect(BACKGROUND_SIZE_CHOICES.find(c => c.label === "Tile")).toMatchObject(
      {
        size: "auto",
        repeat: "repeat",
      }
    );
  });

  it("offers the three in order", () => {
    expect(BACKGROUND_SIZE_CHOICES.map(c => c.label)).toEqual([
      "Cover",
      "Fit",
      "Tile",
    ]);
  });
});

describe("reading a stored size back", () => {
  it.each([
    ["cover", "Cover"],
    ["contain", "Fit"],
    ["auto", "Tile"],
    [" Cover ", "Cover"],
  ])("reads %j as %s", (stored, label) => {
    expect(backgroundSizeChoiceOf(stored)).toMatchObject({ label });
  });

  it.each(["50%", "100px auto", "var(--site-size)", "cover, contain"])(
    "reads %j as Custom",
    stored => {
      expect(backgroundSizeChoiceOf(stored)).toBe("custom");
    }
  );

  it("reads nothing stored as no choice", () => {
    expect(backgroundSizeChoiceOf(undefined)).toBeUndefined();
  });

  it("reads a value that isn't text as Custom", () => {
    expect(backgroundSizeChoiceOf({ $token: "size" })).toBe("custom");
  });
});
