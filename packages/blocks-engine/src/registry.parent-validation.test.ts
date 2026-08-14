/**
 * `parent` is checked at REGISTRATION, not only by the compiler.
 *
 * A bare string is the shape to fear rather than a missing field: it is iterable, so a reader
 * spreading it produces one-character "block names", every real placement is refused as the wrong
 * parent, and documents already using the block stop saving — with nothing in the failure naming
 * this declaration. TypeScript rejects it at the authoring site; definitions also arrive from
 * JavaScript plugins, from JSON, and from builds where the types were never run.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearBlocks, getBlock, registerBlocks } from "./registry";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(() => {
  clearBlocks();
});

describe("parent validation at registration", () => {
  it("accepts an array of namespaced names", () => {
    // The positive control: without it, a gate that refused every `parent` would pass the
    // rejections below while making the field unusable.
    registerBlocks(
      [{ ...base, name: "acme/ok", parent: ["core/columns"] }] as never,
      { source: "acme" }
    );
    expect(getBlock("acme/ok")?.parent).toEqual(["core/columns"]);
  });

  it("accepts a definition that declares no parent at all", () => {
    registerBlocks([{ ...base, name: "acme/none" }] as never, {
      source: "acme",
    });
    expect(getBlock("acme/none")).toBeDefined();
  });

  it("refuses a bare string, which would spread into one-character names", () => {
    expect(() =>
      registerBlocks(
        [{ ...base, name: "acme/str", parent: "core/columns" }] as never,
        { source: "acme" }
      )
    ).toThrow(/parent must be an array/);
  });

  it("refuses an entry that is not a namespaced block name", () => {
    expect(() =>
      registerBlocks(
        [{ ...base, name: "acme/bad", parent: ["columns"] }] as never,
        { source: "acme" }
      )
    ).toThrow(/parent must be an array/);
  });
});
