/**
 * A slot a block's own definition does not declare is rejected at save and ignored at read.
 *
 * The allowlist a definition puts on a slot is a promise about what can live there. `spec` was
 * undefined by TWO paths and only one was gated: an unregistered block type, where the permissive
 * answer is what `allowUnknown` asks for, and a KNOWN container carrying a slot name its own
 * definition never declared, which nothing asked for and which left every child in it unchecked.
 *
 * Both halves are asserted here because either alone leaves the hole open: rejecting at write does
 * nothing for the pages already stored, and ignoring at read does nothing to stop new ones.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createBlockRegistry, defaultBlockRegistry } from "../registry";
import { PageRenderer } from "../../render/PageRenderer";
import "../../render/blocks";
import { compileDocumentCss, documentNodeClasses } from "../style-compiler";
import { declaredSlotEntries, pruneUndeclaredSlots } from "../declared-slots";
import { makeNode } from "../tree";
import { validateDocument } from "../validate";

import type { BlockNode } from "../types";

/** A container holding a child under a slot name `core/container` never declares. */
const withStaleSlot = (): BlockNode => {
  const node = makeNode("core/container", {}, undefined, {
    default: [makeNode("core/heading", { text: "Kept", level: "h2" })],
  });
  return {
    ...node,
    slots: {
      ...node.slots,
      // A slot a rename or a block update left behind.
      legacy: [
        {
          ...makeNode("core/heading", { text: "Stale", level: "h2" }),
          style: { base: { backgroundImage: "/stale-asset.png" } },
        },
      ],
    },
  };
};

const doc = (root: BlockNode) => ({ version: 1, root }) as never;

