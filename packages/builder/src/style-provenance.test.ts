import {
  compilePageCss,
  nodeClassName,
  type BlockDocument,
  type NodeStyles,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { styleProvenance, type StyleProvenanceQuery } from "./style-provenance";

/** One declaration the compiler wrote, with the fields the trace records. */
function entry(over: Partial<StyleTraceEntry> = {}): StyleTraceEntry {
  return {
    origin: { kind: "node", id: "n1" },
    property: "margin-block-end",
    value: "24px",
    state: "base",
    breakpoint: "desktop",
    ...over,
  };
}

/** Asking about `n1`'s bottom margin at the desktop breakpoint. */
function query(
  trace: readonly StyleTraceEntry[],
  over: Partial<StyleProvenanceQuery> = {}
): StyleProvenanceQuery {
  return {
    trace,
    subject: { nodeId: "n1", classIds: ["c1"] },
    cssProperty: "margin-block-end",
    state: "base",
    breakpoint: "desktop",
    liveBreakpoints: ["desktop"],
    ...over,
  };
}

describe("a property nothing wrote", () => {
  it("is unset, which is a real answer rather than a failure", () => {
    expect(styleProvenance(query([]))).toEqual({ kind: "unset" });
  });

  it("is unset when the trace holds only OTHER properties", () => {
    // The separating property against a dot that lit up for any trace entry at
    // all: a node with a colour and no margin must show an empty margin dot.
    const trace = [entry({ property: "color", value: "red" })];
    expect(styleProvenance(query(trace)).kind).toBe("unset");
  });
});

describe("a value this node authored at the position being edited", () => {
  it("is authored, which is the control's own value", () => {
    const result = styleProvenance(query([entry()]));
    expect(result.kind).toBe("authored");
  });

  it("is INHERITED when the same node wrote it at another breakpoint", () => {
    // The case the three-state answer exists for. A desktop value showing while
    // the author edits mobile is not this control's own value, and a dot that
    // said otherwise would invite editing mobile through a control that then
    // silently changes desktop.
    const trace = [entry()];
    const result = styleProvenance(
      query(trace, {
        breakpoint: "mobile",
        liveBreakpoints: ["desktop", "mobile"],
      })
    );
    expect(result.kind).toBe("inherited");
  });

  it("shows an interaction state the base value it is displaying", () => {
    // Hovering a node whose colour is set only on base displays that colour, so
    // a hover control reporting `unset` would claim the browser's own default
    // applies — which is not what the author is looking at. The base entry
    // reaches this control the same way a wider breakpoint's value does.
    const trace = [entry({ state: "base" })];
    const result = styleProvenance(query(trace, { state: "hover" }));
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.entry.state).toBe("base");
  });

  it("prefers the state's OWN value over the base one", () => {
    // The control for the fallback: it must not shadow a value the state holds.
    const trace = [entry({ state: "base" }), entry({ state: "hover" })];
    const result = styleProvenance(query(trace, { state: "hover" }));
    expect(result.kind).toBe("authored");
    if (result.kind !== "authored") return;
    expect(result.entry.state).toBe("hover");
  });

  it("is still unset when neither the state nor base wrote anything", () => {
    expect(styleProvenance(query([], { state: "hover" })).kind).toBe("unset");
  });

  it("does not fall back from base to anywhere", () => {
    // Base has nothing beneath it, so an empty answer there is genuinely the
    // browser's default — the meaning `unset` carries.
    const trace = [entry({ state: "hover" })];
    expect(styleProvenance(query(trace, { state: "base" })).kind).toBe("unset");
  });

  it("is not authored when the winning entry belongs to a DIFFERENT node", () => {
    const trace = [entry({ origin: { kind: "node", id: "other" } })];
    expect(styleProvenance(query(trace)).kind).not.toBe("authored");
  });
});

describe("a value from another tier", () => {
  it("names the class it came from, with the id a panel opens it by", () => {
    const trace = [
      entry({ origin: { kind: "class", id: "c1", slug: "card" } }),
    ];
    const result = styleProvenance(query(trace));
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.from).toEqual({ kind: "class", id: "c1", slug: "card" });
  });

  it("reports a block type's default as inherited", () => {
    const trace = [entry({ origin: { kind: "blockType", type: "heading" } })];
    expect(
      styleProvenance(
        query(trace, { subject: { nodeId: "n1", blockType: "heading" } })
      ).kind
    ).toBe("inherited");
  });

  it("prefers the node's own value over a class's, as the cascade does", () => {
    // Order in the trace is emission order, and the node tier is emitted last.
    const trace = [
      entry({ origin: { kind: "class", id: "c1", slug: "card" } }),
      entry(),
    ];
    expect(styleProvenance(query(trace)).kind).toBe("authored");
  });
});

