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
  registryBlockSource,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  designLockOf,
  fieldLabel,
  inspectSelection,
  lockOp,
  propIsWritable,
  propPatch,
  renameOp,
  SUPPORTED_PROP_TYPES,
  lockStateOf,
  layersLockChangeable,
  lockStatusOf,
  designIsWritable,
  designReadOnlyReason,
  blockIsReadOnly,
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
            // A type no control exists for. (Arrays have one now.)
            images: { type: "acme-gallery-images" },
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
      "media",
      "icon",
      "richText",
      "array",
      "relation",
      "entryField",
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

describe("a block inside an area locked to its content", () => {
  // A headline whose text is content and whose alignment is design, held by
  // blocks whose slots are locked in each way a lock can read.
  function withLockedAreas() {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/headline",
          editor: { label: "Headline" },
          props: {
            text: { type: "text", role: "content" },
            align: { type: "select", options: ["left", "right"] },
          },
        },
        {
          ...base,
          name: "acme/hero",
          editor: { label: "Hero" },
          slots: {
            body: {
              defaultBlock: [{ type: "acme/headline" }],
              lock: "contentOnly",
            },
          },
        },
        // A slot that declares no lock of its own, inside the hero's area.
        {
          ...base,
          name: "acme/card",
          slots: { inner: { defaultBlock: [{ type: "acme/headline" }] } },
        },
        {
          ...base,
          name: "acme/row",
          slots: {
            items: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
          },
        },
      ] as never,
      { source: "inspector-test" }
    );
  }

  const headline = (id: string): BlockNode =>
    ({
      id,
      type: "acme/headline",
      version: 1,
      props: { text: "Title", align: "left" },
    }) as BlockNode;

  const holder = (id: string, type: string, slot: string, child: BlockNode) =>
    ({
      id,
      type,
      version: 1,
      props: {},
      slots: { [slot]: [child] },
    }) as BlockNode;

  it("keeps its content editable and shows the rest read-only", () => {
    withLockedAreas();
    const inspection = inspectSelection(
      documentOf([holder("h", "acme/hero", "body", headline("t"))]),
      "t"
    );

    expect(inspection?.props.map(prop => [prop.name, prop.readOnly])).toEqual([
      ["text", false],
      ["align", true],
    ]);
  });

  it("gives the reason in the words every lock refusal uses", () => {
    withLockedAreas();
    const inspection = inspectSelection(
      documentOf([holder("h", "acme/hero", "body", headline("t"))]),
      "t"
    );

    expect(inspection?.designLock).toEqual({
      headline: "This area of Hero is locked to its content.",
      remedy: "Headline's design and settings can't change here.",
    });
  });

  it("names the area by its outermost locked block, two slots down", () => {
    // The card's slot declares no lock, so the hero's passes through it: the
    // headline is held, and the area an author meets is the hero's.
    withLockedAreas();
    const inspection = inspectSelection(
      documentOf([
        holder(
          "h",
          "acme/hero",
          "body",
          holder("c", "acme/card", "inner", headline("t"))
        ),
      ]),
      "t"
    );

    expect(inspection?.designLock?.headline).toBe(
      "This area of Hero is locked to its content."
    );
    expect(
      inspection?.props.find(prop => prop.name === "align")?.readOnly
    ).toBe(true);
  });

  it("holds nothing read-only where no lock fixes the design", () => {
    // Locked "all" fixes which blocks the row holds, not how they look; and a
    // block at the top level sits in no slot at all.
    withLockedAreas();
    for (const document of [
      documentOf([holder("r", "acme/row", "items", headline("t"))]),
      documentOf([headline("t")]),
    ]) {
      const inspection = inspectSelection(document, "t");
      expect(inspection?.designLock).toBeUndefined();
      expect(inspection?.props.map(prop => prop.readOnly)).toEqual([
        false,
        false,
      ]);
    }
  });

  it("reads the locks from the editor's own source, not only the registry", () => {
    withLockedAreas();
    // A host judging edits by its own definitions: in them the card's slot
    // is locked to its content, which the registry's card does not say.
    const registered = registryBlockSource();
    const definitions = {
      get: (type: string) =>
        type === "acme/card"
          ? {
              version: 1,
              slots: {
                inner: {
                  defaultBlock: [{ type: "acme/headline" }],
                  lock: "contentOnly" as const,
                },
              },
            }
          : registered.get(type),
    };
    const page = documentOf([holder("c", "acme/card", "inner", headline("t"))]);

    // CONTROL: by the registry nothing holds it.
    expect(designLockOf(page, "t")).toBeUndefined();
    expect(designLockOf(page, "t", { definitions })).toBeDefined();
    expect(propIsWritable(page, "t", "align", { definitions })).toBe(false);
  });

  it("holds a block a placement puts under a component's lock, which only the composed page shows", () => {
    withLockedAreas();
    // On the page the headline is placement content, under no lock of the
    // page's own; composed, it sits in the component's hero, locked to its
    // content, and keeps its id.
    const page = documentOf([headline("t")]);
    const composed = documentOf([
      holder("cx-h", "acme/hero", "body", headline("t")),
    ]);

    // CONTROL: the page alone holds nothing read-only.
    expect(designLockOf(page, "t")).toBeUndefined();
    expect(designLockOf(page, "t", { composed })).toBeDefined();
    expect(propIsWritable(page, "t", "align", { composed })).toBe(false);
    expect(propIsWritable(page, "t", "text", { composed })).toBe(true);
    expect(
      inspectSelection(page, "t", { composed })?.props.map(prop => [
        prop.name,
        prop.readOnly,
      ])
    ).toEqual([
      ["text", false],
      ["align", true],
    ]);
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

describe("lockStateOf", () => {
  /*
   * `mixed` is a real third state. A checkbox showing on or off for a set where
   * only some blocks are locked tells the author something false about half of
   * what they selected, and ARIA models exactly this as `aria-checked="mixed"`.
   */
  function docWith(locks: readonly boolean[]) {
    return {
      formatVersion: 1,
      kind: "page",
      nodes: locks.map((locked, i) => ({
        id: String(i),
        type: "acme/leaf",
        version: 1,
        props: {},
        ...(locked ? { locked: true } : {}),
      })),
    } as never;
  }

  it("reads all-locked and all-unlocked", () => {
    expect(lockStateOf(docWith([true, true]), ["0", "1"])).toBe("locked");
    expect(lockStateOf(docWith([false, false]), ["0", "1"])).toBe("unlocked");
  });

  it("reads MIXED when only some are locked", () => {
    expect(lockStateOf(docWith([true, false]), ["0", "1"])).toBe("mixed");
  });

  it("skips ids the document lost rather than counting them unlocked", () => {
    /*
     * An undo removing a selected block is routine. Counting the missing one as
     * unlocked would report `mixed` for a set that is entirely locked — the
     * author would see an indeterminate checkbox describing a state that does
     * not exist.
     */
    expect(lockStateOf(docWith([true]), ["0", "gone"])).toBe("locked");
  });

  it("reads an empty set as unlocked", () => {
    expect(lockStateOf(docWith([]), [])).toBe("unlocked");
  });
});

describe("lockStatusOf and designIsWritable", () => {
  /** A frame whose one slot carries the given lock, holding one text block. */
  function framed(
    lock: "all" | "insert" | "contentOnly",
    child: Partial<BlockNode> = {}
  ) {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/text",
          editor: { label: "Text" },
          props: {
            body: { type: "text", role: "content" },
            tone: { type: "text" },
          },
        },
        {
          ...base,
          name: "acme/frame",
          editor: { label: "Frame" },
          props: {},
          slots: { children: { lock, defaultBlock: [{ type: "acme/text" }] } },
        },
      ] as never,
      { source: "inspector-test" }
    );
    return documentOf([
      {
        id: "frame",
        type: "acme/frame",
        version: 1,
        props: {},
        slots: {
          children: [
            {
              id: "t",
              type: "acme/text",
              version: 1,
              props: {},
              ...child,
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ]);
  }

  it("reports no lock for a free block, and its design writable", () => {
    const doc = withHeading();
    expect(lockStatusOf(doc, "a")).toEqual({ layers: false, slot: undefined });
    expect(designIsWritable(doc, "a")).toBe(true);
  });

  it("reports the Layers lock, and the design read-only under it", () => {
    const doc = documentOf([
      {
        id: "a",
        type: "acme/heading",
        version: 1,
        props: {},
        locked: true,
      } as BlockNode,
    ]);
    withHeading();
    expect(lockStatusOf(doc, "a").layers).toBe(true);
    expect(designIsWritable(doc, "a")).toBe(false);
  });

  it("reports a Layers lock held from the block around it, read-only, naming that block", () => {
    // A lock covers everything inside the block: the child is not locked
    // itself, yet nothing about it may change, and the inspector says which
    // block holds the lock so the author knows where to lift it.
    withHeading();
    const doc = documentOf([
      {
        id: "outer",
        type: "acme/heading",
        version: 1,
        props: {},
        locked: true,
        name: "Hero",
        slots: {
          children: [{ id: "a", type: "acme/heading", version: 1, props: {} }],
        },
      } as BlockNode,
    ]);
    expect(lockStatusOf(doc, "a")).toEqual({
      layers: false,
      inheritedFrom: "Hero",
      slot: undefined,
    });
    expect(blockIsReadOnly(doc, "a")).toBe(true);
    expect(propIsWritable(doc, "a", "text")).toBe(false);
    expect(designReadOnlyReason(doc, "a")).toBe(
      "Locked by Hero: this block is inside it, so it can't be moved, deleted or edited. Unlock Hero to change it."
    );
    // The block holding the lock reports its own, not an inherited one.
    expect(lockStatusOf(doc, "outer").inheritedFrom).toBeUndefined();
  });

  it("names the block whose slot fixes a contentOnly area, and keeps its design read-only", () => {
    const doc = framed("contentOnly");
    expect(lockStatusOf(doc, "t")).toEqual({
      layers: false,
      slot: {
        lock: "contentOnly",
        holder: "Frame",
        // The lock refusal's own wording: one sentence for the read-only
        // reason and a refused edit.
        reason:
          "This area of Frame is locked to its content. Text's design and settings can't change here.",
      },
    });
    expect(designIsWritable(doc, "t")).toBe(false);
    expect(designReadOnlyReason(doc, "t")).toBe(
      "This area of Frame is locked to its content. Text's design and settings can't change here."
    );
  });

  it("leaves the design writable in a slot locked all or insert, and still names the holder", () => {
    for (const lock of ["all", "insert"] as const) {
      clearBlocks();
      const doc = framed(lock);
      expect(lockStatusOf(doc, "t").slot).toMatchObject({
        lock,
        holder: "Frame",
      });
      expect(lockStatusOf(doc, "t").slot?.reason).toMatch(
        /^Frame fixes which blocks it holds/
      );
      expect(designIsWritable(doc, "t")).toBe(true);
    }
  });

  it("keeps both locks apart when a block carries its own and sits in a locked slot", () => {
    const doc = framed("contentOnly", { locked: true });
    expect(lockStatusOf(doc, "t")).toMatchObject({
      layers: true,
      slot: { lock: "contentOnly", holder: "Frame" },
    });
  });

  it("answers for the frame itself as unlocked: its own slot holds its children, not it", () => {
    const doc = framed("contentOnly");
    expect(lockStatusOf(doc, "frame").slot).toBeUndefined();
  });
  it("prefers a contentOnly area the composed page adds over the page's own arrangement lock", () => {
    // On the page the text sits in a row locked `all`; composed, a component
    // places it in a frame locked to its content. The design is held, so the
    // card must say the contentOnly lock and hold the Layers lock with it.
    framed("contentOnly");
    registerBlocks(
      [
        {
          ...base,
          name: "acme/row",
          editor: { label: "Row" },
          props: {},
          slots: {
            children: { lock: "all", defaultBlock: [{ type: "acme/text" }] },
          },
        },
      ] as never,
      { source: "inspector-test-row" }
    );
    const text = {
      id: "t",
      type: "acme/text",
      version: 1,
      props: {},
    } as BlockNode;
    const page = documentOf([
      {
        id: "row",
        type: "acme/row",
        version: 1,
        props: {},
        slots: { children: [text] },
      } as BlockNode,
    ]);
    const composed = documentOf([
      {
        id: "cx-frame",
        type: "acme/frame",
        version: 1,
        props: {},
        slots: { children: [text] },
      } as BlockNode,
    ]);

    // CONTROL: the page alone says the arrangement lock.
    expect(lockStatusOf(page, "t").slot?.lock).toBe("all");
    const status = lockStatusOf(page, "t", { composed });
    expect(designIsWritable(page, "t", { composed })).toBe(false);
    expect(status.slot).toMatchObject({ lock: "contentOnly", holder: "Frame" });
    expect(layersLockChangeable(status)).toBe(false);
  });
});

describe("what the card shows", () => {
  it("carries the block's own description and icon from its definition", () => {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/quote",
          description: "A quotation with its source.",
          editor: { label: "Quote", icon: "quote" },
          props: {},
        },
      ] as never,
      { source: "inspector-test" }
    );
    const doc = documentOf([
      { id: "q", type: "acme/quote", version: 1, props: {} } as BlockNode,
    ]);
    const inspection = inspectSelection(doc, "q");
    expect(inspection?.description).toBe("A quotation with its source.");
    expect(inspection?.icon).toBe("quote");
  });

  it("leaves the icon unset for a block that names none", () => {
    const inspection = inspectSelection(withHeading(), "a");
    expect(inspection?.icon).toBeUndefined();
    expect(inspection?.description).toBe("A block.");
  });
});

