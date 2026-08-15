/**
 * Which slots must declare `childLayout: "formatted"`, asked of the renderer rather than of a list.
 *
 * The canvas interleaves a zero-height drop zone between a slot's children, which is free in normal
 * block flow and destructive inside a flex or grid container: the extra element becomes a cell,
 * takes a gap, and shifts every child after it, so the canvas stops matching the published page.
 * `childLayout` is how a slot says which it is.
 *
 * A declaration only anyone remembers to write is one someone will forget, so this does not compare
 * against a hand-kept list of container types. It RENDERS each container, finds the element that
 * actually holds its children, and reads the layout off that element — the same fact the canvas
 * needs, taken from the block that decides it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../../render/RenderNode";

import { appendTargetSlot, slotIsFormatted } from "./CanvasNode";

import "../../render/blocks/index";

const MARKER = "nx-slot-layout-probe";

/** Opening tags, closing tags and self-closing tags, in document order. */
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * The `style` attribute of the element the MARKED ELEMENT is a direct child of.
 *
 * The marker has to sit on the child's own tag rather than in its text: an element still open at
 * a piece of text is the child's own root, so a text marker measures the child's layout instead of
 * the layout it is laid out BY.
 *
 * `null` when no tag carries the marker, which is a different answer from "its parent has no style"
 * and must not be collapsed into it: a container that draws nothing for its children cannot be
 * judged, and reporting it as unstyled would silently pass it.
 */
function directParentStyle(html: string, marker: string): string | null {
  const open: { name: string; attrs: string }[] = [];
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      // Popped by NAME alone, because a closing tag carries no attributes to match on. Popping
      // to the LAST occurrence rather than one level also re-aligns the stack after an element
      // that was never closed, which would otherwise make every later answer wrong.
      const i = open.map(e => e.name).lastIndexOf(name);
      if (i !== -1) open.length = i;
      continue;
    }
    if (attrs.includes(marker)) {
      const parent = open[open.length - 1]?.attrs ?? "";
      return /\sstyle="([^"]*)"/.exec(parent)?.[1] ?? "";
    }
    if (selfClosing || VOID_ELEMENTS.has(name.toLowerCase())) continue;
    open.push({ name, attrs });
  }
  return null;
}

/** The CSS display the element lays its children out with, "" when it states none. */
function displayOf(style: string): string {
  return /(?:^|;)\s*display:\s*([a-z-]+)/.exec(style)?.[1] ?? "";
}

/** A display value whose children become cells rather than blocks in normal flow. */
function formats(display: string): boolean {
  return ["flex", "grid", "inline-flex", "inline-grid"].includes(display);
}

/**
 * The block's own markup, or `null` where it cannot be produced synchronously.
 *
 * A container that suspends — one whose children are fetched — has no static output to read, and
 * that is a limit of this probe rather than a fact about the block. Reported as unanswerable so it
 * joins the containers the sweep counts as unreached, instead of passing as one with no layout.
 */
const html = (node: BlockNode): string | null => {
  try {
    return renderToStaticMarkup(
      <RenderNode node={node} registry={defaultBlockRegistry} />
    );
  } catch {
    return null;
  }
};

describe("the scanner this suite judges with", () => {
  it("finds the innermost open element, not the outermost", () => {
    const style = directParentStyle(
      `<div style="display:flex"><section style="display:grid"><b class="${MARKER}">x</b></section></div>`,
      MARKER
    );
    expect(displayOf(style ?? "")).toBe("grid");
  });

  it("leaves the stack aligned after a closed sibling", () => {
    const style = directParentStyle(
      `<div style="display:flex"><span style="display:grid">x</span><b class="${MARKER}">y</b></div>`,
      MARKER
    );
    expect(displayOf(style ?? "")).toBe("flex");
  });

  it("does not treat a void element as a parent", () => {
    const style = directParentStyle(
      `<div style="display:flex"><img src="/a.png"/><b class="${MARKER}">y</b></div>`,
      MARKER
    );
    expect(displayOf(style ?? "")).toBe("flex");
  });

  it("reports an absent marker as unanswerable, not as unstyled", () => {
    expect(directParentStyle(`<div style="display:flex"></div>`, MARKER)).toBe(
      null
    );
  });

  it("separates a nested block wrapper from the flex box around it", () => {
    // The shape `core/cover` has: a flex box whose children sit inside an ordinary block div.
    const style = directParentStyle(
      `<div style="display:flex"><div style="position:relative"><b class="${MARKER}">y</b></div></div>`,
      MARKER
    );
    expect(formats(displayOf(style ?? ""))).toBe(false);
  });
});

