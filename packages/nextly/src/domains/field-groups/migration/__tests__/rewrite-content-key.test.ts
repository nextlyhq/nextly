import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../manifest";
import { rewriteContentKey } from "../rewrite-content-key";

const FROM = STORAGE_FORMAT.wireTypeKey;
const TO = MIGRATION_TARGET.wireTypeKey;

function up(document: unknown): unknown {
  return rewriteContentKey(document, FROM, TO);
}

describe("rewriting the wire type key inside stored content", () => {
  it("renames the key on a dynamic-zone instance", () => {
    expect(up({ _componentType: "hero", title: "Hi" })).toEqual({
      _fieldGroupType: "hero",
      title: "Hi",
    });
  });

  it("renames it inside arrays of instances", () => {
    expect(
      up({ blocks: [{ _componentType: "hero" }, { _componentType: "cta" }] })
    ).toEqual({
      blocks: [{ _fieldGroupType: "hero" }, { _fieldGroupType: "cta" }],
    });
  });

  // A snapshot nests entries inside entries: a dynamic zone inside a repeater
  // inside the document root is ordinary, so depth cannot be assumed.
  it("reaches instances at any depth", () => {
    expect(
      up({
        page: {
          rows: [{ cells: [{ blocks: [{ _componentType: "hero" }] }] }],
        },
      })
    ).toEqual({
      page: { rows: [{ cells: [{ blocks: [{ _fieldGroupType: "hero" }] }] }] },
    });
  });

  it("leaves every other key and value untouched", () => {
    const authored = {
      title: "components",
      meta: { type: "component", tags: ["component", "components"] },
      count: 3,
      flag: null,
    };
    expect(up(authored)).toEqual(authored);
  });

  it("keeps key order so a rename does not reshuffle a snapshot", () => {
    const rewritten = up({
      id: "1",
      _componentType: "hero",
      title: "Hi",
    }) as Record<string, unknown>;
    expect(Object.keys(rewritten)).toEqual(["id", "_fieldGroupType", "title"]);
  });

  // A document already holding the target key keeps what is there. Both orders
  // are asserted deliberately: with the stale key first the canonical one
  // overwrites it anyway, so only the target-first case actually exercises the
  // rule — a single-order test passes whether or not the rule exists.
  it.each([
    [
      "stale key first",
      { _componentType: "stale", _fieldGroupType: "current" },
    ],
    [
      "target key first",
      { _fieldGroupType: "current", _componentType: "stale" },
    ],
  ])("does not overwrite an existing target key (%s)", (_label, document) => {
    expect(up(document)).toEqual({ _fieldGroupType: "current" });
  });

  it("is idempotent", () => {
    const once = up({ _componentType: "hero" });
    expect(up(once)).toEqual(once);
  });

  it("reverses when the arguments are swapped", () => {
    const migrated = up({ blocks: [{ _componentType: "hero", n: 1 }] });
    expect(rewriteContentKey(migrated, TO, FROM)).toEqual({
      blocks: [{ _componentType: "hero", n: 1 }],
    });
  });

  it("does not mutate its input", () => {
    const input = { blocks: [{ _componentType: "hero" }] };
    const snapshot = structuredClone(input);
    up(input);
    expect(input).toEqual(snapshot);
  });

  it("passes through primitives and null", () => {
    expect(up(null)).toBeNull();
    expect(up("x")).toBe("x");
    expect(up(5)).toBe(5);
    expect(up([1, "a", null])).toEqual([1, "a", null]);
  });
});
