/**
 * `pluginUserField()` runs during config evaluation, so its marker has to be a
 * value and not only a type. A type-only assertion never executes the helper
 * and so cannot tell the two apart.
 */
import { describe, expect, it } from "vitest";

import { pluginUserField, pluginUserFieldBrand } from "../types";

describe("pluginUserField", () => {
  it("returns the declaration carrying the marker", () => {
    const field = pluginUserField({ name: "score", type: "star-rating" });

    expect(field.name).toBe("score");
    expect(field.type).toBe("star-rating");
    expect(field[pluginUserFieldBrand]).toBe(true);
  });

  it("keeps the declaration it was given", () => {
    const field = pluginUserField({
      name: "rating",
      type: "star-rating",
      required: true,
      pluginOptions: { ratingScale: { max: 5 } },
    });

    expect(field.required).toBe(true);
    expect(field.pluginOptions).toEqual({ ratingScale: { max: 5 } });
  });

  it("does not copy its input", () => {
    // The declaration a config wrote is not the helper's to mutate.
    const input = { name: "score", type: "star-rating" };
    pluginUserField(input);

    expect(Object.getOwnPropertySymbols(input)).toHaveLength(0);
  });

  it("serializes and enumerates as the declaration was written", () => {
    const field = pluginUserField({ name: "score", type: "star-rating" });

    // A symbol key is invisible to both, so nothing reading the field as data
    // sees the marker.
    expect(Object.keys(field)).toEqual(["name", "type"]);
    expect(JSON.parse(JSON.stringify(field))).toEqual({
      name: "score",
      type: "star-rating",
    });
  });
});
