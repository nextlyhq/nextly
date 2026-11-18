/**
 * Which block an element on the canvas stands for, and back: the address a
 * press resolves to, whether an element is the outermost one for its
 * address, the elements a node was drawn as, and whether an element belongs
 * to the canvas asking rather than to a canvas drawn inside it.
 *
 * @module canvas-addressing
 */

import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { isElement } from "../dom-kind";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeElements } from "./rendered-nodes";

/**
 * How a pointer event on the canvas resolves to a node id, or to nothing.
 *
 * `closest` rather than reading the target directly: a click lands on whatever
 * leaf is under the pointer — a `<span>` inside a heading, an `<img>` inside a
 * card — and the node that owns it is an ancestor. Reading the target alone
 * selects nothing for every block that renders more than one element, which is
 * most of them.
 *
 * The attribute name comes from `@nextlyhq/blocks-react` rather than being
 * spelled here. The renderer writes it and this reads it, so two spellings
 * would be two declarations of one name, and the day it moves the hit-testing
 * would resolve nothing while every test that hard-coded it still passed.
 *
 * **Bounded at the canvas root, which is not a detail.** The renderer applies
 * the attribute by cloning the block's root element and returns the output
 * untouched when it is not a single host element — so a block rendering a
 * fragment or a component carries none. An unbounded `closest` then walks past
 * it to the nearest ANCESTOR that has one, and returns that node's id: a
 * confidently WRONG selection rather than a missing one.
 *
 * The two failures are not equally bad. A miss is visible immediately — the
 * author clicks and nothing happens. A wrong hit selects a container while the
 * author believes they selected the child inside it, and every edit afterwards
 * lands on the wrong node with nothing to indicate it.
 */
export function nodeIdFromEvent(target: EventTarget | null): string | null {
  // Any realm's element, for the reason `contextMenuTargetOf` gives.
  if (!isElement(target)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  // Inside THIS canvas, not merely inside something carrying the attribute. A
  // canvas rendered within another rendered page would otherwise resolve a
  // click to the outer page's node.
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) === null) return null;
  return nodeAddressOf(owner);
}

/**
 * Which node an element stands for, once components are inlined.
 *
 * EXPORTED because it is the one rule, and every reader of the element-to-node
 * mapping has to use it. Slice one of this work updated the click path and the
 * geometry lookup and left three other readers on the raw attribute — the
 * context menu, the selection markers and the drag rectangles — which is how a
 * right-click came to act on the previously selected block.
 *
 * A component is inlined at render: the instance node is replaced by the tree
 * its definition describes, and every element of that tree carries a RE-MINTED
 * id the page's document does not contain. Returning that id hands the editor
 * an address it cannot select, edit or delete — so a definition-owned element
 * answers with the INSTANCE the author actually placed, which is a real node in
 * the page.
 *
 * ## Asked of the ELEMENT, never of its ancestors
 *
 * `owner.closest(\`[${"$"}{INSTANCE_ATTRIBUTE}]\`)` is the obvious implementation and
 * it is wrong. An instance's SLOT CONTENT belongs to the page and is
 * deliberately unmarked, but it renders NESTED INSIDE the definition's marked
 * box — so a walk upwards finds that box and answers with the component for a
 * node the author can and should select directly. That content is exactly what
 * a marketer opened the editor to change.
 *
 * The marker is per-node rather than a wrapper element precisely so this
 * question can be asked without walking, and `hasAttribute` is what asks it:
 * marked means definition-owned, unmarked means the page's own whatever
 * encloses it.
 */
export function nodeAddressOf(owner: Element): string | null {
  const instance = owner.getAttribute(INSTANCE_ATTRIBUTE);
  // Present AND non-empty. The renderer never emits an empty one — it treats
  // that as no provenance — but an address of "" is not selectable, so reading
  // it as page-owned is the answer that leaves the element addressable by its
  // own id.
  if (instance !== null && instance !== "") return instance;
  return owner.getAttribute(NODE_ID_ATTRIBUTE);
}

/**
 * Whether this element is the OUTERMOST one standing for its address.
 *
 * Two different things put one address on several elements, and they need
 * opposite answers:
 *
 * - A node rendered more than once — a block that draws its child twice — puts
 *   the same node id on SIBLING elements. Every copy is a rendering of that
 *   node, and marking only one outlines a single row of ten while previewing a
 *   state on another. Neither copy encloses the other, so both are outermost.
 * - A component instance puts one address on every element its definition
 *   contributed, NESTED. Those are renderings of different definition nodes
 *   that share a host, so marking all of them outlines everything inside the
 *   component and measuring all of them keys the drag geometry to whichever was
 *   visited last.
 *
 * Enclosure is what separates them, so enclosure is what this asks. The host
 * marker is contiguous over a subtree, so the nearest enclosing one carrying
 * the same value is the whole test — no walk to the root is needed.
 */
