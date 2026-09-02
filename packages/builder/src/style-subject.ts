/**
 * The node a provenance question is asked about, and the ancestors whose rules
 * can reach it.
 *
 * `styleProvenance` needs a {@link StyleSubject} rather than a node id, because
 * deciding which recorded declaration a control is showing takes more than the
 * node: a value can arrive from the block type's defaults, from a named class
 * the node applies, or from an ANCESTOR's rule carrying a descendant selector.
 * The engine settles which of those wins; it cannot settle which of them exist
 * without being told what the node is and what is above it.
 *
 * Built here rather than at the call site because the panel renders one of these
 * per control, and a subject assembled per control is the document walked per
 * control — the same shape as the cascade walk the panel's own comments say must
 * not happen. One subject per selected node is enough: every control on the
 * panel is asking about the same node.
 *
 * **Ancestors are OUTERMOST FIRST**, which is what `styleOrigin` documents and
 * not what walking up produces. The walk collects nearest-first and the order is
 * reversed once, here, so no caller has to remember which way round it goes.
 *
 * **Only the ancestors' own identity travels, not their ancestors.** The engine
 * types the list as `Omit<StyleSubject, "ancestors">`: an ancestor's ancestors
 * are already in the same flat list, and nesting them would present one node
 * twice with nothing to say which copy a rule attached to.
 *
 * @module style-subject
 */