describe("a key as an author reads it", () => {
  it("spells colour the one way the editor does", () => {
    // "Color" beside "Colour for Color" and the Colour form: one word,
    // spelled two ways in one panel.
    expect(fieldLabel("color")).toBe("Colour");
    expect(fieldLabel("backgroundColor")).toBe("Background colour");
    expect(fieldLabel("linkColorHover")).toBe("Link colour hover");
    // A word only containing the letters is left alone.
    expect(fieldLabel("colorful")).toBe("Colorful");
  });
});

describe("which choices a block's inspector offers", () => {
  /** A button-like block: a link, an entry link, and what it acts as. */
  function withButton(props: Record<string, unknown>) {
    // Registered afresh for each document a case builds.
    clearBlocks();
    registerBlocks(
      [
        {
          ...base,
          name: "acme/button",
          editor: { label: "Button" },
          props: {
            href: { type: "url" },
            entryCollection: { type: "text" },
            entryId: { type: "text" },
            type: {
              type: "select",
              options: ["button", "submit", "reset"],
              onlyWithout: ["href", ["entryCollection", "entryId"]],
            },
            as: { type: "select", options: ["div"] },
          },
        },
      ] as never,
      { source: "inspector-test" }
    );
    return documentOf([
      { id: "b", type: "acme/button", version: 1, props } as BlockNode,
    ]);
  }
  /** The props the inspector draws a control for. */
  const names = (document: BlockDocument) =>
    inspectSelection(document, "b")
      ?.props.filter(prop => prop.offered)
      .map(prop => prop.name);

  it("leaves out a prop that only applies without another, once that one is set", () => {
    // "Acts as" means nothing on a button that is a link.
    expect(names(withButton({}))).toContain("type");
    expect(names(withButton({ href: "/pricing" }))).not.toContain("type");
  });

  it("leaves it out once any of the props it applies without is set", () => {
    // An entry link is as much a link as a typed URL, once it names both the
    // collection and the entry: the renderer resolves no link from half of one.
    expect(
      names(withButton({ entryCollection: "pages", entryId: "e1" }))
    ).not.toContain("type");
    expect(names(withButton({ entryId: "e1" }))).toContain("type");
  });

  it("counts a link as set only when it is one a page can follow", () => {
    // A refused URL renders no link, so the button is still a button.
    expect(names(withButton({ href: "javascript:alert(1)" }))).toContain(
      "type"
    );
    expect(names(withButton({ href: "   " }))).toContain("type");
  });

  it("leaves out a choice with only one option, which offers nothing to pick", () => {
    expect(names(withButton({}))).not.toContain("as");
    expect(names(withButton({ as: "div" }))).not.toContain("as");
  });

  it("keeps a one-option choice whose stored value is not that option, so it can be repaired", () => {
    // An imported `section` still renders; the choice is how it goes back.
    expect(names(withButton({ as: "section" }))).toContain("as");
  });

  it("still lists a left-out prop, so a component can expose it", () => {
    const type = inspectSelection(
      withButton({ href: "/pricing" }),
      "b"
    )?.props.find(prop => prop.name === "type");
    expect(type?.offered).toBe(false);
  });
});