export function isOutermostForAddress(
  element: Element,
  address: string,
  container: HTMLElement
): boolean {
  const host = element.parentElement?.closest(`[${INSTANCE_ATTRIBUTE}]`);
  if (host === null || host === undefined) return true;
  // Bounded by the canvas that owns the element. A canvas can render inside a
  // definition-owned element — component edit mode does — and ids are scoped
  // per document, so the inner document may reuse the enclosing instance's
  // address. An unbounded search then finds the OUTER document's marker,
  // classifies the inner component as nested inside itself, and leaves it with
  // no outline and no rectangle for a drag.
  if (!ownedByCanvas(host, container)) return true;
  return host.getAttribute(INSTANCE_ATTRIBUTE) !== address;
}

/**
 * Every element standing for each of `addresses` on this canvas: the
 * outermost per address, in document order. What a toolbar or a gap measures a
 * block by, so that a component placement whose definition draws several
 * top-level elements is measured as all of them rather than as its first.
 * Only this canvas's own: a canvas nested inside a block (component edit
 * mode) scopes ids to its own document, which may reuse an address from out
 * here.
 */
export function outermostElementsOf(
  root: HTMLElement,
  addresses: ReadonlySet<string>
): Map<string, Element[]> {
  const drawn = new Map<string, Element[]>();
  for (const element of nodeElements(root)) {
    if (!ownedByCanvas(element, root)) continue;
    const address = nodeAddressOf(element);
    if (address === null || !addresses.has(address)) continue;
    if (!isOutermostForAddress(element, address, root)) continue;
    const elements = drawn.get(address) ?? [];
    elements.push(element);
    drawn.set(address, elements);
  }
  return drawn;
}

/**
 * The element a node id was rendered as, or `null` when it is not on screen.
 *
 * The inverse of {@link nodeIdFromEvent}, and beside it because the two are one
 * mapping read in two directions — separated, they become two answers to what a
 * node id means in the DOM.
 *
 * Ids are COMPARED rather than interpolated into a selector. A node id reaches
 * here from stored data, so any character CSS treats specially makes
 * `querySelector` either throw or match something else entirely.
 *
 * Deliberately not the {@link SELECTED_ATTRIBUTE} marker. That marker is applied
 * in a passive effect, so on the render where the selection changes it is still
 * on the previously selected element, and any chrome measuring in a layout
 * effect would spend a frame measuring the wrong block.
 */
export function nodeElement(root: HTMLElement, id: string): Element | null {
  let own: Element | null = null;
  let hosted: Element | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    if (own === null && element.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      own = element;
    }
    // An INSTANCE id addresses a node that renders no element of its own: it
    // was replaced by the definition's tree. The first element that tree
    // contributed is what a caller measuring the selection needs, and document
    // order makes that the outermost one.
    if (hosted === null && element.getAttribute(INSTANCE_ATTRIBUTE) === id) {
      hosted = element;
    }
  });
  // The node's OWN element wins where both exist. They cannot today — an
  // instance is replaced rather than rendered — but the precedence states which
  // answer is the node's rather than leaving it to iteration order.
  return own ?? hosted;
}

/**
 * Whether this element belongs to the canvas doing the marking.
 *
 * A node id is unique within a DOCUMENT and not across documents, so a block
 * that renders a second canvas puts another document's ids inside the outer
 * walk's reach. An inner node sharing the dragged id would then be dimmed by a
 * drag it has no part in, and the refusal could anchor to it.
 */
export function ownedByCanvas(
  element: Element,
  container: HTMLElement
): boolean {
  if (element === container) return true;
  return element.closest(`.${CANVAS_ROOT_CLASS}`) === container;
}

/**
 * The element drawing a node, restricted to the canvas that owns it.
 *
 * {@link nodeElement} answers with the first match anywhere beneath the root,
 * which is the wrong question once a block can render a canvas of its own: node
 * ids are unique within a DOCUMENT, so an inner document may legitimately carry
 * the same id and appear earlier in tree order.
 */
export function ownedNodeElement(
  root: HTMLElement,
  id: string
): Element | null {
  for (const candidate of nodeElements(root)) {
    if (candidate.getAttribute(NODE_ID_ATTRIBUTE) !== id) continue;
    if (ownedByCanvas(candidate, root)) return candidate;
  }
  return null;
}