import type { BlockNode, StyleSubject } from "@nextlyhq/blocks-engine";
import {
  MAX_CLASSES_PER_NODE,
  findNode,
  locateNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

/** One node's own identity, without the chain above it. */
type SubjectNode = Omit<StyleSubject, "ancestors">;

/**
 * The identity a rule can attach to, taken from a node.
 *
 * `classes` is passed through rather than defaulted to an empty array: the
 * engine reads `classIds` as optional, and an empty array and an absent one are
 * the same answer expressed twice.
 *
 * The SHAPE is checked rather than trusted, and that is not defensive habit. A
 * stored document is untrusted, and the compiler treats a `classes` that is not
 * an array as referencing no classes at all. Forwarded raw, a string would reach
 * `styleOrigin`, whose membership test is `.includes(origin.id)` — which a
 * STRING also answers, by substring. A node storing `classes: "card-primary"`
 * would then report `.card` as the winning origin for a class the canvas emitted
 * no token for.
 *
 * WHICH members survive follows the compiler, in both directions, because the
 * question this answers is "did the rendered element carry this token" and only
 * the compiler decides that.
 *
 * Read to `MAX_CLASSES_PER_NODE` BY INDEX, not filtered then capped. The
 * compiler's window counts malformed members toward the limit, so a node whose
 * 30th entry is a number has a different 64th applied class than one whose
 * entries are all strings. Taking the cap after filtering would silently shift
 * that window and admit a class the canvas emitted no token for.
 *
 * Malformed members are skipped INDIVIDUALLY rather than voiding the array. An
 * earlier version required every member to be a string and dropped all of them
 * otherwise — which turned one bad entry, from a forgiving import or a hand
 * edit, into a block whose every class-sourced value reported as set by nobody
 * while the canvas plainly showed `.card` winning. The compiler skips what it
 * cannot read and applies the rest, and this has to agree with it.
 *
 * Over-long ids are left in rather than filtered: the compiler keeps them too,
 * and a string too long to name a class matches no class id, so the membership
 * test answers the same either way.
 */
function identityOf(node: BlockNode): SubjectNode {
  const subject: { -readonly [K in keyof SubjectNode]: SubjectNode[K] } = {
    nodeId: node.id,
    blockType: node.type,
  };
  const classes = node.classes;
  if (Array.isArray(classes)) {
    subject.classIds = classes
      .slice(0, MAX_CLASSES_PER_NODE)
      .filter((id): id is string => typeof id === "string");
  }
  return subject;
}

/**
 * The subject for one node of a document, or `undefined` when it holds no such
 * node.
 *
 * Undefined is a real answer rather than a failure: a selection can outlive the
 * node it names — an undo, or an edit applied from another surface — and a
 * caller that received an empty subject instead would ask about a node that is
 * not there and be told, confidently, that every control is unset.
 */
export function styleSubjectFor(
  nodes: readonly BlockNode[],
  nodeId: string
): StyleSubject | undefined {
  const editable = nodes as BlockNode[];
  const node = findNode(editable, nodeId);
  if (node === undefined) return undefined;

  const ancestors: SubjectNode[] = [];
  /*
   * The ids already visited, the node's own included, so this loop cannot
   * revisit a node however the document is shaped. The same guard
   * `contrastObscuredAbove` uses for the same walk: two cycle guards written
   * differently in one package are two answers to whether a document
   * terminates.
   *
   * It does NOT make this function safe on a cyclic document, and the
   * distinction is worth stating rather than implying. `locateNode` walks the
   * whole tree to find a parent, and that walk recurses — measured, a slot cycle
   * raises `RangeError: Maximum call stack size exceeded` inside it, before this
   * loop runs at all. Terminating on a malformed document is the engine's
   * traversal to guarantee, not this module's, and it is being fixed there.
   */
  const seen = new Set<string>([nodeId]);
  let current = nodeId;
  for (;;) {
    const parent = locateNode(editable, current)?.parent;
    if (parent === undefined || seen.has(parent.id)) break;
    seen.add(parent.id);
    ancestors.push(identityOf(parent));
    current = parent.id;
  }

  // Reversed once, here: the walk produces nearest-first and the engine reads
  // outermost-first.
  return { ...identityOf(node), ancestors: ancestors.reverse() };
}

/**
 * The element a node's own box is rendered as, read off the canvas.
 *
 * The typographic baseline compiles to `:where(h1)` — a rule on the ELEMENT —
 * so nothing else in a subject can say whether one reaches this node. The
 * document cannot answer it either: the tag lives inside a block's render, and
 * `core/heading` picks it from a PROP while `core/rich-text` renders a plain
 * `div` with its headings INSIDE. A reader that guessed from the block type
 * would get the second case backwards and report a heading baseline as styling
 * a rich-text block's own box.
 *
 * So the canvas answers. It is the page a visitor sees, so its tag cannot
 * disagree with the cascade the browser actually ran, and it needs no new field
 * on the block contract — which every third-party block author would otherwise
 * inherit. `core/rich-text` comes out right for free: its root really is a
 * `div`, so a heading baseline correctly does not reach that block's own
 * font-size control.
 *
 * `undefined` when the node is not drawn. Read AFTER a commit rather than
 * during a render, because the canvas and this panel re-render together and the
 * DOM still holds the previous tag while the panel's body is running — asking
 * then reports the level an author just changed away from.
 */
export function renderedTagOf(
  root: HTMLElement | null | undefined,
  nodeId: string | null
): string | undefined {
  if (root == null || nodeId === null) return undefined;
  /*
   * The id NEVER reaches a selector. The elements carrying the attribute are
   * enumerated and their values compared as ordinary strings, which is the same
   * shape `canvas-drag.tsx` uses to map painted elements back to nodes.
   *
   * Escaping was the wrong instinct and an incomplete one. A node id is author
   * data — an imported or API-authored document can carry any string, since the
   * document model imposes no character grammar on ids — and `querySelector`
   * THROWS on invalid syntax rather than returning nothing. Quoting the value
   * handles `"` and `\`, but a raw line break is not representable in a CSS
   * string at all, so a single id containing one would take the whole style
   * inspector down from inside an effect. Comparing strings has no such class of
   * input.
   *
   * The cost is a walk over the marked elements instead of an indexed lookup. It
   * runs once per commit for one selected node, over the elements of one page.
   */
  return markedElementOf(root, nodeId)?.tagName.toLowerCase();
}

/**
 * The canvas element the node is drawn as, or `undefined` when it is not drawn.
 *
 * The lookup `renderedTagOf` was written around, lifted out because a second
 * question needs the same element rather than its tag: the box of logical sides
 * asks the element which way it runs. Two walks would be two answers to "which
 * element is this node", and they would drift the moment either learns
 * something — a Suspense boundary, a portal, a block that marks more than its
 * root.
 *
 * The id NEVER reaches a selector, for the reason spelled out above: a node id
 * is author data, `querySelector` THROWS on invalid syntax rather than missing,
 * and escaping does not cover a raw line break at all.
 *
 * @param root - the canvas root to search under
 * @param nodeId - the node whose element is wanted
 * @returns the marked element, or `undefined`
 */
export function markedElementOf(
  root: HTMLElement | null | undefined,
  nodeId: string | null
): Element | undefined {
  if (root == null || nodeId === null) return undefined;
  const marked = root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`);
  // An index loop rather than `for...of`: a `NodeList` is not iterable under
  // this package's lib target, and rather than widen that for one walk it is
  // read the way the DOM has always allowed.
  for (let index = 0; index < marked.length; index += 1) {
    const element = marked[index];
    if (element?.getAttribute(NODE_ID_ATTRIBUTE) === nodeId) return element;
  }
  return undefined;
}
