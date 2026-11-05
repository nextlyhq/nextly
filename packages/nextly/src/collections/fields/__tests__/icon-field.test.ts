/**
 * The icon field's config layer: the factory every code-first config writes
 * through, the guard that narrows to it, the accepted-type list boot reads,
 * and the id shape the config, zod and write-path validators share.
 */
import { describe, expect, it } from "vitest";

import { email, icon } from "../helpers";
import { isDataField, isEmailField, isIconField } from "../guards";
import { ALL_FIELD_TYPES, DATA_FIELD_TYPES } from "../types";
import {
  ICON_ID_MAX_LENGTH,
  ICON_ID_PATTERN,
  isIconIdShape,
} from "../types/icon";

describe("icon()", () => {
  it("returns the config it was given, typed as an icon field", () => {
    const field = icon({
      name: "badge",
      label: "Badge",
      defaultValue: "lucide:star",
    });
    expect(field).toEqual({
      name: "badge",
      label: "Badge",
      defaultValue: "lucide:star",
      type: "icon",
    });
  });
});

describe("isIconField", () => {
  it("narrows an icon field and nothing else", () => {
    expect(isIconField(icon({ name: "badge" }))).toBe(true);
    expect(isIconField(email({ name: "contact" }))).toBe(false);
    expect(isEmailField(icon({ name: "badge" }))).toBe(false);
  });

  it("is a data field, accepted by the list the boot gate reads", () => {
    expect(isDataField(icon({ name: "badge" }))).toBe(true);
    expect(DATA_FIELD_TYPES).toContain("icon");
    expect(ALL_FIELD_TYPES).toContain("icon");
  });
});

describe("icon id shape", () => {
  it("accepts <set>:<name> in lowercase letters, digits and hyphens", () => {
    for (const id of ["lucide:star", "lucide:arrow-up-right", "set-2:icon-3"]) {
      expect(isIconIdShape(id), id).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      "Star",
      "lucide:",
      ":star",
      "lucide:Star",
      "lucide star",
      "lucide:star:filled",
      "",
      42,
      null,
      undefined,
    ]) {
      expect(isIconIdShape(bad), String(bad)).toBe(false);
    }
  });

  it("accepts an id as long as its column and refuses one character more", () => {
    const longest = `lucide:${"a".repeat(ICON_ID_MAX_LENGTH - "lucide:".length)}`;
    expect(longest).toHaveLength(255);
    expect(isIconIdShape(longest)).toBe(true);
    expect(isIconIdShape(`${longest}a`)).toBe(false);
  });

  it("is anchored, so an id cannot carry trailing text into SQL or markup", () => {
    expect(ICON_ID_PATTERN.test("lucide:star'; --")).toBe(false);
  });
});