describe("a slot the definition does not declare", () => {
  it("is refused at save, naming the slot", () => {
    // The write path: `collections/pageBuilderField.ts` uses this as the field's `validate`, so a
    // document carrying one never reaches the database in the first place.
    const error = validateDocument(doc(withStaleSlot()), defaultBlockRegistry);

    // A string is the failure channel; `true` is the pass. Naming the slot is the point — an
    // author cannot fix what the message does not identify.
    expect(error).toContain("legacy");
    expect(error).toContain("core/container");
  });

  it("still accepts the slots the definition DOES declare", () => {
    // Positive control: the rejection is about the undeclared name, not about slots in general —
    // a fixture that failed validation for any reason would satisfy the assertion above.
    const node = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/heading", { text: "Fine", level: "h2" })],
    });

    expect(validateDocument(doc(node), defaultBlockRegistry)).toBe(true);
  });

  it("is dropped from the tree a reader sees", () => {
    const pruned = pruneUndeclaredSlots(withStaleSlot(), defaultBlockRegistry);

    expect(Object.keys(pruned.slots ?? {})).toEqual(["default"]);
    // Positive control: the declared slot and its child survive, so this is pruning rather than
    // emptying.
    expect(pruned.slots?.default).toHaveLength(1);
  });

  it("keeps its CSS and its asset URL out of the stylesheet", () => {
    // The reason this is not merely tidiness. Both readers walked every STORED slot, so a stale
    // slot's children were compiled into the sheet — `url(...)` included — for markup nobody
    // receives. A background image is a REQUEST, so the leak is not only weight.
    const stale = withStaleSlot();
    const before = compileDocumentCss(doc(stale), {
      classes: documentNodeClasses(doc(stale)),
    });
    const pruned = pruneUndeclaredSlots(stale, defaultBlockRegistry);
    const after = compileDocumentCss(doc(pruned), {
      classes: documentNodeClasses(doc(pruned)),
    });

    // Positive control: the URL really was reaching the sheet, so the assertion below is about the
    // prune and not about a fixture that never produced it.
    expect(before).toContain("stale-asset.png");
    expect(after).not.toContain("stale-asset.png");
  });

  it("is gone from what a real page RENDERS, sheet included", () => {
    // Asserted through `PageRenderer`, because the prune has to be wired at the entry point to be
    // worth anything — a correct helper nobody calls is the same as no helper.
    //
    // The STYLESHEET is what pins it. A container's own `render` places `slots.default` and
    // nothing else, so a stale slot's children never reach the markup whether or not anything
    // prunes them; asserting on the markup alone passes against an unwired prune. The compiler is
    // the half that walked every STORED slot, so the asset URL is where the wiring shows.
    const html = renderToStaticMarkup(
      <PageRenderer document={doc(withStaleSlot())} />
    );

    // Positive control: the page really rendered, and its sheet really is in this string.
    expect(html).toContain("Kept");
    expect(html).toContain("<style");
    expect(html).not.toContain("stale-asset.png");
    expect(html).not.toContain("Stale");
  });

  it("is pruned inside the reusable LIBRARY too", () => {
    // A library block is rendered by the same code and can hold a stale slot for the same reason.
    // Pruning only `document.root` would leave the leak open for every page that places it —
    // which is more pages, not fewer, since that is what reusable means.
    const html = renderToStaticMarkup(
      <PageRenderer
        document={doc(
          makeNode("core/container", {}, undefined, {
            default: [makeNode("core/ref", { refId: "r1" })],
          })
        )}
        refs={{ r1: withStaleSlot() }}
      />
    );

    // Positive control: the library block itself rendered, so the placement resolved.
    expect(html).toContain("Kept");
    expect(html).not.toContain("stale-asset.png");
  });

  it("keeps the children of a type this runtime has not loaded", () => {
    // "This process has not loaded that plugin" and "that block declares no such slot" are
    // different statements, and only the second justifies dropping anything. A page rendered while
    // a plugin is unloaded would otherwise lose the children of every block it owns — and since the
    // pruned tree is what would be saved next, it would lose them permanently.
    const unloaded: BlockNode = {
      ...makeNode("acme/not-loaded", {}),
      slots: {
        default: [
          makeNode("core/heading", { text: "Author's work", level: "h2" }),
        ],
      },
    };

    const pruned = pruneUndeclaredSlots(unloaded, defaultBlockRegistry);

    expect(pruned.slots?.default).toHaveLength(1);
    // Positive control: the registry really does not know this type, so the assertion above is
    // about the unknown-type branch and not about a type that happens to declare `default`.
    expect(defaultBlockRegistry.get("acme/not-loaded")).toBeUndefined();
  });

  it("still refuses to SAVE a known block's undeclared slot, and permits an unknown one", () => {
    // The write path draws the same line: a known container is held to its declaration, and a type
    // this runtime cannot see is left to the caller's `allowUnknown`, which is what that option is
    // for. Read and write disagreeing about which nodes are suspect is how one of them corrupts
    // what the other accepted.
    const unloaded = {
      ...makeNode("acme/not-loaded", {}),
      slots: {
        default: [makeNode("core/heading", { text: "x", level: "h2" })],
      },
    };

    expect(
      validateDocument(doc(unloaded), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
    expect(
      validateDocument(doc(withStaleSlot()), defaultBlockRegistry)
    ).toContain("legacy");
  });

  it("returns the SAME node when a document has nothing to prune", () => {
    // A document with no stale slot is not rebuilt, so callers comparing by identity — and React
    // reconciling on it — are unaffected by a pass that had nothing to do.
    const clean = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/heading", { text: "Fine", level: "h2" })],
    });

    expect(pruneUndeclaredSlots(clean, defaultBlockRegistry)).toBe(clean);
  });

  it("reads slots in DECLARED order, not stored order", () => {
    // `blocks-react`'s SEO deriver already answers this question that way. Two packages disagreeing
    // about which child comes first is how one of them describes a page the other renders.
    //
    // Against a purpose-built definition rather than a built-in: every block in the catalogue
    // declares exactly one slot today, so no fixture drawn from it could tell the two orders apart.
    const registry = createBlockRegistry();
    registry.register({
      type: "test/two-slots",
      version: 1,
      label: "Two slots",
      isContainer: true,
      slots: [{ name: "alpha" }, { name: "omega" }],
      render: () => null,
    });
    const node = {
      ...makeNode("test/two-slots"),
      // Stored in the REVERSE of the declared order, so stored order and declared order disagree.
      slots: {
        omega: [makeNode("core/heading", { text: "omega", level: "h2" })],
        alpha: [makeNode("core/heading", { text: "alpha", level: "h2" })],
      },
    };

    // Positive control: both slots survive, so this is about their ORDER and not about one of them
    // being dropped.
    expect(declaredSlotEntries(node, registry)).toHaveLength(2);
    expect(declaredSlotEntries(node, registry).map(([name]) => name)).toEqual([
      "alpha",
      "omega",
    ]);
  });
});
