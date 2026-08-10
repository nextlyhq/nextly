/**
 * The slot check has to work where it actually RUNS — with no renderer loaded.
 *
 * 🔴 THIS FILE MUST NOT IMPORT `render/blocks`, DIRECTLY OR THROUGH ANYTHING ELSE. That import
 * registers every built-in as a side effect, and its presence is precisely what made the first
 * version of this check appear to work while being inert: `pageBuilderField` calls the validator
 * from the core entry, which never performs it. Measured before the fix, with no renderer import:
 *
 *     registry size: 0
 *     knows core/container? false
 *     validate: true            ← a document with an undeclared slot ACCEPTED
 *
 * A test file's import list is part of its fixture. Anything added here that reaches a `.tsx` block
 * file re-creates the hole this file exists to keep shut.
 */
import { describe, expect, it } from "vitest";

import { declaredSlotsOf } from "../block-structure";
import { defaultBlockRegistry } from "../registry";
import { makeNode } from "../tree";
import { validateDocument } from "../validate";

import type { BlockNode } from "../types";

const doc = (root: BlockNode) => ({ version: 1, root }) as never;

const container = (slots: Record<string, BlockNode[]>): BlockNode => ({
  ...makeNode("core/container", {}),
  slots,
});

describe("the write path with nothing rendered", () => {
  it("has an EMPTY registry, which is the condition under test", () => {
    // The precondition, asserted rather than assumed. If a future import populates the registry,
    // this fails first and says why — instead of the assertions below quietly passing for the wrong
    // reason, which is exactly what happened before.
    expect(defaultBlockRegistry.all()).toHaveLength(0);
    expect(defaultBlockRegistry.get("core/container")).toBeUndefined();
  });

  it("still knows what slots a migrated block declares", () => {
    // Structure is data, available at import time, with no React anywhere behind it.
    expect(declaredSlotsOf("core/container")).toEqual([{ name: "default" }]);
    expect(declaredSlotsOf("core/columns")).toEqual([{ name: "default" }]);
    expect(declaredSlotsOf("core/grid")).toEqual([{ name: "default" }]);
  });

  it("REFUSES a slot the block does not declare", () => {
    // The whole point. This is the call `pageBuilderField` makes — same registry, same options.
    const error = validateDocument(
      doc(
        container({
          default: [makeNode("core/heading", { text: "Kept", level: "h2" })],
          legacy: [makeNode("core/heading", { text: "Stale", level: "h2" })],
        })
      ),
      defaultBlockRegistry,
      { allowUnknown: true }
    );

    expect(error).toContain("legacy");
    expect(error).toContain("core/container");
  });

  it("accepts the slot the block DOES declare", () => {
    // Positive control: the rejection above is about the undeclared name, not about slots in
    // general or about the empty registry rejecting everything it sees.
    expect(
      validateDocument(
        doc(
          container({
            default: [makeNode("core/heading", { text: "Fine", level: "h2" })],
          })
        ),
        defaultBlockRegistry,
        { allowUnknown: true }
      )
    ).toBe(true);
  });

  it("leaves a type this build has no structure for to allowUnknown", () => {
    // A block from a plugin this process has not loaded. "No structure for that type" and "that
    // block declares no such slot" look identical from the lookup and only the second is a reason
    // to reject — otherwise every save made while a plugin is unloaded would fail.
    const foreign: BlockNode = {
      ...makeNode("acme/not-loaded", {}),
      slots: {
        whatever: [makeNode("core/heading", { text: "x", level: "h2" })],
      },
    };

    expect(declaredSlotsOf("acme/not-loaded")).toBeUndefined();
    expect(
      validateDocument(doc(foreign), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
  });
});