describe("matching the property", () => {
  it("matches the CSS property the trace records, not the catalog key", () => {
    // `margin` is the catalog key and `margin-block-end` is what was written.
    // Asking with the catalog key finds nothing, which is why the query takes
    // the leaf's own `cssProperty`.
    expect(
      styleProvenance(query([entry()], { cssProperty: "margin" })).kind
    ).toBe("unset");
    expect(styleProvenance(query([entry()])).kind).toBe("authored");
  });
});

describe("against a trace the compiler actually produced", () => {
  // The fixtures above are hand-written, and a hand-written descendant is
  // whatever this file believes the compiler emits. It emits the selector as
  // GROUPED — `" a"`, with the leading combinator — while the catalog declares
  // `"a"`. Comparing those two spellings directly matches nothing, and a
  // fixture that mirrors the wrong belief agrees with itself.
  //
  // So these compile a real document and query the trace it returns.

  /** The trace `compilePageCss` records for one node's styles. */
  function traceFor(styles: NodeStyles): readonly StyleTraceEntry[] {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/box", version: 1, props: {}, styles }],
    };
    const compiled = compilePageCss(document, {
      breakpoints: {
        viewport: [{ id: "base", label: "Desktop" }],
        container: [],
      },
      trace: true,
    });
    expect(compiled.warnings).toEqual([]);
    return compiled.trace ?? [];
  }

  /** Asking about `n1` at the base state and breakpoint. */
  function ask(
    trace: readonly StyleTraceEntry[],
    cssProperty: string,
    descendant?: string
  ) {
    return styleProvenance({
      trace,
      subject: { nodeId: "n1" },
      cssProperty,
      ...(descendant === undefined ? {} : { descendant }),
      state: "base",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
  }

  it("records the descendant WITH its combinator, which is why comparison normalizes", () => {
    // The measurement this whole block exists for, pinned so a change to the
    // compiler's spelling fails here rather than silently in every dot.
    const trace = traceFor({ base: { base: { linkColor: "#ff0000" } } });
    expect(trace.map(entry => entry.descendant)).toEqual([" a"]);
    expect(nodeClassName("n1")).toBeTypeOf("string");
  });

  it("finds a link colour asked for by the catalog's own spelling", () => {
    const trace = traceFor({ base: { base: { linkColor: "#ff0000" } } });
    expect(ask(trace, "color", "a").kind).toBe("authored");
  });

  it("keeps the three colour controls apart on a real trace", () => {
    const trace = traceFor({
      base: {
        base: {
          color: "#0000ff",
          linkColor: "#ff0000",
          linkColorHover: "#00ff00",
        },
      },
    });
    expect(ask(trace, "color").kind).toBe("authored");
    expect(ask(trace, "color", "a").kind).toBe("authored");
    expect(ask(trace, "color", "a:hover").kind).toBe("authored");
    // Each control reads its OWN declaration rather than a shared winner.
    const plain = ask(trace, "color");
    const link = ask(trace, "color", "a");
    expect(plain.kind === "authored" && plain.entry.value).toBe("#0000ff");
    expect(link.kind === "authored" && link.entry.value).toBe("#ff0000");
  });

  it("reports a text colour as unset when only the link colour is stored", () => {
    // The defect the descendant filter exists for, on a real trace: without it
    // the link rule wins the plain control and reports an unset one as authored.
    const trace = traceFor({ base: { base: { linkColor: "#ff0000" } } });
    expect(ask(trace, "color").kind).toBe("unset");
  });

  it("reports a hover link as unset when only the plain link is stored", () => {
    const trace = traceFor({ base: { base: { linkColor: "#ff0000" } } });
    expect(ask(trace, "color", "a:hover").kind).toBe("unset");
  });
});

describe("two catalog properties writing one declaration", () => {
  // `background.url` and `backgroundGradient` both emit `background-image` on
  // the node itself, and the trace records neither's catalog identity. Which
  // control wrote the winning declaration therefore cannot be told from it.

  it("says so rather than attributing the value to one of them", () => {
    const trace: readonly StyleTraceEntry[] = [
      {
        origin: { kind: "node", id: "n1" },
        property: "background-image",
        value: "linear-gradient(red, blue)",
        state: "base",
        breakpoint: "base",
      },
    ];
    const result = styleProvenance({
      trace,
      subject: { nodeId: "n1" },
      cssProperty: "background-image",
      state: "base",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.sharedWith).toEqual(
      expect.arrayContaining(["background", "backgroundGradient"])
    );
  });

  it("does not call an ordinary property ambiguous", () => {
    // The negative control: a check that answered "ambiguous" for everything
    // would satisfy the assertion above while telling a caller nothing.
    expect(styleProvenance(query([entry()])).kind).toBe("authored");
  });

  it("is unset rather than ambiguous when nothing wrote the declaration", () => {
    // Ambiguity is about attributing a WINNER. With no winner there is nothing
    // to attribute, and "unset" is the honest answer.
    const result = styleProvenance({
      trace: [],
      subject: { nodeId: "n1" },
      cssProperty: "background-image",
      state: "base",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
    expect(result.kind).toBe("unset");
  });
});

describe("ranking a base rule against an interaction rule", () => {
  // A state selector is wrapped in `:where()`, which adds NO specificity — so a
  // base rule emitted LATER beats an earlier interaction rule. Measured: a
  // class's hover colour followed by the node's base colour leaves the node's
  // base colour showing while hovered.

  it("reports the value the browser is showing, not the earlier hover rule", () => {
    const trace = [
      entry({
        state: "hover",
        origin: { kind: "class", id: "c1", slug: "card" },
        value: "#ff0000",
      }),
      entry({ state: "base", value: "#0000ff" }),
    ];
    const result = styleProvenance(query(trace, { state: "hover" }));
    // Inherited rather than authored: the winner is the node's BASE entry, and
    // the control being asked about is hover.
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.entry.value).toBe("#0000ff");
    expect(result.entry.state).toBe("base");
  });

  it("keeps the hover rule when IT is the later one", () => {
    // The control: always preferring base would be the same defect mirrored.
    const trace = [
      entry({ state: "base", value: "#0000ff" }),
      entry({ state: "hover", value: "#ff0000" }),
    ];
    const result = styleProvenance(query(trace, { state: "hover" }));
    expect(result.kind).toBe("authored");
    if (result.kind !== "authored") return;
    expect(result.entry.value).toBe("#ff0000");
  });
});

describe("several interaction states matching at once", () => {
  // A pressed pointer matches `:active` AND `:hover`. Both are wrapped in
  // `:where()`, so neither outranks the other and emission order decides — a
  // winner can therefore come from a state other than the one being edited.

  it("reports a later hover rule while the active state is being edited", () => {
    const trace = [
      entry({
        state: "active",
        origin: { kind: "class", id: "c1", slug: "card" },
        value: "#00ff00",
      }),
      entry({ state: "hover", value: "#ff0000" }),
    ];
    const result = styleProvenance(
      query(trace, { state: "active", liveStates: ["active", "hover"] })
    );
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.entry.value).toBe("#ff0000");
    expect(result.entry.state).toBe("hover");
  });

  it("keeps the active rule when IT is the later one", () => {
    // The control: ranking must not simply prefer whichever state is listed
    // last, or the answer would depend on the caller's array order.
    const trace = [
      entry({ state: "hover", value: "#ff0000" }),
      entry({ state: "active", value: "#00ff00" }),
    ];
    const result = styleProvenance(
      query(trace, { state: "active", liveStates: ["active", "hover"] })
    );
    expect(result.kind).toBe("authored");
    if (result.kind !== "authored") return;
    expect(result.entry.value).toBe("#00ff00");
  });

  it("ignores a state the caller did not say was matching", () => {
    // Without `liveStates`, only the edited state and base match — a hover rule
    // is not showing while nothing is hovered.
    const trace = [entry({ state: "hover", value: "#ff0000" })];
    expect(styleProvenance(query(trace, { state: "active" })).kind).toBe(
      "unset"
    );
  });
});
