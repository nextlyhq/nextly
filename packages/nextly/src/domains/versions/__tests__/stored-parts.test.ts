/**
 * Reading back the parts a version row records. Each dialect hands the two
 * columns back in its own form: the language codes as JSON text or as a
 * parsed array, and the shared flag as a boolean or as 0/1. Every form must
 * read as the same parts, and a row recorded before the parts existed (NULL
 * in both) must read as unknown, never as "changed nothing".
 */
import { describe, expect, it } from "vitest";

import { partsFromStorage } from "../versions-repository";

describe("partsFromStorage", () => {
  it.each([
    ["JSON text and true", '["en","es"]', true],
    ["a parsed array and true", ["en", "es"], true],
    ["JSON text and 1", '["en","es"]', 1],
    ["a parsed array and 1", ["en", "es"], 1],
  ])("reads %s", (_form, locales, shared) => {
    expect(partsFromStorage(locales, shared)).toEqual({
      locales: ["en", "es"],
      shared: true,
    });
  });

  it.each([
    ["JSON text and false", "[]", false],
    ["a parsed array and false", [], false],
    ["JSON text and 0", "[]", 0],
    ["a parsed array and 0", [], 0],
  ])("reads %s as no part", (_form, locales, shared) => {
    expect(partsFromStorage(locales, shared)).toEqual({
      locales: [],
      shared: false,
    });
  });

  it("reads NULL in both as unknown", () => {
    expect(partsFromStorage(null, null)).toBeNull();
    expect(partsFromStorage(undefined, undefined)).toBeNull();
  });

  it.each([
    ["the languages NULL", null, true],
    ["the shared flag NULL", '["en"]', null],
    ["the languages not JSON", "en", true],
    ["the languages not a list", '{"en":true}', true],
    ["a language that is not a code", [1], true],
    ["the shared flag not a flag", ["en"], 2],
  ])("reads a row with %s as unknown", (_form, locales, shared) => {
    expect(partsFromStorage(locales, shared)).toBeNull();
  });
});
