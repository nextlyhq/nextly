/**
 * What the selected block exposes for editing, and the patch that changes it.
 *
 * Driven through the real registry, because which props a block declares is
 * exactly what a stub would restate — and a stub that agreed today would keep
 * agreeing after the registry changed what a definition means.
 *
 * @module inspector.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  inspectSelection,
  lockOp,
  propPatch,
  renameOp,
  SUPPORTED_PROP_TYPES,
} from "./inspector";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(clearBlocks);

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Register a heading-like block and put one instance in a document. */
function withHeading(props: Record<string, unknown> = {}) {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/heading",
        editor: { label: "Heading" },
        props: {
          text: { type: "text" },
          level: { type: "select", options: ["h1", "h2", "h3"] },
          anchor: { type: "url" },
        },
      },
    ] as never,
    { source: "inspector-test" }
  );
  return documentOf([
    { id: "a", type: "acme/heading", version: 1, props } as BlockNode,
  ]);
}

describe("inspectSelection", () => {
  it("titles the panel with the block's label", () => {
    const inspection = inspectSelection(withHeading(), "a");

    // The label, not the namespaced identity — the same name the palette
    // offered. An author who inserted "Heading" should be editing "Heading".
    expect(inspection?.label).toBe("Heading");
    expect(inspection?.blockName).toBe("acme/heading");
  });

  it("lists props in the order the block declares them", () => {
    // Declaration order rather than alphabetical: a block author writes a
    // heading before its level, and sorting rearranges a form somebody
    // designed. Alphabetical here would be anchor, level, text.
    const inspection = inspectSelection(withHeading(), "a");

    expect(inspection?.props.map(p => p.name)).toEqual([
      "text",
      "level",
      "anchor",
    ]);
  });

  it("carries each prop's current value", () => {
    const inspection = inspectSelection(withHeading({ text: "Hello" }), "a");

    expect(inspection?.props.find(p => p.name === "text")?.value).toBe("Hello");
    // Absent rather than defaulted: what the node holds is what the control
    // shows, and inventing a value here would write it back on the first edit.
    expect(
      inspection?.props.find(p => p.name === "anchor")?.value
    ).toBeUndefined();
  });

  it("carries a select's options", () => {
    const inspection = inspectSelection(withHeading(), "a");

    expect(inspection?.props.find(p => p.name === "level")?.options).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
  });

  it("marks a prop it cannot draw as unsupported, and keeps it", () => {
    // Kept rather than dropped. A block declaring a prop the panel cannot draw
    // is still a block with that prop, and hiding it presents an incomplete
    // block as complete — the author concludes the field does not exist.
    registerBlocks(
      [
        {
          ...base,
          name: "acme/gallery",
          props: {
            caption: { type: "text" },
            images: { type: "array" },
          },
        },
      ] as never,
      { source: "inspector-test" }
    );
    const inspection = inspectSelection(
      documentOf([
        { id: "g", type: "acme/gallery", version: 1, props: {} } as BlockNode,
      ]),
      "g"
    );

    expect(inspection?.props.map(p => p.name)).toEqual(["caption", "images"]);
    expect(inspection?.props.find(p => p.name === "caption")?.supported).toBe(
      true
    );
    expect(inspection?.props.find(p => p.name === "images")?.supported).toBe(
      false
    );
  });

  it("supports exactly the declared set", () => {
    // The set is named rather than inferred from what a switch happens to
    // handle, so this pins the two together: a type added to one and not the
    // other is what makes an unsupported prop fall through silently.
    expect([...SUPPORTED_PROP_TYPES]).toEqual([
      "text",
      "textarea",
      "url",
      "number",
      "checkbox",
      "select",
    ]);
  });

  it("refuses with no selection, a stale id, or an unregistered block", () => {
    const document = withHeading();

    expect(inspectSelection(document, null)).toBeNull();
    expect(inspectSelection(document, "gone")).toBeNull();

    // Unregistered: its props have no schemas, so every control would be
    // guessed from the stored value's runtime type — a text box for a number,
    // silently rewriting it on save.
    clearBlocks();
    expect(inspectSelection(document, "a")).toBeNull();
  });

  it("reports a block with no declared props as having none", () => {
    // Distinct from refusing: the block is known and simply exposes nothing.
    // The panel says so rather than showing an empty column.
    registerBlocks([{ ...base, name: "acme/divider" }] as never, {
      source: "inspector-test",
    });
    const inspection = inspectSelection(
      documentOf([
        { id: "d", type: "acme/divider", version: 1, props: {} } as BlockNode,
      ]),
      "d"
    );

    expect(inspection).not.toBeNull();
    expect(inspection?.props).toEqual([]);
  });
});

