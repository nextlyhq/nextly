/**
 * Version pin holders are registered, and a pin's slot is keyed by document,
 * holder and slot.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { beforeEach, describe, expect, it } from "vitest";

import {
  registerVersionPinHolder,
  resetVersionPinHolders,
  versionPinHolderNames,
  versionPinKey,
  versionPins,
} from "../version-pins";

beforeEach(() => {
  resetVersionPinHolders();
  registerVersionPinHolder({ name: "workflows", label: "Workflows" });
});

const ref = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

describe("version pin holders", () => {
  it("hands a feature the handle it pins through when it registers", () => {
    const handle = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    expect(versionPinHolderNames()).toContain("release-review");
    expect(typeof handle.pin).toBe("function");
    expect(typeof handle.release).toBe("function");
    expect(typeof handle.releaseAll).toBe("function");
  });

  it("offers no way to reach a holder's handle by its name", () => {
    expect(Object.keys(versionPins)).toEqual(["list"]);
  });

  it("refuses a name taken already, naming the feature that holds it", () => {
    expect(() =>
      registerVersionPinHolder({ name: "workflows", label: "Mine" })
    ).toThrow(/Workflows/);
  });

  it("returns the same handle for the same registration, as a reloaded module makes it", () => {
    const first = registerVersionPinHolder({
      name: "release-review",
      label: "Releases",
    });
    expect(
      registerVersionPinHolder({ name: "release-review", label: "Releases" })
    ).toBe(first);
    expect(
      versionPinHolderNames().filter(name => name === "release-review")
    ).toHaveLength(1);
  });

  it("refuses a name that is not kebab-case or too long", () => {
    for (const name of ["Workflows", "work_flows", "", "-x", "a".repeat(65)]) {
      expect(() => registerVersionPinHolder({ name, label: "x" })).toThrow();
    }
  });

  // Refused before any database work: the stub transaction throws on any use,
  // so a refusal that reached the database would fail with its message.
  const noDatabase = new Proxy(
    {},
    {
      get() {
        throw new Error("no database work expected");
      },
    }
  ) as TransactionContext;

  it("refuses a slot that is empty or too long for its column", async () => {
    const handle = registerVersionPinHolder({ name: "slots", label: "Slots" });
    for (const slot of ["", "x".repeat(192)]) {
      await expect(
        handle.pin(noDatabase, { ref, slot, versionNo: 1 })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        handle.release(noDatabase, { ref, slot })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("refuses a version number that is not a positive integer", async () => {
    const handle = registerVersionPinHolder({
      name: "numbers",
      label: "Numbers",
    });
    for (const versionNo of [0, -1, 1.5, Number.NaN]) {
      await expect(
        handle.pin(noDatabase, { ref, slot: "approved", versionNo })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
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
