/**
 * A malformed slot allow-list is refused at REGISTRATION, by the registry the package root's
 * `defineBlock` reaches.
 *
 * The engine's own gate checks the equivalent `allow` field, and it is not the only door: a
 * JavaScript consumer using the exported `defineBlock` registers here without passing the engine
 * at all. Unchecked, `allowedBlocks: "core/heading"` survives registration and throws a TypeError
 * at the first insertion or document validation — a crash during a content operation, naming
 * neither the block nor the slot that caused it, in place of a message at the declaration.
 */
import { describe, expect, it } from "vitest";

import { createBlockRegistry } from "../registry";

describe("the legacy registry gate rejects a malformed allow-list", () => {
  const def = (allowedBlocks: unknown) => ({
    type: "acme/thing",
    label: "Thing",
    category: "layout" as const,
    slots: [{ name: "default", allowedBlocks }],
    render: () => null,
  });

  it("accepts names and namespace wildcards", () => {
    // The positive control on BOTH accepted forms. A gate that refused everything would satisfy
    // every rejection below while making the feature unusable.
    const r = createBlockRegistry();
    expect(() =>
      r.register(def(["core/heading", "core/*"]) as never)
    ).not.toThrow();
  });

  it("accepts a slot that restricts nothing", () => {
    const r = createBlockRegistry();
    expect(() => r.register(def(undefined) as never)).not.toThrow();
  });

  it("refuses a bare string, which a reader would iterate as characters", () => {
    const r = createBlockRegistry();
    expect(() => r.register(def("core/heading") as never)).toThrow(
      /allowedBlocks/
    );
  });

  it("refuses an entry that is not a block name", () => {
    const r = createBlockRegistry();
    expect(() => r.register(def(["shell"]) as never)).toThrow(/allowedBlocks/);
  });

  it("refuses a trailing-slash name no block can answer to", () => {
    const r = createBlockRegistry();
    expect(() => r.register(def(["core/columns/"]) as never)).toThrow(
      /allowedBlocks/
    );
  });
});
