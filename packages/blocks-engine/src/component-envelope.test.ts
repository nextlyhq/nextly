/**
 * What a component definition's envelope must satisfy.
 *
 * Every assertion here is written against a definition that LOADS. None of
 * these faults throws, none is visible in the tree, and each produces the same
 * downstream symptom — an author edits an exposed property and nothing changes
 * on the page — reached from a different cause. A test asserting only that a
 * well-formed envelope validates would pass on all of them.
 *
 * The pointers are the subject rather than the shapes, because a pointer is
 * the only part of this envelope that can be broken by editing something else.
 * Deleting a node, renaming a slot or removing an exposure leaves the
 * definition well formed and the reference dangling.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import { isUnsetOverride } from "./document";
import type { ValidationContext } from "./validation";
import { validate } from "./validation";

/** A container node with one named slot, so slot pointers have a target. */
function container(id: string, slot = "children"): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: { heading: "Hello" },
    slots: { [slot]: [] },
  };
}

/** A component document carrying whatever envelope the caller is testing. */
function componentDoc(envelope: Record<string, unknown>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [container("box")],
    ...envelope,
  } as BlockDocument;
}

/**
 * The validation context these cases run under.
 *
 * One helper rather than an object literal per call, because `mode` is the only
 * field any of them varies and the rest are required: literals let one call
 * site drift from the next, and the compiler is the only thing that notices —
 * which vitest alone does not run.
 */
const context = (mode: "strict" | "forgiving"): ValidationContext => ({
  breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
  mode,
});

const issuesFrom = (
  doc: BlockDocument,
  mode: "strict" | "forgiving" = "strict"
) => validate(doc, context(mode));

const codesFrom = (
  doc: BlockDocument,
  mode: "strict" | "forgiving" = "strict"
) => issuesFrom(doc, mode).map(issue => issue.code);

/** One well-formed exposure, which every negative case below mutates. */
const goodExposure = {
  id: "heading",
  label: "Heading",
  nodeId: "box",
  propPath: "heading",
  type: "text",
};

describe("a component's exposed properties must resolve", () => {
  it("accepts an exposure pointing at a node in its own tree", () => {
    // The positive control. Every refusal below is equally satisfied by a
    // validator that refuses every component document, and this is the only
    // assertion that can tell the two apart.
    expect(codesFrom(componentDoc({ exposed: [goodExposure] }))).toEqual([]);
  });

  it("accepts a component that exposes nothing at all", () => {
    // A locked, reusable block — a footer nobody may edit — is a legitimate
    // definition, not an incomplete one.
    expect(codesFrom(componentDoc({}))).toEqual([]);
  });

  it("refuses an exposure whose node is not in the document", () => {
    // The named failure this row exists to close. The definition renders, the
    // inspector offers the property, and writing it stores an override keyed
    // to a pointer that resolves to nothing — on every instance in the site.
    const issues = issuesFrom(
      componentDoc({ exposed: [{ ...goodExposure, nodeId: "deleted" }] })
    );

    expect(issues.map(i => i.code)).toEqual(["exposed-node-missing"]);
    // The message has to name the node, because the author is looking at a
    // list of exposures that all look alike.
    expect(issues[0].message).toContain("deleted");
    expect(issues[0].path).toBe("/exposed/0/nodeId");
  });

  it("refuses a dangling pointer in forgiving mode too", () => {
    // Forgiving mode keeps a document READABLE when a newer build wrote
    // something this one does not understand. A pointer into this document's
    // own tree is not a future value, so tolerating it would only delay the
    // report to the moment an author cannot explain it.
    expect(
      codesFrom(
        componentDoc({ exposed: [{ ...goodExposure, nodeId: "deleted" }] }),
        "forgiving"
      )
    ).toEqual(["exposed-node-missing"]);
  });

  it("refuses a prop path that is not a field chain", () => {
    expect(
      codesFrom(
        componentDoc({ exposed: [{ ...goodExposure, propPath: "a.b()" }] })
      )
    ).toEqual(["exposed-path-invalid"]);
  });

  it("reports only the id when an exposure has none", () => {
    // An entry with no usable id cannot be NAMED, and every other message about
    // it reads `Exposed property "<id>"`. Without stopping, the author gets
    // three more issues all describing a property called "undefined", and the
    // one telling them what to do is buried among them. The nodeId and prop
    // path below are both broken on purpose: they are the messages that must
    // not appear.
    const issues = issuesFrom(
      componentDoc({
        exposed: [{ label: "Heading", nodeId: "deleted", propPath: "a.b()" }],
      })
    );

    expect(issues.map(i => i.code)).toEqual(["exposed-property-invalid"]);
    expect(JSON.stringify(issues)).not.toContain("undefined");
  });

  it("refuses two exposures sharing one id", () => {
    // An override addresses an exposure by id, so a duplicate makes the pair
    // unaddressable rather than merely untidy.
    expect(
      codesFrom(
        componentDoc({
          exposed: [goodExposure, { ...goodExposure, propPath: "other" }],
        })
      )
    ).toContain("exposed-duplicate-id");
  });

  it("refuses an unknown exposure type", () => {
    expect(
      codesFrom(
        componentDoc({ exposed: [{ ...goodExposure, type: "colour" }] })
      )
    ).toEqual(["exposed-property-invalid"]);
  });
});