/** Every registered container, with the slot it draws its children into. */
function containerSlots(): { type: string; slot: string }[] {
  const out: { type: string; slot: string }[] = [];
  for (const def of defaultBlockRegistry.all()) {
    if (!def.isContainer) continue;
    for (const slot of def.slots ?? [])
      out.push({ type: def.type, slot: slot.name });
  }
  return out;
}

function declaredLayout(type: string, slot: string): string | undefined {
  return defaultBlockRegistry.get(type)?.slots?.find(s => s.name === slot)
    ?.childLayout;
}

describe("every container's slot declares how it lays children out", () => {
  const probed = containerSlots().map(({ type, slot }) => {
    const child: BlockNode = {
      ...makeNode("core/heading", { text: "probe", level: "h2" }),
      // `customClass` lands on the block's own root element, which is the element whose
      // parent decides the layout.
      customClass: MARKER,
    };
    const markup = html(makeNode(type, {}, undefined, { [slot]: [child] }));
    const style = markup === null ? null : directParentStyle(markup, MARKER);
    return { type, slot, style };
  });

  it("reaches the children of most containers, so the sweep means something", () => {
    // A container whose render drops its children answers `null`, and a sweep of nothing but
    // nulls would pass while checking nobody.
    const drawn = probed.filter(p => p.style !== null);
    expect(drawn.length).toBeGreaterThanOrEqual(6);
  });

  it("declares `formatted` wherever the children become flex or grid cells", () => {
    const undeclared = probed
      .filter(p => p.style !== null && formats(displayOf(p.style ?? "")))
      .filter(p => declaredLayout(p.type, p.slot) !== "formatted")
      .map(p => `${p.type}.${p.slot}`);
    expect(undeclared).toEqual([]);
  });

  it("claims `formatted` only where the children really are cells", () => {
    const overclaimed = probed
      .filter(p => declaredLayout(p.type, p.slot) === "formatted")
      .filter(p => p.style !== null && !formats(displayOf(p.style ?? "")))
      .map(p => `${p.type}.${p.slot}`);
    expect(overclaimed).toEqual([]);
  });
});

describe("which slot an append target adds to", () => {
  const columns = makeNode("core/columns");
  const heading = makeNode("core/heading");

  it("names the formatted slot, rather than assuming it is called default", () => {
    // Derived, because a container may declare its formatted slot under any name. Naming
    // `default` would leave a custom container's `items` slot reachable for insert-before and
    // unreachable for append.
    expect(appendTargetSlot(columns, false)).toBe("default");
  });

  it("withholds it where the same element already carries an insert-before target", () => {
    // Two droppables on one element share a rectangle and a priority, so the first registered
    // takes every collision and the second states a capability the canvas does not have.
    expect(appendTargetSlot(columns, true)).toBe(null);
  });

  it("withholds it from a container that already has a trailing zone", () => {
    const container = makeNode("core/container");
    expect(slotIsFormatted(container, "default")).toBe(false);
    expect(appendTargetSlot(container, false)).toBe(null);
  });

  it("withholds it from a block that holds no children at all", () => {
    expect(appendTargetSlot(heading, false)).toBe(null);
  });

  it("covers every formatted slot in the catalogue, whatever it is named", () => {
    // The sweep that makes the derivation mean something: each container whose children really
    // are cells must resolve to the slot the canvas would append to. A hardcoded `default` would
    // pass this today and fail the first container that names its formatted slot otherwise.
    for (const { type, slot } of containerSlots()) {
      const node = makeNode(type);
      if (!slotIsFormatted(node, slot)) continue;
      expect(appendTargetSlot(node, false)).toBe(slot);
    }
  });
});
