import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { applyOp, type BuilderOp } from "./ops";

import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  type StyleAddress,
} from "./style-values";

/** The bottom margin at the base state and breakpoint, the worked example throughout. */
const BOTTOM: StyleAddress = {
  state: "base",
  breakpoint: "desktop",
  property: "margin",
  path: ["blockEnd"],
};

/** A node carrying one authored bottom margin. */
const WITH_MARGIN: NodeStyles = {
  base: { desktop: { margin: { blockEnd: "24px" } } },
};

/** The `styles` a write op carries, for asserting on the resulting envelope. */
function patchedStyles(op: BuilderOp | null): NodeStyles | undefined {
  if (op === null || op.kind !== "update") return undefined;
  return (op.patch as { styles?: NodeStyles }).styles;
}

/** One node carrying the styles under test, in a document `applyOp` accepts. */
function documentWith(styles: NodeStyles | undefined): BlockDocument {
  const node: BlockNode = {
    id: "n1",
    type: "core/box",
    version: 1,
    props: {},
  };
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [styles === undefined ? node : { ...node, styles }],
  };
}

describe("reading a control's value", () => {
  it("reads through the path the descriptor gave it", () => {
    expect(readStyleValue(WITH_MARGIN, BOTTOM)).toBe("24px");
  });

  it("answers undefined where nothing is set, which is a real answer", () => {
    expect(
      readStyleValue(WITH_MARGIN, { ...BOTTOM, path: ["blockStart"] })
    ).toBeUndefined();
    expect(readStyleValue(undefined, BOTTOM)).toBeUndefined();
    expect(
      readStyleValue(WITH_MARGIN, { ...BOTTOM, breakpoint: "mobile" })
    ).toBeUndefined();
    expect(
      readStyleValue(WITH_MARGIN, { ...BOTTOM, state: "hover" })
    ).toBeUndefined();
  });

  it("does not descend into a token reference looking for a side", () => {
    // `{ $token }` is one value spelled as an object. Descending into it would
    // report the token's own key as though it were a box side.
    const tokenised: NodeStyles = {
      base: { desktop: { margin: { $token: "Space.Large" } } },
    };
    expect(readStyleValue(tokenised, BOTTOM)).toBeUndefined();
  });
});