describe("a select exposure carries the choices it offers", () => {
  it("refuses a select with no options", () => {
    // A select with nothing to choose reads to an author as a broken editor
    // rather than as an unfinished definition.
    expect(
      codesFrom(
        componentDoc({ exposed: [{ ...goodExposure, type: "select" }] })
      )
    ).toEqual(["exposed-options-invalid"]);
  });

  it("refuses options on an exposure that is not a select", () => {
    // Dead configuration: the inspector never reads it, so nothing would ever
    // report that the author's choices are not being offered.
    expect(
      codesFrom(
        componentDoc({
          exposed: [{ ...goodExposure, options: [{ value: "a", label: "A" }] }],
        })
      )
    ).toEqual(["exposed-options-invalid"]);
  });

  it("accepts a select that names its options", () => {
    expect(
      codesFrom(
        componentDoc({
          exposed: [
            {
              ...goodExposure,
              type: "select",
              options: [{ value: "a", label: "A" }],
            },
          ],
        })
      )
    ).toEqual([]);
  });
});

describe("a component's exposed slots must resolve", () => {
  const goodSlot = {
    label: "Body",
    nodeId: "box",
    slot: "children",
  };

  it("cannot represent two slots sharing one id", () => {
    // Not a validation rule — a shape fact. The slot id IS the key of the map,
    // so a duplicate cannot be written down. This is pinned because the
    // alternative shape (a record whose values also carry an `id`) states the
    // identity twice and lets the two disagree, and only a test naming the
    // guarantee explains why the field is absent.
    const doc = componentDoc({
      slots: { body: goodSlot, other: { ...goodSlot, label: "Other" } },
    }) as unknown as { slots: Record<string, object> };

    expect(Object.keys(doc.slots)).toEqual(["body", "other"]);
    expect(doc.slots.body).not.toHaveProperty("id");
  });

  it("accepts a slot naming a region its node declares", () => {
    expect(codesFrom(componentDoc({ slots: { body: goodSlot } }))).toEqual([]);
  });

  it("refuses a slot whose node is not in the document", () => {
    expect(
      codesFrom(
        componentDoc({ slots: { body: { ...goodSlot, nodeId: "gone" } } })
      )
    ).toEqual(["exposed-node-missing"]);
  });

  it("refuses a slot the node does not declare", () => {
    // The node exists and the definition still loads. This is what a renamed
    // container leaves behind, and it is invisible in the tree.
    const issues = issuesFrom(
      componentDoc({ slots: { body: { ...goodSlot, slot: "renamed" } } })
    );

    expect(issues.map(i => i.code)).toEqual(["exposed-slot-missing"]);
    // Names what the node DOES declare, since the author's next question is
    // "then what is it called".
    expect(issues[0].suggestion).toContain("children");
  });
});

describe("a variant may only preset what the component exposes", () => {
  it("accepts a variant overriding an exposed property", () => {
    expect(
      codesFrom(
        componentDoc({
          exposed: [goodExposure],
          variants: {
            compact: { label: "Compact", overrides: { heading: "Hi" } },
          },
        })
      )
    ).toEqual([]);
  });

  it("refuses a variant overriding something nothing exposes", () => {
    // Selecting the variant would change nothing, and the definition would
    // look broken rather than misconfigured.
    expect(
      codesFrom(
        componentDoc({
          exposed: [goodExposure],
          variants: {
            compact: { label: "Compact", overrides: { missing: "x" } },
          },
        })
      )
    ).toEqual(["variant-unknown-target"]);
  });

  it("accepts a variant filling a slot the component exposes", () => {
    // The control for the refusal below. Without it a validator that treated
    // EVERY slot as unexposed would satisfy that assertion while refusing
    // every legitimate variant — and the slot ids come from the map keys, so
    // "no slot is ever exposed" is a single-line mistake away.
    expect(
      codesFrom(
        componentDoc({
          slots: { body: { label: "Body", nodeId: "box", slot: "children" } },
          variants: {
            compact: { label: "Compact", overrides: {}, slots: { body: [] } },
          },
        })
      )
    ).toEqual([]);
  });

  it("refuses a variant filling a slot nothing exposes", () => {
    expect(
      codesFrom(
        componentDoc({
          slots: {
            body: {
              id: "body",
              label: "Body",
              nodeId: "box",
              slot: "children",
            },
          },
          variants: {
            compact: { label: "Compact", overrides: {}, slots: { other: [] } },
          },
        })
      )
    ).toEqual(["variant-unknown-target"]);
  });
});

describe("the envelope is a component's alone", () => {
  it("does not check exposed pointers on a page document", () => {
    // A page carrying a stray `exposed` field is not a broken component. If
    // this checked every kind, the rules would fire on documents that have no
    // definition semantics at all — and the report would name a fault the
    // author cannot act on.
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [container("box")],
      exposed: [{ ...goodExposure, nodeId: "deleted" }],
    } as unknown as BlockDocument;

    expect(codesFrom(page)).toEqual([]);
  });
});

describe("an override distinguishes clearing from inheriting", () => {
  // The whole reason the sentinel is an object. An author clearing a subtitle
  // the definition fills in needs a third state: absent inherits, this clears,
  // anything else replaces. Every primitive an author might otherwise mean is
  // a legitimate value for some exposed property, so a sentinel that collided
  // with one could not be told apart from it later.
  it("recognises the unset sentinel", () => {
    expect(isUnsetOverride({ $unset: true })).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["null", null],
    ["zero", 0],
    ["false", false],
    ["a plain object", { text: "hi" }],
    ["a lookalike whose flag is false", { $unset: false }],
    ["a lookalike whose flag is a string", { $unset: "true" }],
  ])("does not mistake %s for it", (_label, value) => {
    expect(isUnsetOverride(value)).toBe(false);
  });
});
