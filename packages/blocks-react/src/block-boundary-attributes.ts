/**
 * What a block's root element carries beyond what the block drew: the
 * node's own `cssId` and HTML attributes (only the names a page may set),
 * and, on the editor's canvas, the markers that tie the element to its node
 * and its inline props.
 *
 * @module block-boundary-attributes
 */
import {
  renderedDomId,
  type BlockNode,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import { cloneElement, isValidElement, type ReactNode } from "react";

import {
  editorMarkers,
  EDITOR_NAMESPACE,
  PROP_ATTRIBUTE,
} from "./editor-markers";
import type { EditorMarkers } from "./placeholder";

/**
 * Inert global attributes an author may set on a block's root element.
 *
 * An ALLOWLIST, not a list of things to refuse. The engine's validator rejects
 * `on*` handlers and says in as many words that the render-safe list belongs to
 * the renderer — so this is the only place it exists, and a list of refusals
 * could never keep up. `srcDoc` injects a document, `href`/`formAction`/`action`
 * choose a destination, `src` and `poster` fetch, `style` and `class` restyle,
 * and the next attribute with reach ships in some future browser without anyone
 * here noticing.
 *
 * These four carry no behaviour: they name, describe or orient an element.
 * `id` arrives separately through the modelled `cssId` field.
 */
const ALLOWED_ATTRIBUTE_NAMES = new Set(["id", "title", "lang", "dir"]);

/**
 * A name HTML can carry, which is the XML `Name` production.
 *
 * Mirrors React's own attribute-name validation rather than a narrower rule of
 * this project's own: refusing a name React WOULD render is a false alarm on
 * correct input, and this predicate is what an editor asks before telling an
 * author their attribute is unusable. The unicode ranges are that production's,
 * so a non-ASCII `data-` name is accepted exactly where the DOM accepts it.
 */
/** The first character of an XML `Name`. */
const NAME_START =
  "[:A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD]";

/**
 * Every LATER character, combining ranges first.
 *
 * Order matters only to a reader: with a base character immediately before a
 * combining range, the two read as one combined character rather than as two
 * alternatives, and a linter says so. Leading with the combining ranges keeps
 * the set identical and the intent unambiguous.
 */
const NAME_CHAR =
  "[\\u0300-\\u036F\\u203F-\\u2040\\u00B7\\-.0-9:A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD]";

const ATTRIBUTE_NAME = new RegExp(`^${NAME_START}${NAME_CHAR}*$`, "u");

/**
 * Whether an author-supplied attribute may reach the DOM.
 *
 * `data-*` and `aria-*` are open by prefix: both are namespaces defined to carry
 * author data and accessibility semantics, neither can name a destination or
 * execute anything, and closing them would defeat the feature the field exists
 * for. `role` is the ARIA sibling of `aria-*` and belongs with them.
 *
 * EXPORTED so an editor offering this field can ask it rather than restate it.
 * The list above already says the render-safe set lives here and only here; a
 * second copy in an editor would drift, and it would drift silently in the
 * worse direction — the editor accepting a name this loop then skips, so the
 * author sets an attribute, sees it saved, and never sees it on the page.
 */
export function isAllowedAttribute(name: string): boolean {
  // SYNTAX first, because the open prefixes below admit anything after them.
  // `data-x foo` and `data-x"` start with `data-` and are not attribute names:
  // React refuses them and renders nothing, so a check that stopped at the
  // prefix let a value be stored that could never appear on a page.
  if (!ATTRIBUTE_NAME.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower === "role") return true;
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return true;
  return ALLOWED_ATTRIBUTE_NAMES.has(lower);
}

/**
 * Builds the `markProp` a block spreads onto the element carrying a value.
 *
 * Returns nothing at all outside an editor, and nothing for a prop the block
 * has not declared `inline` — so the declaration and the marking have to agree
 * before an editor sees anything, and a block that marks an element it never
 * declared gets silence rather than an editable region nobody intended.
 */
export function propMarker(
  definition: { props?: Record<string, { inline?: boolean } | undefined> },
  enabled: boolean
): ((name: string) => Record<string, string>) | undefined {
  if (!enabled) return undefined;
  return (name: string): Record<string, string> => {
    if (definition.props?.[name]?.inline !== true) return {};
    return { [PROP_ATTRIBUTE]: name };
  };
}

/**
 * The editor's address for one node, read BEFORE any block code runs.
 *
 * A snapshot rather than the live node, and the reason is already argued in
 * the block boundary for `rendersNothing`: the same mutable `node` object is handed to
 * `definition.render`, so anything read back afterwards is whatever the render
 * left behind. That argument was made about a block judging its own emptiness;
 * it applies with more force here, because these two values decide which node
 * an editor click selects, edits and deletes.
 *
 * The window is not only synchronous. A block may mutate `node` after an
 * `await`, and the awaited path re-enters the output check with the same
 * object — so the snapshot is taken once, at the boundary, and carried down
 * both paths rather than re-read at either end of them.
 */
export type EditorIdentity = EditorMarkers;

/**
 * That snapshot, taken from a node before it is handed to a block.
 *
 * Total: a node carrying no provenance, or provenance that is not a string,
 * yields `undefined` rather than a value nothing can address.
 */
export function editorIdentityOf(
  node: ResolvedBlockNode,
  // Whether this render wants editor markers at all. Not a micro-optimisation:
  // see the provenance read below.
  nodeAttribute: boolean | undefined
): EditorIdentity {
  return {
    nodeId: node.id,
    // Read ONLY when an editor asked for markers. `instanceOf` is an unknown
    // key on a stored node, and this component is public — a consumer can hand
    // it a tree assembled in memory, where the property may be an accessor that
    // throws. On a published render nothing wants provenance, so reading it
    // buys nothing and costs the containment the boundary exists for: the
    // boundary came down before it could draw a placeholder for the block.
    //
    // The snapshot still happens at the boundary's first line, so an editor
    // render reads it before any plugin code can move it. What changed is
    // whether it is read at all, not when.
    instanceOf: nodeAttribute === true ? storedProvenance(node) : undefined,
  };
}

/**
 * The node's provenance, read EXACTLY once.
 *
 * A snapshot that reads the property twice is not a snapshot. `instanceOf` is
 * an unknown key on a stored node and this component is public, so it can be an
 * accessor — and one that answers `"legit"` to the type test and `"forged"` to
 * the assignment defeats the whole guarantee, while one that throws only on the
 * second read escapes the containment the first read established.
 *
 * So the value is captured, and everything after that is a test on the captured
 * value rather than another visit to the object.
 */
function storedProvenance(node: ResolvedBlockNode): string | undefined {
  const captured: unknown = node.instanceOf;
  return typeof captured === "string" ? captured : undefined;
}

/**
 * The markers a PLACEHOLDER carries, or none outside an editor.
 *
 * A placeholder is drawn instead of the block, so it never reaches
 * the marker assembly — this is the same decision made at the other end of
 * the same render, and it is deliberately the only other place that decides
 * it. Without it the one element an author can see and click, when a block
 * inside a component fails, carries no address at all.
 */
export function placeholderEditor(
  nodeAttribute: boolean | undefined,
  identity: EditorIdentity
): EditorMarkers | undefined {
  return nodeAttribute === true ? identity : undefined;
}

/**
 * Removals for the editor attributes this render OWNS, whatever case a block
 * spelled them in.
 *
 * Assigning `undefined` to the canonical lowercase name is not enough, and the
 * gap is invisible in the source. `cloneElement` merges by EXACT prop name, so
 * a root carrying `data-NX-instance` keeps it — while HTML attribute lookup is
 * ASCII case-insensitive, so an editor asking for `data-nx-instance` is handed
 * the block's forged value. The removal and the read disagree about what counts
 * as the same attribute.
 *
 * Scoped to the names `editorMarkers` produces rather than to the whole
 * namespace, and that boundary is the point. `PROP_ATTRIBUTE` is in the same
 * namespace and is a block's to set — the renderer HANDS it to blocks through
 * `markProp`, so clearing everything under the prefix deletes the inline-edit
 * marker the renderer itself asked for. Measured: it broke four inline-prop
 * tests.
 *
 * Derived from the bag being assigned rather than from a list written here, so
 * a marker added to the shared builder is covered without this being edited and
 * one that is deliberately a block's stays untouched.
 *
 * Only in editor mode. On a published page these are the block author's own
 * markup and none of this system's business.
 */
function clearedBlockMarkers(
  props: unknown,
  nodeAttribute: boolean,
  // The canonical names this render is about to assign, which is exactly the
  // set the RENDERER owns.
  owned: Record<string, string | undefined>
): Record<string, undefined> {
  const cleared: Record<string, undefined> = {};
  if (!nodeAttribute || typeof props !== "object" || props === null) {
    return cleared;
  }

  const ours = new Set(Object.keys(owned));
  for (const name of Object.keys(props)) {
    if (ours.has(name.toLowerCase())) cleared[name] = undefined;
  }

  return cleared;
}

/** What a stored node offers an element, once the envelope has been read. */
interface StoredDecoration {
  /** The modelled id field, when it is a string. */
  cssId: string | undefined;
  /** The author's attribute bag, when it is one. */
  attributes: Record<string, unknown> | undefined;
  /** Whether the node is marked never to be quoted in search snippets. */
  nosnippet: boolean;
  /** Whether the node contributes anything at all besides editor markers. */
  any: boolean;
}

/**
 * Read what a stored node offers, defensively.
 *
 * Its own function because reading a persisted envelope is a different job from
 * assembling an element, and it is the job with all the shapes: a stored
 * `attributes` is whatever the database returned, so `null` reaches
 * `Object.keys` and throws — after the render try/catch and after
 * normalization, which means one bad persisted field would cost the whole page
 * rather than one block.
 *
 * `any` is derived here rather than recomputed by the caller, so "this node
 * decorates nothing" has one definition.
 */
export function storedDecoration(
  node: Pick<BlockNode, "cssId" | "attributes" | "nosnippet">
): StoredDecoration {
  const cssId = typeof node.cssId === "string" ? node.cssId : undefined;
  const attributes =
    typeof node.attributes === "object" &&
    node.attributes !== null &&
    !Array.isArray(node.attributes)
      ? node.attributes
      : undefined;
  const hasAttributes =
    attributes !== undefined && Object.keys(attributes).length > 0;
  // Only a stored `true` marks it: anything else a document holds is no mark.
  const nosnippet = node.nosnippet === true;

  return {
    cssId,
    attributes,
    nosnippet,
    any: cssId !== undefined || hasAttributes || nosnippet,
  };
}

/**
 * The author-set attributes a node may put on its element, filtered.
 *
 * Its own function because it is its own JOB: deciding which stored values are
 * allowed out is a question about the DOCUMENT, while `withNodeAttributes`
 * assembles an element. Keeping them together is what made that function the
 * package's complexity hotspot — every branch here is a rule about one
 * attribute, and none of them is about assembling anything.
 *
 * Total, and it answers with a bag rather than mutating one, so a caller cannot
 * make an ordering mistake with the markers that are merged over it.
 */
function authorSetAttributes(
  attributes: Record<string, unknown> | undefined,
  nodeAttribute: boolean
): Record<string, string> {
  const allowed: Record<string, string> = {};
  if (attributes === undefined) return allowed;

  for (const [name, value] of Object.entries(attributes)) {
    if (!isAllowedAttribute(name)) continue;
    // Lowercased before use. HTML attribute names are ASCII case-insensitive,
    // but React treats `ID` and `id` as different props — so a case variant
    // would survive the allowlist and then be rendered ALONGSIDE the modelled
    // `cssId`, leaving two id attributes on one element.
    const key = name.toLowerCase();
    // The field is typed as strings and sanitized at write time, but a stored
    // document can hold anything; a non-string would be handed to React as a
    // prop value it never expected.
    if (typeof value !== "string") continue;
    /*
     * The editor's own namespace is not the document's to write, and only
     * while this render is FOR the editor: on a published page these are
     * ordinary author data and none of this system's business.
     *
     * Filtered HERE rather than trusted to the panel that offers the field.
     * A document can arrive from an import or a script, and the marker it
     * would overwrite decides which block a click selects and which
     * property inline editing commits into.
     */
    if (nodeAttribute && key.startsWith(EDITOR_NAMESPACE)) continue;
    /*
     * `id` is deliberately NOT assigned here. Which of a node's two spellings
     * reaches the page is one question, and the engine's `renderedDomId` is
     * the one answer to it — six other surfaces already derive from it, and
     * this renderer is the thing that answer models. Assigning the bag's `id`
     * in this loop and correcting it afterwards would restate the rule, which
     * is how the rule and the page come to disagree.
     */
    if (key === "id") continue;
    allowed[key] = value;
  }

  return allowed;
}

/**
 * Applies the node's root-level HTML fields to what the block rendered.
 *
 * `cssId` and `attributes` belong to the NODE, not the block, and
 * `BlockRenderArgs` carries only `className` — so a block has no way to receive
 * them and they would be stored and silently dropped, breaking anchors, labels
 * and author data attributes.
 *
 * Applied by cloning because the block owns its root element: the format says a
 * block renders a single element and never wraps it, so its root IS the node's
 * root. Output that is not a single element has no root to carry them and is
 * returned untouched rather than guessed at.
 */
export function withNodeAttributes(
  output: ReactNode,
  node: ResolvedBlockNode,
  nodeAttribute = false,
  // Whether the block's definition declares at least one slot, decided once by
  // the caller and carried down rather than re-read from the definition here.
  declaresSlots = false,
  // The editor address, snapshotted before the block ran. Defaulted from the
  // node for the callers that never hand a node to plugin code, so those keep
  // reading the value they always did.
  identity: EditorIdentity = editorIdentityOf(node, nodeAttribute)
): ReactNode {
  const decoration = storedDecoration(node);
  // The node-id attribute is applied UNCONDITIONALLY when asked for, which is
  // why it is checked before this early return rather than added to the
  // allowlist below. That return fires for any node carrying no `cssId` and no
  // `attributes` — which is nearly every node on a real page — so an editor
  // address joined to the allowlist would land on almost nothing while a
  // fixture that happened to set either field passed.
  if (!decoration.any && !nodeAttribute) return output;
  if (!isValidElement(output)) return output;
  // Only a host element has a DOM root to carry them. `nodeRootReason` has
  // already refused the combination that would land here otherwise, so this is
  // the invariant restated rather than a second policy.
  if (typeof output.type !== "string") return output;

  // Values may be `undefined`, which is how an editor marker is REMOVED from
  // an element a block built: React omits an attribute whose value is
  // undefined, and `cloneElement` merges this bag over the block's own props.
  const extra: Record<string, string | undefined> = {};
  // Computed once and used twice: to say which names a block may not keep, and
  // then to assign the trusted values. Deriving the removals from the same bag
  // is what stops the two disagreeing about which attributes the renderer owns.
  const markers = nodeAttribute
    ? editorMarkers({
        nodeId: identity.nodeId,
        instanceOf: identity.instanceOf,
        declaresSlots,
      })
    : {};

  Object.assign(
    extra,
    authorSetAttributes(decoration.attributes, nodeAttribute),
    // Removals FIRST, so the canonical assignments below land over them.
    clearedBlockMarkers(output.props, nodeAttribute, markers)
  );
  /*
   * The single id this node emits, ASKED rather than restated.
   *
   * The rule already carries everything this loop used to do by hand: the
   * modelled field wins over an attribute of the same name, only a STRING
   * `cssId` shadows, the bag is read case-insensitively with the last variant
   * winning, and an empty result is no id at all.
   *
   * That last clause changes what an empty id does, in two ways.
   *
   * A node with `cssId: ""` used to emit a literal `id=""`, because this loop
   * tested `!== undefined` and the empty string passes. It no longer does, and
   * nothing reachable is lost: the DOM Standard unsets an element's ID when the
   * attribute is set to the empty string, so `getElementById("")` never matched
   * it, no IDREF could name it, and `#` is not a valid selector. The HTML
   * Standard separately requires an id to hold at least one character, so what
   * shipped was invalid markup that addressed nothing. The empty `cssId` still
   * SHADOWS the bag, which is the part authors can observe, and the inspector
   * still offers to remove it.
   *
   * And a node contributing no id now leaves a BLOCK-OWNED root id alone, so
   * the two ways of contributing none — the field absent, and the field present
   * but empty — agree. Only the empty one moved: an absent `cssId` always left
   * a block's own id in place. Assigning the empty string overwrote it and left
   * the element reachable by nothing, which was collateral of the assignment
   * rather than a rule anything stated, and it is the harmful direction — an
   * empty `cssId` arrives by import and never from the editor, and a block
   * whose root id is the target of its own `aria-labelledby` or `htmlFor` lost
   * that wiring to a value its author never typed.
   *
   * What this rule decides is which of the NODE's two spellings reaches the
   * page, never whether the block may keep an id of its own.
   */
  // "Never quote this": a boolean attribute, so its value is empty. Google
  // ignores any value a boolean attribute is given.
  if (decoration.nosnippet) extra["data-nosnippet"] = "";
  const renderedId = renderedDomId(node);
  if (renderedId !== undefined) extra.id = renderedId;
  // LAST, so every marker wins over a value the document or the block tried to
  // set for the same key.
  Object.assign(extra, markers);

  return Object.keys(extra).length > 0 ? cloneElement(output, extra) : output;
}