describe("writing a control's value", () => {
  it("produces exactly ONE update op, which is one undo step", () => {
    const result = styleWriteOp("n1", undefined, BOTTOM, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toMatchObject({ kind: "update", id: "n1" });
  });

  it("keeps the siblings a composite already held", () => {
    const both: NodeStyles = {
      base: { desktop: { margin: { blockStart: "8px", blockEnd: "24px" } } },
    };
    const result = styleWriteOp("n1", both, BOTTOM, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(patchedStyles(result.op)).toEqual({
      base: { desktop: { margin: { blockStart: "8px", blockEnd: "32px" } } },
    });
  });

  it("keeps the other properties at the same breakpoint", () => {
    const withHeight: NodeStyles = {
      base: { desktop: { height: "48px", margin: { blockEnd: "24px" } } },
    };
    const result = styleWriteOp("n1", withHeight, BOTTOM, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(patchedStyles(result.op)?.base?.desktop?.height).toBe("48px");
  });

  it("leaves the envelope it was handed untouched", () => {
    // The editor renders from the document it holds, so a write that mutated a
    // nested level would change a value the current render is still showing.
    const before = JSON.stringify(WITH_MARGIN);
    styleWriteOp("n1", WITH_MARGIN, BOTTOM, "32px");
    expect(JSON.stringify(WITH_MARGIN)).toBe(before);
  });

  it("refuses a value the catalog rejects, and says why", () => {
    const result = styleWriteOp("n1", WITH_MARGIN, BOTTOM, "notalength");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every(issue => issue.severity === "error")).toBe(true);
  });

  it("does not re-check the grammar itself — a value the catalog accepts is written", () => {
    // The separating property against a control that carried its own unit list:
    // `rem` is legal and a hand-kept list of units is exactly what omits it.
    const result = styleWriteOp("n1", undefined, BOTTOM, "1.5rem");
    expect(result.ok).toBe(true);
  });
});

describe("clearing a control's value", () => {
  it("removes the entry rather than storing an empty one", () => {
    // A stored empty value pins the property to nothing here and beats the tier
    // the author was asking to see again.
    const result = styleClearOp("n1", WITH_MARGIN, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toMatchObject({ unset: ["styles"] });
  });

  it("keeps a sibling side and the property with it", () => {
    const both: NodeStyles = {
      base: { desktop: { margin: { blockStart: "8px", blockEnd: "24px" } } },
    };
    const result = styleClearOp("n1", both, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(patchedStyles(result.op)).toEqual({
      base: { desktop: { margin: { blockStart: "8px" } } },
    });
  });

  it("prunes the breakpoint when its last property goes", () => {
    const two: NodeStyles = {
      base: {
        desktop: { margin: { blockEnd: "24px" } },
        mobile: { height: "10px" },
      },
    };
    const result = styleClearOp("n1", two, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(patchedStyles(result.op)).toEqual({
      base: { mobile: { height: "10px" } },
    });
  });

  it("prunes the state when its last breakpoint goes", () => {
    const two: NodeStyles = {
      base: { desktop: { margin: { blockEnd: "24px" } } },
      hover: { desktop: { height: "10px" } },
    };
    const result = styleClearOp("n1", two, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(patchedStyles(result.op)).toEqual({
      hover: { desktop: { height: "10px" } },
    });
  });

  it("answers with NO op when the value was not set to begin with", () => {
    // `applyOp` refuses an update that changes nothing, so handing back an op
    // here would advertise one that throws — and resetting an already-unset
    // control is an ordinary thing for an author to do.
    const result = styleClearOp("n1", WITH_MARGIN, {
      ...BOTTOM,
      path: ["blockStart"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toBeNull();
  });

  it("answers with NO op when the node has no styles at all", () => {
    const result = styleClearOp("n1", undefined, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toBeNull();
  });
});

describe("every op this SDK hands back can actually be applied", () => {
  // The property the assertions above cannot reach: they inspect the op's
  // PATCH, and a patch of the right shape still throws at `applyOp` when it
  // changes nothing. Applying it is the only thing that separates the two.

  it("applies a write to a node with no styles", () => {
    const result = styleWriteOp("n1", undefined, BOTTOM, "32px");
    expect(result.ok).toBe(true);
    if (!result.ok || result.op === null) throw new Error("expected an op");
    const applied = applyOp(documentWith(undefined), result.op);
    expect(applied.document.nodes[0].styles).toEqual({
      base: { desktop: { margin: { blockEnd: "32px" } } },
    });
  });

  it("applies a clear that removes the last style", () => {
    const result = styleClearOp("n1", WITH_MARGIN, BOTTOM);
    expect(result.ok).toBe(true);
    if (!result.ok || result.op === null) throw new Error("expected an op");
    const applied = applyOp(documentWith(WITH_MARGIN), result.op);
    expect(applied.document.nodes[0].styles).toBeUndefined();
  });

  it("answers with NO op when the node already holds the value being written", () => {
    // Retyping the value a control already shows. An op here would carry a
    // patch identical to what the node holds, which `applyOp` refuses.
    const result = styleWriteOp("n1", WITH_MARGIN, BOTTOM, "24px");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.op).toBeNull();
  });

  it("throws if a no-op op were handed back, which is why null is", () => {
    // The positive control for the two null answers above: it demonstrates
    // that the refusal being avoided is real, so `toBeNull()` is evidence of
    // something rather than an assertion about an arbitrary choice.
    const noOp: BuilderOp = {
      kind: "update",
      id: "n1",
      patch: { styles: WITH_MARGIN },
    };
    expect(() => applyOp(documentWith(WITH_MARGIN), noOp)).toThrow(
      /changes nothing/
    );
  });
});
