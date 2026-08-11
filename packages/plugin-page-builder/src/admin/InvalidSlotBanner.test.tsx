/**
 * The repair banner, and the loop it closes.
 *
 * Two separate claims, because either one alone can be true while the surface does nothing. The
 * banner has to APPEAR for a document that cannot save, and the button it draws has to ask the
 * reducer for the repair that actually makes the document save. A row naming the right block while
 * dispatching the wrong slot would look right in any screenshot and fix nothing, so the second
 * claim is followed all the way through the reducer to the validator.
 *
 * `render/blocks` is imported on purpose here: the admin is where this component runs, and there
 * the registry is populated. The finder's own tests cover the opposite condition.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  findInvalidSlotEntries,
  repairInvalidSlot,
} from "../core/invalid-slots";
import { defaultBlockRegistry } from "../core/registry";
import { makeNode } from "../core/tree";
import { validateDocument } from "../core/validate";
import "../render/blocks";

import { InvalidSlotBanner, removalFor } from "./InvalidSlotBanner";
import { EditorProvider } from "./store/EditorProvider";
import { editorReducer, initialState } from "./store/editorStore";

import type { BlockDocument, BlockNode } from "../core/types";

function docWith(slots: Record<string, BlockNode[]>): BlockDocument {
  return { version: 1, root: makeNode("core/container", {}, undefined, slots) };
}

const heading = (text: string) => makeNode("core/heading", { text });

function markupFor(document: BlockDocument): string {
  return renderToStaticMarkup(
    <EditorProvider document={document} draftKey="nx-pb-test">
      <InvalidSlotBanner />
    </EditorProvider>
  );
}

describe("the repair banner", () => {
  it("says nothing about a document that saves", () => {
    const clean = docWith({ default: [heading("Fine")] });

    expect(
      validateDocument(clean, defaultBlockRegistry, { allowUnknown: true })
    ).toBe(true);
    expect(markupFor(clean)).toBe("");
  });

  it("appears, and counts what the author cannot see", () => {
    const broken = docWith({
      default: [heading("Visible")],
      legacy: [heading("Invisible"), heading("Also invisible")],
    });

    // Precondition: this really is a document the write path refuses. Without it the banner
    // could be appearing for something that would have saved perfectly.
    expect(
      validateDocument(broken, defaultBlockRegistry, { allowUnknown: true })
    ).toContain("has no slot");

    const markup = markupFor(broken);
    expect(markup).toContain("2 blocks in a slot");
    expect(markup).toContain("will not save");
    expect(markup).toContain("Review");
  });

  it("uses the singular for one block", () => {
    expect(markupFor(docWith({ legacy: [heading("Only one")] }))).toContain(
      "1 block in a slot"
    );
  });

  it("shows a stale slot that is already empty, which holds no block to list", () => {
    // The banner has to appear for a page whose only fault is a slot NAME. A surface that only
    // ever counted blocks would render nothing here and leave the page unsaveable in silence.
    const broken = docWith({ legacy: [] });

    expect(
      validateDocument(broken, defaultBlockRegistry, { allowUnknown: true })
    ).toContain("has no slot");

    const markup = markupFor(broken);
    expect(markup).toContain("1 leftover");
    expect(markup).not.toContain("1 block in a slot");
  });

  it("asks the reducer for exactly the repair the core prescribes", () => {
    // Two switches on the same union, in two layers, which must not drift: the editor decides
    // which ACTION a row dispatches, and the core decides which OPERATION a fault needs. Compared
    // across every kind rather than trusted, because a wrong pairing still type-checks.
    const broken = docWith({
      legacy: [heading("Orphan")],
      alsoStale: [],
    });

    const entries = findInvalidSlotEntries(broken.root, defaultBlockRegistry);
    expect(entries.map(e => e.kind).sort()).toEqual(["block", "empty-slot"]);

    for (const entry of entries) {
      const viaEditor = editorReducer(initialState(broken), removalFor(entry));
      const viaCore = repairInvalidSlot(broken.root, entry);
      expect(viaEditor.document.root).toEqual(viaCore);
    }
  });

  it("dispatches repairs that actually make the document save", () => {
    // Finder to button to reducer to validator, with nothing hand-written in between. This is the
    // claim that a screenshot cannot make: the rows carry the slot they were found under, and the
    // reducer removes that slot rather than merely the node inside it.
    const broken = docWith({
      default: [
        heading("Visible"),
        makeNode("core/row", {}, undefined, {
          default: [heading("Also visible")],
          removed: [heading("Orphan in a row")],
        }),
      ],
      legacy: [heading("Orphan at the top")],
    });

    const entries = findInvalidSlotEntries(broken.root, defaultBlockRegistry);
    expect(entries.length).toBeGreaterThan(0);

    const repaired = entries.reduce(
      (s, entry) => editorReducer(s, removalFor(entry)),
      initialState(broken)
    );

    expect(
      validateDocument(repaired.document, defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
    // And the banner stops showing, which is the author's signal that they are done.
    expect(markupFor(repaired.document)).toBe("");
  });
});
