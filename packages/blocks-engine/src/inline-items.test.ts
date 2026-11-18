/**
 * The one spelling of an item's address, which the renderer marks, the editor
 * finds the element by and writes the array from.
 */
import { describe, expect, it } from "vitest";

import {
  isInlineItemsProp,
  itemOfPropName,
  itemPropName,
} from "./inline-items";

describe("an item's address", () => {
  it("reads back the prop and index it was written from", () => {
    expect(itemPropName("items", 0)).toBe("items.0");
    expect(itemOfPropName(itemPropName("items", 12))).toEqual({
      prop: "items",
      index: 12,
    });
  });

  it("is never an ordinary prop's name", () => {
    expect(itemOfPropName("items")).toBeNull();
    expect(itemOfPropName("text")).toBeNull();
  });

  it("addresses nothing for an index that is not plainly a number", () => {
    for (const name of ["items.01", "items.-1", "items.1.5", "items.x", ".1"]) {
      expect(itemOfPropName(name), name).toBeNull();
    }
  });
});

describe("isInlineItemsProp", () => {
  it("is an inline array of words", () => {
    expect(isInlineItemsProp({ type: "array", of: "text", inline: true })).toBe(
      true
    );
    expect(isInlineItemsProp({ type: "array", inline: true })).toBe(true);
  });

  it("is not an array left out of canvas editing, or one of records", () => {
    expect(isInlineItemsProp({ type: "array", of: "text" })).toBe(false);
    expect(
      isInlineItemsProp({ type: "array", of: "object", inline: true })
    ).toBe(false);
    expect(isInlineItemsProp({ type: "text", inline: true })).toBe(false);
    expect(isInlineItemsProp(undefined)).toBe(false);
  });
});
