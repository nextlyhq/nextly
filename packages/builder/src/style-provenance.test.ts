import {
  compilePageCss,
  nodeClassName,
  type BlockDocument,
  type BreakpointSet,
  type NodeStyles,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  breakpointBadge,
  styleProvenance,
  type BreakpointBadge,
  type StyleProvenanceQuery,
} from "./style-provenance";

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

  it("shows a hover link the plain-link value it is displaying", () => {
    // A hovered anchor matches `a` as well as `a:hover`, so a hover control
    // with only `linkColor` stored is displaying that rule. Reporting unset
    // would claim the browser's default applies. Link hover lives in the
    // catalog's DESCENDANT rather than in `StyleState`, which is why the
    // interaction-state fallback does not cover it.
    const trace = traceFor({ base: { base: { linkColor: "#ff0000" } } });
    const result = ask(trace, "color", "a:hover");
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.entry.value).toBe("#ff0000");
    expect(result.entry.descendant).toBe(" a");
  });

  it("prefers the hover rule when the document has one", () => {
    const trace = traceFor({
      base: { base: { linkColor: "#ff0000", linkColorHover: "#00ff00" } },
    });
    const result = ask(trace, "color", "a:hover");
    expect(result.kind).toBe("authored");
    if (result.kind !== "authored") return;
    expect(result.entry.value).toBe("#00ff00");
  });

  it("does not show a plain link a rule that needs hovering", () => {
    // The other direction, which must NOT fall back: an anchor that is not
    // hovered does not match `a:hover`.
    const trace = traceFor({ base: { base: { linkColorHover: "#00ff00" } } });
    expect(ask(trace, "color", "a").kind).toBe("unset");
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

describe("a declaration the PAGE wrote", () => {
  const subject = { nodeId: "a", blockType: "acme/box", ancestors: [] };
  const query = (trace: readonly unknown[]) =>
    styleProvenance({
      trace: trace as never,
      subject,
      cssProperty: "padding-top",
      state: "base",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
  const pageEntry = (over: Record<string, unknown> = {}) =>
    ({
      origin: { kind: "page" },
      property: "padding-top",
      value: "8px",
      state: "base",
      breakpoint: "base",
      ...over,
    }) as never;

  it("does NOT reach a block when it lands on the page root alone", () => {
    /*
     * The page's own settings compile onto the page ROOT, so a non-inherited
     * property written there styles that element and nothing inside it. Reported
     * unfiltered, a block control says "Inherited from the page" for a value the
     * browser is not applying to it — and padding is exactly such a property.
     */
    expect(query([pageEntry()]).kind).toBe("unset");
  });

  it("DOES reach a block through a descendant selector", () => {
    /*
     * The separating half. `.page a` styles the links inside, this block's
     * included — the same rule an ancestor's declarations are held to — so
     * filtering every page origin would be as wrong in the other direction.
     */
    const result = styleProvenance({
      trace: [pageEntry({ descendant: " a", property: "color" })] as never,
      subject,
      cssProperty: "color",
      descendant: "a",
      state: "base",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
    expect(result.kind).toBe("inherited");
  });

  it("leaves every other origin alone", () => {
    // The filter is about page origins specifically. A node's own declaration
    // carries no descendant either, and must still be found.
    const own = pageEntry({ origin: { kind: "node", id: "a" } });
    expect(query([own]).kind).toBe("authored");
  });
});

describe("ranking winners from two live states", () => {
  const subject = { nodeId: "a", blockType: "acme/box", ancestors: [] };
  const at = (over: Record<string, unknown>) =>
    ({
      origin: { kind: "node", id: "a" },
      property: "color",
      value: "#111",
      state: "base",
      breakpoint: "base",
      ...over,
    }) as never;

  it("does not let a block DEFAULT's hover outrank a node's own link", () => {
    /*
     * The cross-state comparison ranks through the engine's own weighting.
     * Counting pseudo-classes here was the same answer only while every tier
     * carried one class-worth of prefix, and a default no longer does: it is
     * anchored to a single page-root class with its descendant inside
     * `:where()`, so ` a:hover` weighs `0-1-0` against the node's ` a` at
     * `0-3-1`. The browser shows the node's value; a count names the default.
     *
     * The control addresses the HOVERED link, which is what makes both rules
     * candidates at all: `reachesControl` admits a less-specific descendant and
     * refuses a more-specific one, so a query about plain `a` never sees the
     * `a:hover` entry and the ranking is never reached. Asked that way this case
     * passes against the count it exists to reject.
     */
    const trace = [
      at({
        origin: { kind: "blockType", type: "acme/box" },
        descendant: " a:hover",
        value: "#default",
        state: "base",
      }),
      at({ descendant: " a", value: "#node", state: "hover" }),
    ];
    const result = styleProvenance({
      trace: trace as never,
      subject,
      cssProperty: "color",
      descendant: "a:hover",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
      liveStates: ["hover", "base"],
    });

    // Inherited from the NODE — its plain-link rule is what a hovered link
    // displays here. Ranked by pseudo-class count the default wins instead, and
    // the panel names this block's defaults for a colour they are not applying.
    expect(result.kind).toBe("inherited");
    expect(result.kind === "inherited" && result.entry.value).toBe("#node");
    expect(result.kind === "inherited" && result.from.kind).toBe("node");
  });

  it("prefers descendant SPECIFICITY over emission order", () => {
    /*
     * `styleOrigin` ranks by specificity within ONE state, and is asked once per
     * live state — so across states the comparison lands here, and position
     * alone gets it wrong.
     *
     * A state's rules are wrapped in `:where()`, which contributes NOTHING to
     * specificity. So an EARLIER `a:hover` rule outranks a LATER plain-`a` one
     * however far apart they were emitted, and naming the later one reports a
     * declaration the browser is not showing.
     */
    const trace = [
      at({ descendant: " a:hover", value: "#hover", state: "hover" }),
      at({ descendant: " a", value: "#plain", state: "base" }),
    ];
    const result = styleProvenance({
      trace: trace as never,
      subject,
      cssProperty: "color",
      descendant: "a:hover",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
      liveStates: ["hover"],
    });

    /*
     * The separating property lives in the FIXTURE, not in an assertion: the
     * specific rule is written first above, so an implementation preferring
     * source order returns the other one and the value below differs.
     *
     * An earlier version asserted `trace.indexOf(trace[0])` against
     * `trace.indexOf(trace[1])` to state that ordering. Those are 0 and 1 by
     * definition, for any array and any implementation — a line that cannot
     * fail, which reads as evidence while establishing nothing.
     */
    expect((result as { entry?: { value: string } }).entry?.value).toBe(
      "#hover"
    );
  });

  it("still falls back to emission order at EQUAL specificity", () => {
    // The control. Preferring specificity must not throw away the cascade's own
    // tie-break, which is the later rule.
    const trace = [
      at({ descendant: " a", value: "#first", state: "base" }),
      at({ descendant: " a", value: "#second", state: "hover" }),
    ];
    const result = styleProvenance({
      trace: trace as never,
      subject,
      cssProperty: "color",
      descendant: "a",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
      liveStates: ["hover"],
    });
    expect((result as { entry?: { value: string } }).entry?.value).toBe(
      "#second"
    );
  });
});

describe("a caller that states which states are live", () => {
  const subject = { nodeId: "a", blockType: "acme/box", ancestors: [] };
  const at = (over: Record<string, unknown>) =>
    ({
      origin: { kind: "node", id: "a" },
      property: "color",
      value: "#111",
      state: "base",
      breakpoint: "base",
      ...over,
    }) as never;

  it("does NOT add the edited state back when a set was supplied", () => {
    /*
     * The field's contract: omitting it means the edited state plus base, so
     * stating one is the host ruling states OUT. A canvas simulating only `base`
     * while the panel edits `hover` would otherwise have the hover declaration
     * reported as the visible winner — a value the browser is not showing, which
     * is the exact case the field exists to prevent.
     */
    const result = styleProvenance({
      trace: [at({ state: "hover", value: "#hover" })] as never,
      subject,
      cssProperty: "color",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
      liveStates: ["base"],
    });
    expect(result.kind).toBe("unset");
  });

  it("DOES default to the edited state when none was supplied", () => {
    // The other half of the same contract, and the control: respecting a
    // supplied set must not turn into ignoring the default.
    const result = styleProvenance({
      trace: [at({ state: "hover", value: "#hover" })] as never,
      subject,
      cssProperty: "color",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
    });
    expect(result.kind).toBe("authored");
  });

  it("keeps base live whatever the caller stated", () => {
    // Base rules are not state-gated and match alongside anything else, so they
    // are in play even for a caller that named only an interaction state.
    const result = styleProvenance({
      trace: [at({ state: "base", value: "#base" })] as never,
      subject,
      cssProperty: "color",
      state: "hover",
      breakpoint: "base",
      liveBreakpoints: ["base"],
      liveStates: ["hover"],
    });
    expect(result.kind).toBe("inherited");
  });
});

/** The badge for a query, with the provenance the caller would already hold. */
function badgeFor(
  q: StyleProvenanceQuery,
  set: BreakpointSet | undefined
): BreakpointBadge {
  return breakpointBadge(q, styleProvenance(q), set);
}

describe("the breakpoint dimension of a control's provenance", () => {
  /*
   * A site with both axes, so a badge naming a breakpoint without naming its
   * axis would be ambiguous — which is the case the axis is carried for.
   */
  const site: BreakpointSet = {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 991 },
      { id: "mobile", label: "Mobile", maxWidth: 575 },
    ],
    container: [{ id: "narrow", label: "Narrow card", maxWidth: 400 }],
  };

  it("says nothing when the control is unset", () => {
    expect(badgeFor(query([]), site)).toEqual({ kind: "none" });
  });

  it("names the breakpoint a value was authored at, when it is not this one", () => {
    /*
     * The case the badge exists for. `StyleOrigin` records only the TIER, so
     * this arrives as a bare `node` origin — indistinguishable from a value set
     * right here, which is the one thing an author needs told apart because the
     * next action differs.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "tablet" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["tablet", "mobile"],
      }),
      site
    );

    expect(badge).toEqual({
      kind: "inherited",
      source: {
        breakpoint: "tablet",
        label: "Tablet",
        axis: "viewport",
        selectable: true,
      },
    });
  });

  it("says nothing when the value came from another TIER rather than another breakpoint", () => {
    /*
     * A class's value is the origin dot's answer, and repeating it as a
     * breakpoint badge would say one thing twice in two vocabularies. This is
     * also the control on the case above: without it, a badge that fired on
     * every `inherited` provenance would satisfy that one.
     */
    const badge = badgeFor(
      query(
        [
          entry({
            origin: { kind: "class", id: "c1", slug: "card" },
            breakpoint: "tablet",
          }),
        ],
        {
          breakpoint: "mobile",
          liveBreakpoints: ["tablet", "mobile"],
        }
      ),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("keeps an UNBOUNDED container tier unselectable", () => {
    /*
     * An unbounded container definition has no `maxWidth`, exactly like the
     * unconditional viewport tier — but `offeredTiers` and `widthForBreakpoint`
     * exclude the container axis entirely, so a jump would hand the host
     * `undefined` and release the canvas as though base had been chosen.
     * Sizing a canvas cannot put an element's own query container at a width.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "fluid" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["fluid", "mobile"],
      }),
      {
        viewport: [{ id: "mobile", label: "Mobile", maxWidth: 575 }],
        container: [{ id: "fluid", label: "Fluid" }],
      } as never
    );

    expect(badge).toEqual({
      kind: "inherited",
      source: {
        breakpoint: "fluid",
        label: "Fluid",
        axis: "container",
        selectable: false,
      },
    });
  });

  it("names the CONTAINER axis rather than reporting a bare breakpoint", () => {
    /*
     * `breakpointContexts` emits over both axes and a container context carries
     * a query even at its widest, so two tiers can be in play at once. A label
     * that reads as precise and does not say which axis it means is worse than
     * one that says less.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "narrow" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["narrow", "mobile"],
      }),
      site
    );

    expect(badge).toEqual({
      kind: "inherited",
      source: {
        breakpoint: "narrow",
        label: "Narrow card",
        axis: "container",
        /*
         * NOT selectable, and that is the honest answer: sizing the canvas
         * cannot put an element's own query container at a width. Naming the
         * tier is still right; offering to travel to it is not.
         */
        selectable: false,
      },
    });
  });

  it("reports a value authored HERE as resettable", () => {
    const badge = badgeFor(
      query([entry({ breakpoint: "mobile" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["mobile"],
      }),
      site
    );

    expect(badge).toEqual({ kind: "authored" });
  });

  it("names what a reset would REVEAL, rather than assuming the base tier", () => {
    /*
     * In a desktop-first model values flow wider to narrower and a chain can
     * hold values at several breakpoints, so what shows through is whatever the
     * next one holding a value is — not necessarily base.
     *
     * Computed by asking the same question with this breakpoint out of the live
     * set, which is the engine's own ranking rather than a hand-rolled "next
     * wider" that would have to re-derive tier order, both axes and
     * specificity.
     */
    const badge = badgeFor(
      query(
        [
          entry({ breakpoint: "tablet", value: "16px" }),
          entry({ breakpoint: "mobile", value: "8px" }),
        ],
        { breakpoint: "mobile", liveBreakpoints: ["tablet", "mobile"] }
      ),
      site
    );

    expect(badge).toEqual({
      kind: "authored",
      revealed: {
        breakpoint: "tablet",
        label: "Tablet",
        axis: "viewport",
        selectable: true,
      },
    });
  });

  it("reveals a LOWER-TIER value at the same breakpoint, which a reset does not clear", () => {
    /*
     * A reset clears ONE address — this node, this state, this breakpoint, this
     * control. Everything else at that breakpoint survives, so a class value
     * the node overrode at Mobile is exactly what appears afterwards.
     *
     * Simulating the reset by dropping the whole breakpoint from the live set
     * discards that class declaration too, and the control then promises to
     * leave the value unset while the class value is what the author will see.
     */
    const badge = badgeFor(
      query(
        [
          entry({
            origin: { kind: "class", id: "c1", slug: "card" },
            breakpoint: "mobile",
            value: "4px",
          }),
          entry({ breakpoint: "mobile", value: "8px" }),
        ],
        { breakpoint: "mobile", liveBreakpoints: ["mobile"] }
      ),
      site
    );

    expect(badge).toEqual({
      kind: "authored",
      revealed: {
        breakpoint: "mobile",
        label: "Mobile",
        axis: "viewport",
        selectable: true,
      },
    });
  });

  it("reveals NOTHING when this is the only breakpoint holding a value", () => {
    /*
     * The control on the case above: a version that always named some fallback
     * would satisfy it while telling an author a reset restores a value that
     * does not exist. Here the control simply becomes unset.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "mobile" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["tablet", "mobile"],
      }),
      site
    );

    expect(badge).toEqual({ kind: "authored" });
  });

  it("says nothing for a declaration two controls could have written", () => {
    /*
     * `background-image` is written by both `background.url` and
     * `backgroundGradient`, on the node itself, with nothing in the trace to
     * separate them. Offering a reset there would clear a control the author
     * was not looking at, so the badge withholds rather than guesses — the same
     * refusal the origin dot already makes.
     */
    const badge = badgeFor(
      query([entry({ property: "background-image", value: "url(a.png)" })], {
        cssProperty: "background-image",
      }),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("says nothing when the winner is another STATE at another breakpoint", () => {
    /*
     * The breakpoint check alone is not enough: a hover value at Tablet differs
     * from the edited address in TWO dimensions, and passing it through would
     * offer "go to Tablet" to an author editing the base state — where the
     * field they are looking at holds nothing.
     *
     * The existing same-breakpoint case cannot catch this, because there the
     * breakpoint guard fires first.
     */
    const badge = badgeFor(
      query([entry({ state: "hover", breakpoint: "tablet" })], {
        breakpoint: "mobile",
        state: "base",
        liveBreakpoints: ["tablet", "mobile"],
        liveStates: ["base", "hover"],
      } as never),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("says nothing when the winner belongs to an ENCLOSING node", () => {
    /*
     * `styleOrigin` deliberately returns an ancestor's declaration when it
     * carries a descendant selector that reaches here. A bare `node` origin at
     * another breakpoint is therefore not proof the value is this control's —
     * and "go to Tablet and edit it there" would send the author to a tier
     * where the field in front of them holds nothing, because the value lives
     * on a different node.
     *
     * The fixture has to REACH the guard, and three things are needed for that.
     *
     * The subject must NAME the ancestor, because `styleOrigin` only lets an
     * enclosing node's rule through `reachesViaAncestor` — with no ancestors
     * listed, an unrelated node's declaration is filtered upstream and the
     * badge is empty whether or not the guard exists.
     *
     * That entry must carry a DESCENDANT selector, because a bare rule on
     * another node reaches nothing here; `reachesViaAncestor` returns false for
     * `descendant === undefined`.
     *
     * And the query must ask at the SAME descendant, or `inheritedBadge`'s
     * descendant comparison rejects the entry first and the id check is again
     * never the reason. With all three, the only thing standing between this
     * trace and an `inherited` badge is the id.
     */
    const badge = badgeFor(
      query(
        [
          entry({
            origin: { kind: "node", id: "parent" },
            descendant: " a",
            breakpoint: "tablet",
          }),
        ],
        {
          subject: {
            nodeId: "n1",
            classIds: ["c1"],
            ancestors: [{ nodeId: "parent" }],
          },
          descendant: " a",
          breakpoint: "mobile",
          liveBreakpoints: ["tablet", "mobile"],
        }
      ),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("says nothing when the winner belongs to another CONTROL on this node", () => {
    /*
     * A rule on a more specific selector reaches this control without being
     * written by it — ` a` reaches the link-hover control when no hover value
     * exists. Same node, same state, another breakpoint, and still not a tier
     * this control can be edited at.
     */
    const badge = badgeFor(
      query([entry({ descendant: " a", breakpoint: "tablet" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["tablet", "mobile"],
        descendant: " a:hover",
      }),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("says nothing when the value came from another STATE at this breakpoint", () => {
    /*
     * `inherited` does not mean "another breakpoint": a value can win from the
     * same node at the SAME breakpoint in a different state. Reported as a
     * breakpoint badge it would read "inherited from Mobile" while the author
     * is editing Mobile — a label that is not merely unhelpful but false, and
     * whose jump would go nowhere.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "mobile", state: "hover" })], {
        breakpoint: "mobile",
        state: "base",
        liveBreakpoints: ["mobile"],
        liveStates: ["base", "hover"],
      } as never),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("says nothing about a breakpoint the stored set no longer describes", () => {
    /*
     * A trace outlives an edit to the breakpoint set. Naming a tier the site
     * does not define would offer a jump to a width nothing responds to, and
     * the honest answer is that there is nothing to say.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "watch" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["watch", "mobile"],
      }),
      site
    );

    expect(badge).toEqual({ kind: "none" });
  });

  it("labels a shared id from the definition the compiler KEPT", () => {
    /*
     * Among rows sharing an id the compiler keeps the WIDEST, not the first
     * stored, so a label looked up by id alone names the surviving tier after
     * the row the sheet discarded. The discarded row is stored FIRST here, so a
     * by-id lookup cannot pass by accident.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "tablet" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["tablet", "mobile"],
      }),
      {
        viewport: [
          { id: "tablet", label: "Draft", maxWidth: 700 },
          { id: "tablet", label: "Tablet", maxWidth: 991 },
        ],
        container: [],
      }
    );

    expect(badge).toEqual({
      kind: "inherited",
      source: {
        breakpoint: "tablet",
        label: "Tablet",
        axis: "viewport",
        selectable: true,
      },
    });
  });

  it("falls back to the id when no definition carries that bound", () => {
    /*
     * A trace can name a breakpoint the stored set no longer describes. The id
     * is not a good name, but inventing one, or borrowing another row's label,
     * would attach a name to a tier it does not describe.
     */
    const badge = badgeFor(
      query([entry({ breakpoint: "tablet" })], {
        breakpoint: "mobile",
        liveBreakpoints: ["tablet", "mobile"],
      }),
      { viewport: [{ id: "tablet", maxWidth: 991 } as never], container: [] }
    );

    expect(badge).toEqual({
      kind: "inherited",
      source: {
        breakpoint: "tablet",
        label: "tablet",
        axis: "viewport",
        selectable: true,
      },
    });
  });
});
