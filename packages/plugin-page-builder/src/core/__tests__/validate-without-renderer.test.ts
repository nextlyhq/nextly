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

import { CORE_BLOCK_STRUCTURES, declaredSlotsOf } from "../block-structure";
import { createBlockRegistry, defaultBlockRegistry } from "../registry";
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

  it("lets a registered definition's OWN slot list be the whole answer", () => {
    // A caller supplying its own definition is stating what its own renderer exposes. Listing NO
    // slots has to mean exactly that — not "fall back to whatever the built-in structure says" —
    // or the built-in's `default` would admit children the caller's renderer never draws.
    //
    // Uses a fresh registry rather than the default one, so this is about definition precedence
    // and not about the empty-registry condition the rest of this file exercises.
    const own = createBlockRegistry();
    own.register({
      type: "core/container",
      version: 1,
      label: "Mine",
      isContainer: true,
      defaultProps: {},
      render: () => null,
    } as never);

    // Positive control: structure DOES declare `default` for this type, so a fallback would accept
    // it — which is what makes the rejection below meaningful rather than vacuous.
    expect(declaredSlotsOf("core/container")).toEqual([{ name: "default" }]);

    expect(
      validateDocument(
        doc(
          container({
            default: [makeNode("core/heading", { text: "x", level: "h2" })],
          })
        ),
        own,
        { allowUnknown: true }
      )
    ).toContain("has no slot");
  });

  it("has structure for the ENTIRE catalogue, containers and plain blocks alike", () => {
    // The property that keeps the write path honest as blocks are added. A type with NO structure
    // is one the validator must leave to `allowUnknown` — so a new block that skips this list opts
    // itself out of the slot check silently. The list is written out rather than derived, so
    // adding a block has to be a deliberate edit here; the OTHER direction — that this record
    // matches the real registry — is what `structure-covers-the-catalog.test.ts` asserts, because
    // only the registry can see it and this file must never load it.
    const containers = [
      "core/columns",
      "core/container",
      "core/content-carousel",
      "core/cover",
      "core/grid",
      "core/off-canvas",
      "core/query-loop",
      "core/row",
    ];
    const plain = [
      "core/accordion",
      "core/anchor",
      "core/badge",
      "core/button",
      "core/button-group",
      "core/counter",
      "core/countdown",
      "core/cta-card",
      "core/divider",
      "core/embed",
      "core/flip-box",
      "core/form",
      "core/gallery",
      "core/heading",
      "core/hotspot",
      "core/icon",
      "core/icon-box",
      "core/icon-list",
      "core/image",
      "core/image-box",
      "core/image-carousel",
      "core/list",
      "core/logo-carousel",
      "core/logo-cloud",
      "core/lottie",
      "core/map",
      "core/paragraph",
      "core/price-list",
      "core/pricing-table",
      "core/progress-bar",
      "core/rating",
      "core/ref",
      "core/reviews",
      "core/rich-text",
      "core/slides",
      "core/social-icons",
      "core/spacer",
      "core/table",
      "core/tabs",
      "core/testimonial",
      "core/testimonial-carousel",
      "core/toggle",
      "core/video",
    ];

    expect(Object.keys(CORE_BLOCK_STRUCTURES).sort()).toEqual(
      [...containers, ...plain].sort()
    );
    // A container declares at least one slot; a plain block declares EXACTLY none. `slots: []` is
    // a statement — "children are junk here" — not an omission.
    for (const type of containers) {
      expect(declaredSlotsOf(type)?.length ?? 0).toBeGreaterThan(0);
    }
    for (const type of plain) {
      expect(declaredSlotsOf(type)).toEqual([]);
    }
  });

  it("REFUSES stored children on a block that holds none", () => {
    // A block with no structure is one the validator leaves to `allowUnknown`, so junk slots on a
    // LEAF pass the write check whenever the registry is empty — the ordinary state of the config
    // and server paths. `slots: []` is what refuses them.
    const error = validateDocument(
      doc({
        ...makeNode("core/heading", { text: "x", level: "h2" }),
        slots: {
          anything: [makeNode("core/paragraph", { text: "junk" })],
        },
      }),
      defaultBlockRegistry,
      { allowUnknown: true }
    );

    expect(error).toContain("anything");
    expect(error).toContain("core/heading");
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
