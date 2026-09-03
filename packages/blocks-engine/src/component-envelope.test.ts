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

  it("refuses a variant that carries slot content", () => {
    // The format does not carry it. A variant's slot content is a second node
    // forest, and the one place a forest is checked — for malformed nodes,
    // duplicate ids, depth and node count — is the walk over `nodes`. Accepting
    // it here would store an unchecked tree under the name of a validated
    // document, so it is refused until it lands with the resolver that inlines
    // it and can be walked by the same machinery.
    const issues = issuesFrom(
      componentDoc({
        slots: { body: { label: "Body", nodeId: "box", slot: "children" } },
        variants: {
          compact: { label: "Compact", overrides: {}, slots: { body: [] } },
        },
      })
    );

    expect(issues.map(i => i.code)).toEqual(["component-envelope-invalid"]);
    expect(issues[0].path).toBe("/variants/compact/slots");
  });
});

describe("a variant states what a picker and a resolver need", () => {
  it("refuses a variant with no label", () => {
    // The picker renders the label. Without one it offers a row reading
    // "undefined", which is indistinguishable from a rendering bug.
    expect(
      codesFrom(componentDoc({ variants: { compact: { overrides: {} } } }))
    ).toEqual(["component-envelope-invalid"]);
  });

  it("refuses a variant with no overrides map", () => {
    // A variant is a preset. One that presets nothing is a control that does
    // nothing when chosen, which is a defect in the definition rather than a
    // variant with no opinions — and it leaves resolution with no map to read.
    expect(
      codesFrom(componentDoc({ variants: { compact: { label: "Compact" } } }))
    ).toEqual(["component-envelope-invalid"]);
  });
});

describe("an exposed slot states what the layers panel needs", () => {
  const at = { nodeId: "box", slot: "children" };

  it("refuses a slot with no label", () => {
    expect(codesFrom(componentDoc({ slots: { body: at } }))).toEqual([
      "component-envelope-invalid",
    ]);
  });

  it("refuses an allow list that is a bare string", () => {
    // Iterated character by character, a string permits nothing and reports
    // nothing — the slot silently accepts no block at all.
    expect(
      codesFrom(
        componentDoc({
          slots: { body: { ...at, label: "Body", allow: "core/text" } },
        })
      )
    ).toEqual(["component-envelope-invalid"]);
  });

  it.each([
    ["a number", 7],
    ["an empty string", ""],
    ["null", null],
  ])("refuses %s inside the allow list", (_label, bad) => {
    // The array being an array is not the same question as its entries being
    // block types. A list holding a number permits nothing that node could
    // hold, and reports nothing about why.
    const issues = issuesFrom(
      componentDoc({
        slots: { body: { ...at, label: "Body", allow: ["core/text", bad] } },
      })
    );

    expect(issues.map(i => i.code)).toEqual(["component-envelope-invalid"]);
    // Addressed at the entry, not at the list, so a long allow-list names the
    // one entry to fix.
    expect(issues[0].path).toBe("/slots/body/allow/1");
  });

  it("accepts an allow list of block types", () => {
    expect(
      codesFrom(
        componentDoc({
          slots: { body: { ...at, label: "Body", allow: ["core/text"] } },
        })
      )
    ).toEqual([]);
  });

  it("refuses a slot named after an inherited object member", () => {
    // `"toString" in node.slots` is true of every node, so a membership test
    // would pass here and then resolve to nothing — exactly the dangling
    // reference this check exists to refuse.
    expect(
      codesFrom(
        componentDoc({
          slots: { body: { ...at, label: "Body", slot: "toString" } },
        })
      )
    ).toEqual(["exposed-slot-missing"]);
  });
});

describe("every reported path is a resolvable JSON Pointer", () => {
  it("addresses an unknown override one segment at a time", () => {
    // `pointer` escapes its token whole, so one call with "overrides/missing"
    // emits `overrides~1missing` — a pointer that resolves to nothing, in the
    // field whose only purpose is letting a machine find the value.
    const issues = issuesFrom(
      componentDoc({
        exposed: [goodExposure],
        variants: { compact: { label: "C", overrides: { missing: "x" } } },
      })
    );

    expect(issues[0].path).toBe("/variants/compact/overrides/missing");
  });

  it("addresses a bad select option one segment at a time", () => {
    const issues = issuesFrom(
      componentDoc({
        exposed: [{ ...goodExposure, type: "select", options: [{}] }],
      })
    );

    expect(issues[0].path).toBe("/exposed/0/options/0");
  });
});

describe("an instance's override map is a map", () => {
  /** A page holding one component instance with the given props. */
  const pageWithInstance = (props: Record<string, unknown>) =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "nextly/component-instance",
          version: 1,
          props: { componentId: "c1", ...props },
        },
      ],
    }) as unknown as BlockDocument;

  it("accepts an instance that overrides nothing", () => {
    // The ordinary state of a freshly placed component, and the control for
    // the refusals below.
    expect(codesFrom(pageWithInstance({}))).toEqual([]);
  });

  it("accepts a record of overrides", () => {
    expect(
      codesFrom(pageWithInstance({ overrides: { heading: "Hi" } }))
    ).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "heading"],
    ["an array", ["heading"]],
  ])("refuses overrides given as %s", (_label, value) => {
    // A resolver enumerating these either throws, or reads their indices as
    // exposure ids and applies values to properties nobody named.
    expect(codesFrom(pageWithInstance({ overrides: value }))).toEqual([
      "invalid-component-instance",
    ]);
  });
});

describe("an over-limit document does not pay for its envelope", () => {
  it("stops before walking an oversized exposed list", () => {
    // A document the survey could not traverse is refused already. Without the
    // guard an imported definition with a million exposures is walked in full,
    // and appends an issue per entry, to add nothing to a refusal that has
    // already been made.
    const exposed = Array.from({ length: 400 }, (_, i) => ({
      id: `e${i}`,
      label: "L",
      nodeId: "missing",
      propPath: "a",
      type: "text",
    }));
    const doc = {
      formatVersion: 1,
      kind: "component",
      nodes: Array.from({ length: 40 }, (_, i) => ({
        id: `n${i}`,
        type: "core/box",
        version: 1,
        props: {},
      })),
      exposed,
    } as unknown as BlockDocument;

    // Over the node cap, so the survey stops short and the envelope is skipped.
    const overLimit = validate(doc, {
      ...context("strict"),
      limits: { maxDepth: 12, maxNodes: 5, maxBytes: 2_097_152 },
    });
    expect(overLimit.some(i => i.code === "exposed-node-missing")).toBe(false);

    // The control: under the cap the very same document reports every dangling
    // exposure, so the guard is skipping work rather than losing the check.
    const underLimit = validate(doc, context("strict"));
    expect(
      underLimit.filter(i => i.code === "exposed-node-missing")
    ).toHaveLength(400);
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
