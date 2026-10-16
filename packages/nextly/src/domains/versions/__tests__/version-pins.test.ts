/**
 * Version pin holders are registered, and a pin's slot is keyed by document,
 * holder and slot.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  registerVersionPinHolder,
  resetVersionPinHolders,
  versionPinHolderNames,
  versionPinKey,
  versionPins,
} from "../version-pins";

afterEach(() => {
  resetVersionPinHolders();
  registerVersionPinHolder({ name: "workflows", label: "Workflows" });
});

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

describe("version pin holders", () => {
  it("registers Workflows as the first holder", () => {
    expect(versionPinHolderNames()).toContain("workflows");
  });

  it("lets a feature register a holder and pin through it", () => {
    registerVersionPinHolder({ name: "release-review", label: "Releases" });
    expect(versionPinHolderNames()).toContain("release-review");
    expect(() => versionPins.holder("release-review")).not.toThrow();
  });

  it("refuses a name taken already, naming the feature that holds it", () => {
    expect(() =>
      registerVersionPinHolder({ name: "workflows", label: "Mine" })
    ).toThrow(/Workflows/);
  });

  it("accepts the same registration again, as a reloaded module makes it", () => {
    registerVersionPinHolder({ name: "release-review", label: "Releases" });
    expect(() =>
      registerVersionPinHolder({ name: "release-review", label: "Releases" })
    ).not.toThrow();
    expect(
      versionPinHolderNames().filter(name => name === "release-review")
    ).toHaveLength(1);
  });

  it("refuses a name that is not kebab-case or too long", () => {
    for (const name of ["Workflows", "work_flows", "", "-x", "a".repeat(65)]) {
      expect(() => registerVersionPinHolder({ name, label: "x" })).toThrow();
    }
  });

  it("refuses an unregistered holder, naming the registration call", () => {
    expect(() => versionPins.holder("nobody")).toThrow(
      /registerVersionPinHolder/
    );
  });
});

describe("versionPinKey", () => {
  it("is one key per document, holder and slot", () => {
    const key = versionPinKey(ref, "workflows", "approved:en");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(versionPinKey(ref, "workflows", "approved:en")).toBe(key);
    expect(versionPinKey(ref, "workflows", "approved:de")).not.toBe(key);
    expect(versionPinKey(ref, "release-review", "approved:en")).not.toBe(key);
    expect(
      versionPinKey({ ...ref, entryId: "e2" }, "workflows", "approved:en")
    ).not.toBe(key);
  });

  it("does not let a separator in one part pass for another", () => {
    // "a:b" + "c" and "a" + "b:c" join to the same text without escaping.
    expect(versionPinKey(ref, "a", "b:c")).not.toBe(
      versionPinKey({ ...ref, entryId: "e1:a" }, "b", "c")
    );
  });
});
