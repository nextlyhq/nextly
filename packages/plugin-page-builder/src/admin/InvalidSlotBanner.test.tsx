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

import {
  actionLabelFor,
  InvalidSlotBanner,
  repairFor,
  whereFor,
} from "./InvalidSlotBanner";
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

describe("which half of the nesting rule a row blames", () => {
  it("says the BLOCK needs another parent when the container would have taken it", () => {
    // `core/container` accepts anything; `core/column` requires `core/columns`. Reporting this as
    // "the container does not accept it" is the opposite of the cause, and sends a plugin author
    // to the container's declaration instead of the block's.
    const document: BlockDocument = {
      version: 1,
      root: makeNode("core/container", {}, undefined, {
        default: [makeNode("core/column", {}, undefined, { default: [] })],
      }),
    };
    expect(validateDocument(document, defaultBlockRegistry)).not.toBe(true);
    const [entry] = findInvalidSlotEntries(document.root, defaultBlockRegistry);
    expect(entry).toMatchObject({
      kind: "not-allowed",
      cause: "parent-requires",
    });
    const said = whereFor(entry);
    expect(said).toContain("may only sit inside core/columns");
    expect(said).not.toContain("does not accept");
  });

  it("still says the SLOT refuses it where that is what happened", () => {
    // The separating control. A heading in a columns row is refused by the row's allowlist, not by
    // any rule the heading carries — so the other message is the correct one and must survive.
    const document: BlockDocument = {
      version: 1,
      root: makeNode("core/columns", {}, undefined, {
        default: [heading("hi")],
      }),
    };
    expect(validateDocument(document, defaultBlockRegistry)).not.toBe(true);
    const [entry] = findInvalidSlotEntries(document.root, defaultBlockRegistry);
    expect(entry).toMatchObject({ kind: "not-allowed", cause: "slot-refuses" });
    expect(whereFor(entry)).toContain("does not accept core/heading");
  });
});

describe("what the banner says about a parent-restricted ROOT", () => {
  /** A `core/column` root: visible on the canvas, and unsaveable because of where it sits. */
  const columnRoot: BlockDocument = {
    version: 1,
    root: makeNode("core/column", {}, undefined, { default: [heading("hi")] }),
  };

  it("is the only fault, and the page really is unsaveable", () => {
    // The precondition. Without it the assertions below could pass on a page that saves fine, or
    // on a banner listing something else entirely.
    expect(validateDocument(columnRoot, defaultBlockRegistry)).not.toBe(true);
    const entries = findInvalidSlotEntries(
      columnRoot.root,
      defaultBlockRegistry
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("root-parent");
  });

  it("does not claim it is undrawn, because the author is looking at it", () => {
    const markup = markupFor(columnRoot);
    // The root DRAWS — it is the whole page. Telling the author nothing is on the canvas sends
    // them looking for something invisible while the fault is the block in front of them.
    expect(markup).not.toContain("None of it is drawn on the canvas");
    expect(markup).not.toContain("no longer exists");
    expect(markup).toContain("Each one is drawn on the canvas");
  });
});

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
      const viaEditor = editorReducer(initialState(broken), repairFor(entry));
      const viaCore = repairInvalidSlot(
        broken.root,
        entry,
        defaultBlockRegistry
      );
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
      (s, entry) => editorReducer(s, repairFor(entry)),
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

  it("keeps a block a slot refuses, by putting it in the one thing that may hold it", () => {
    // A document written while the row took any block carries this shape: headings sitting
    // directly in the row. The write path refuses it, and the author can SEE the headings — so a
    // repair that deleted them would take away work in front of them.
    const legacy = docWith({
      default: [
        makeNode("core/columns", {}, undefined, {
          default: [heading("Left half"), heading("Right half")],
        }),
      ],
    });

    // Precondition: this really is refused, and for the allowlist rather than for a slot name.
    expect(
      validateDocument(legacy, defaultBlockRegistry, { allowUnknown: true })
    ).toContain("is not allowed in slot");

    const entries = findInvalidSlotEntries(legacy.root, defaultBlockRegistry);
    expect(entries.map(e => e.kind)).toEqual(["not-allowed", "not-allowed"]);

    expect(markupFor(legacy)).toContain("no longer allowed");
    // The rows are behind Review, so the button's own answer is read directly rather than from
    // the collapsed markup, where its absence would prove nothing.
    expect(entries.map(actionLabelFor)).toEqual([
      "Wrap in Column",
      "Wrap in Column",
    ]);
    // The action is a CARRIER now: it names the fault, and the reducer asks the core what to do
    // with it. Which operation runs is asserted through the resulting tree below.
    expect(entries.map(e => repairFor(e).type)).toEqual([
      "REPAIR_INVALID_SLOT",
      "REPAIR_INVALID_SLOT",
    ]);

    const repaired = entries.reduce(
      (s, entry) => editorReducer(s, repairFor(entry)),
      initialState(legacy)
    );

    expect(
      validateDocument(repaired.document, defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
    // Both headings survive, each inside a column of its own. That is the arrangement the row
    // lays out for two loose children, so the repair preserves what the page looked like rather
    // than collapsing both into one column.
    const row = repaired.document.root.slots?.default?.[0];
    expect(row?.slots?.default?.map(c => c.type)).toEqual([
      "core/column",
      "core/column",
    ]);
    // Each wrapper carries what its own DEFINITION promises new instances, rather than an empty
    // object: a block whose `validate` needs an initialized prop would otherwise be created
    // already unsaveable, leaving the page refused after the repair the banner advertised. This
    // suite loads `render/blocks`, so there is a definition to disagree with.
    const columnDef = defaultBlockRegistry.get("core/column");
    expect(columnDef?.defaultProps).not.toEqual({});
    for (const column of row?.slots?.default ?? []) {
      expect(column.props).toEqual(columnDef?.defaultProps);
      expect(column.definitionVersion).toBe(columnDef?.version);
    }
    expect(
      row?.slots?.default?.map(c => c.slots?.default?.[0]?.props?.text)
    ).toEqual(["Left half", "Right half"]);
    expect(markupFor(repaired.document)).toBe("");
  });

  it("still offers removal where no single type could hold the block", () => {
    // A slot naming several permitted types leaves a genuine choice, and choosing for the author
    // is worse than telling them the block has to go.
    const entry = {
      key: "not-allowed:x",
      parentId: "p",
      parentType: "test/row",
      path: "test/row",
      kind: "not-allowed" as const,
      slotName: "default",
      node: heading("Stranded"),
      type: "core/heading",
      descendantCount: 0,
    };
    expect(actionLabelFor(entry)).toBe("Remove");
    expect(repairFor(entry)).toEqual({ type: "REPAIR_INVALID_SLOT", entry });
  });
});