describe("propPatch", () => {
  it("carries every other prop through", () => {
    // THE case. `updateNode` merges at the top level, so a patch holding only
    // the edited key REPLACES the props object and drops the rest — editing a
    // heading's text would silently discard its level.
    const node = {
      id: "a",
      type: "acme/heading",
      version: 1,
      props: { text: "Old", level: "h2" },
    } as BlockNode;

    expect(propPatch(node, "text", "New")).toEqual({
      props: { text: "New", level: "h2" },
    });
  });

  it("adds a prop the node did not have", () => {
    const node = {
      id: "a",
      type: "acme/heading",
      version: 1,
      props: { text: "Hi" },
    } as BlockNode;

    expect(propPatch(node, "level", "h3")).toEqual({
      props: { text: "Hi", level: "h3" },
    });
  });

  it("does not mutate the node it was given", () => {
    // The patch is applied by the store against its own copy; mutating here
    // would edit the document outside the op layer, and undo would have no
    // inverse for it.
    const node = {
      id: "a",
      type: "acme/heading",
      version: 1,
      props: { text: "Old" },
    } as BlockNode;

    propPatch(node, "text", "New");

    expect(node.props.text).toBe("Old");
  });
});

describe("block identity", () => {
  it("reports the author's name and the lock, and their absence", () => {
    // Both fields are optional and absent on every document written before they
    // existed, so "absent" is the common case rather than the edge one.
    const named = inspectSelection(withHeading(), "a");
    expect(named?.identity).toEqual({ name: "", locked: false });
  });

  it("carries a name and a lock the node does have", () => {
    registerBlocks(
      [{ ...base, name: "acme/thing", editor: { label: "Thing" } }] as never,
      { source: "inspector-test" }
    );
    const inspection = inspectSelection(
      documentOf([
        {
          id: "t",
          type: "acme/thing",
          version: 1,
          props: {},
          name: "Hero title",
          locked: true,
        } as BlockNode,
      ]),
      "t"
    );

    expect(inspection?.identity).toEqual({ name: "Hero title", locked: true });
  });
});

describe("renameOp", () => {
  it("sets a trimmed name", () => {
    expect(renameOp("a", "  Hero title  ")).toEqual({
      kind: "update",
      id: "a",
      patch: { name: "Hero title" },
    });
  });

  it("UNSETS the field for an empty name rather than storing one", () => {
    // THE case. `""` stored is a second spelling of "no name": absent is what
    // the optional field already means, and `layerLabel` would have to know
    // about both to avoid rendering a blank row.
    expect(renameOp("a", "")).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["name"],
    });
  });

  it("treats a name of only spaces as no name", () => {
    // The same thing wearing a disguise: it passes a non-empty check, renders
    // as nothing, and cannot be reached by the layers panel's typeahead.
    expect(renameOp("a", "   ")).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["name"],
    });
  });
});

describe("lockOp", () => {
  it("locks by setting the flag", () => {
    expect(lockOp("a", true)).toEqual({
      kind: "update",
      id: "a",
      patch: { locked: true },
    });
  });

  it("UNSETS on release rather than storing false", () => {
    // `locked` is absent on every node in every document written so far, so
    // storing `false` would make an unlock a WRITE to every block an author
    // touches, adding a field that means what its absence already meant.
    expect(lockOp("a", false)).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    });
  });
});
