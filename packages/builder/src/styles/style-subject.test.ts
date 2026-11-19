import { MAX_CLASSES_PER_NODE, type BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { styleSubjectFor } from "./style-subject";

/**
 * A tree three deep with a class on each level and DIFFERENT block types, so no
 * assertion below can pass by coincidence: an implementation that returned the
 * wrong node, dropped a level or reversed the chain would land on the same
 * answer for a flat document of identical nodes.
 */
function document(): BlockNode[] {
  return [
    {
      id: "outer",
      type: "core/section",
      version: 1,
      props: {},
      classes: ["c-outer"],
      slots: {
        main: [
          {
            id: "middle",
            type: "core/box",
            version: 1,
            props: {},
            classes: ["c-middle"],
            slots: {
              main: [
                {
                  id: "leaf",
                  type: "core/heading",
                  version: 1,
                  props: {},
                  classes: ["c-leaf-a", "c-leaf-b"],
                },
              ],
            },
          },
        ],
      },
    },
    { id: "sibling", type: "core/text", version: 1, props: {} },
  ];
}

describe("the subject a provenance question is asked about", () => {
  it("carries the node's own id, type and classes", () => {
    const subject = styleSubjectFor(document(), "leaf");
    expect(subject?.nodeId).toBe("leaf");
    expect(subject?.blockType).toBe("core/heading");
    expect(subject?.classIds).toEqual(["c-leaf-a", "c-leaf-b"]);
  });

  it("lists the ancestors OUTERMOST first", () => {
    /*
     * The order the engine documents, and the opposite of what walking up
     * produces. A reversed chain still contains every ancestor, so a test that
     * only checked membership would pass against it — and `styleOrigin` reads
     * the order to rank two ancestors' descendant rules against each other.
     */
    const subject = styleSubjectFor(document(), "leaf");
    expect(subject?.ancestors?.map(one => one.nodeId)).toEqual([
      "outer",
      "middle",
    ]);
  });

  it("carries each ancestor's own type and classes, not just its id", () => {
    // A descendant rule can come from a class on an ancestor or from that
    // ancestor's block type, so an id alone loses two of the three tiers.
    const subject = styleSubjectFor(document(), "leaf");
    expect(subject?.ancestors?.[0]).toEqual({
      nodeId: "outer",
      blockType: "core/section",
      classIds: ["c-outer"],
    });
  });

  it("omits classIds entirely for a node applying none", () => {
    // Absent and empty are the same answer said twice, and the engine reads the
    // field as optional.
    const subject = styleSubjectFor(document(), "sibling");
    expect(subject).toEqual({
      nodeId: "sibling",
      blockType: "core/text",
      ancestors: [],
    });
    expect("classIds" in subject!).toBe(false);
  });

  it("gives a top-level node an empty chain rather than no chain", () => {
    const subject = styleSubjectFor(document(), "outer");
    expect(subject?.ancestors).toEqual([]);
  });

  it.each([
    ["a bare string", "card"],
    ["a number", 7],
    ["an object", { card: true }],
  ])("ignores `classes` stored as %s", (_label, classes) => {
    /*
     * A stored document is untrusted, and the compiler treats a `classes` that
     * is not an array of strings as referencing no classes at all.
     *
     * The bare-string case is the one that bites rather than merely being
     * untidy: `styleOrigin` tests membership with `.includes(origin.id)`, which a
     * STRING answers too — by substring. A node storing `"card-primary"` would
     * report `.card` as the winning origin for a class the canvas emitted no
     * token for.
     */
    const nodes = [
      { id: "n", type: "core/box", version: 1, props: {}, classes },
    ] as unknown as BlockNode[];
    const subject = styleSubjectFor(nodes, "n");
    expect(subject).toBeDefined();
    expect("classIds" in subject!).toBe(false);
  });

  it("skips ONE malformed member instead of voiding the whole list", () => {
    /*
     * The compiler skips what it cannot read and applies the rest, and this has
     * to agree with it or the panel describes a different element than the one
     * on screen.
     *
     * An earlier version required EVERY member to be a string and dropped them
     * all otherwise. One bad entry — a forgiving import, a hand edit — then
     * turned a block whose canvas plainly shows `.card` winning into one whose
     * every class-sourced value reported as set by nobody.
     *
     * Asserted on both halves: the good member survives AND the bad one does
     * not, so neither "kept everything" nor "kept nothing" satisfies this.
     */
    const nodes = [
      {
        id: "n",
        type: "core/box",
        version: 1,
        props: {},
        classes: ["cls-1", 3, "cls-2"],
      },
    ] as unknown as BlockNode[];

    expect(styleSubjectFor(nodes, "n")?.classIds).toEqual(["cls-1", "cls-2"]);
  });

  it("reads to the compiler's cap BY INDEX, counting malformed members", () => {
    /*
     * The other direction, and the reason the cap is taken before the filter
     * rather than after. The compiler's window is `min(stored.length,
     * MAX_CLASSES_PER_NODE)` over the RAW array, so a malformed member consumes
     * a slot. Filtering first would slide a later class into the window and let
     * the panel report a class whose token the canvas never emitted.
     *
     * Built with a non-string at the front so the two orders give different
     * answers: capped-then-filtered ends at `cls-62`, filtered-then-capped would
     * reach `cls-63`.
     */
    const classes: unknown[] = [
      7,
      ...Array.from({ length: MAX_CLASSES_PER_NODE }, (_, i) => `cls-${i}`),
    ];
    const nodes = [
      { id: "n", type: "core/box", version: 1, props: {}, classes },
    ] as unknown as BlockNode[];

    const ids = styleSubjectFor(nodes, "n")?.classIds;

    expect(ids).toHaveLength(MAX_CLASSES_PER_NODE - 1);
    expect(ids).toContain(`cls-${MAX_CLASSES_PER_NODE - 2}`);
    expect(ids).not.toContain(`cls-${MAX_CLASSES_PER_NODE - 1}`);
  });

  it("keeps a well-formed class list, which is the point of checking", () => {
    // The control. Refusing every shape would satisfy the cases above and take
    // the "Inherited from .card" answer with it.
    const nodes = [
      {
        id: "n",
        type: "core/box",
        version: 1,
        props: {},
        classes: ["cls-1", "cls-2"],
      },
    ] as unknown as BlockNode[];
    expect(styleSubjectFor(nodes, "n")?.classIds).toEqual(["cls-1", "cls-2"]);
  });

  it("answers undefined for a node the document does not hold", () => {
    /*
     * A real answer rather than a failure: a selection outlives the node it
     * names on an undo, and a caller handed an empty subject instead would ask
     * about a node that is not there and be told every control is unset.
     */
    expect(styleSubjectFor(document(), "gone")).toBeUndefined();
  });
});
