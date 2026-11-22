/**
 * What instance resolution takes and returns: the reasons an instance is left
 * standing, the resolved node and document shapes, the lookup and options a
 * caller hands in, and the composition result.
 *
 * @module resolve-instances-contract
 */
import type { BlockDocument, BlockNode, ExposedPropertyType } from "./document";
import type { DocumentLimits } from "./limits";

/**
 * Why an instance was left standing instead of being replaced by its
 * definition's tree.
 *
 * A closed list rather than a message, because each reason has a different
 * remedy and the surface showing it has to pick one: `missing` asks the author
 * to publish or restore a component, `cycle` asks them to break a containment
 * loop, `depth` and `budget` are limits, and `malformed` and `unreadable` are
 * document faults no author action fixes. A rendered string would carry the
 * same information in a form nothing can branch on and nothing can translate.
 */
export const COMPONENT_UNRESOLVED_REASONS = [
  /** No definition was supplied for the referenced id. */
  "missing",
  /** The component reaches itself through its own tree. */
  "cycle",
  /** Components nested inside components passed `MAX_COMPOSED_DEPTH`. */
  "composed-depth",
  /**
   * The definition's OWN tree is deeper than `limits.maxDepth`.
   *
   * Its own reason rather than sharing `composed-depth`, because the author's
   * remedy is the opposite one: flatten this component's content, rather than
   * stop nesting it inside others.
   */
  "node-depth",
  /**
   * Inlining it would pass the run's node budget, or the work allowance the
   * caller supplied. Both are limits on the same resolution and share a remedy.
   */
  "budget",
  /** The instance node names no component at all. */
  "malformed",
  /**
   * A definition WAS supplied under this id and cannot be read — an envelope
   * this build does not understand, or a document that is not a component.
   *
   * Its own reason rather than sharing `malformed`, because the two point at
   * different documents. `malformed` is a fault in the page holding the
   * instance; this is a fault in the component the instance correctly names,
   * and a surface that cannot tell them apart sends whoever is debugging to
   * the healthy one. Both differ from `missing`, which asks somebody to
   * publish or restore a component that was never supplied.
   */
  "unreadable",
] as const;

/** Derived from the list, so the pair cannot be half-changed. */
export type ComponentUnresolvedReason =
  (typeof COMPONENT_UNRESOLVED_REASONS)[number];

/**
 * A node in a RESOLVED tree, which is not a node in a stored one.
 *
 * The two extra fields are render-time facts, so they extend `BlockNode`
 * rather than joining it. `BlockNode`'s key set is the stored format and is
 * frozen: a field added there is a field every external producer of a document
 * has to know about and every published schema has to describe, which is
 * exactly the wrong claim for a marker that never survives a save.
 */
export interface ResolvedBlockNode extends BlockNode {
  /**
   * The instance node, IN THE HOST DOCUMENT, this node was composed for.
   *
   * Set on every node that came from a definition, never on one an author
   * placed. It is the discrimination the editor cannot make any other way: an
   * instance's slot content is nested INSIDE the inlined tree and is the
   * page's own, so "sits under an inlined root" answers "is this editable?"
   * wrongly for exactly the nodes a marketer is there to edit.
   *
   * The HOST's instance at every depth, not the nearest one. A component that
   * holds another component is replaced by the tree it stands for, so its own
   * node is not in the resolved document and naming it would hand the editor
   * an id it cannot select — and the author never placed that inner instance
   * anyway; they placed the one on the page.
   */
  instanceOf?: string;
  /**
   * Why a component instance could not be inlined, set on the instance node
   * itself in place of the subtree it stands for.
   *
   * The instance node is KEPT rather than dropped, the way `migrationFailed`
   * keeps a node whose upgrade failed. A dropped instance is indistinguishable
   * from a page that never had one — so the editor could not offer "publish
   * this component", and an author would see a region silently missing with
   * nothing to act on.
   */
  unresolvedComponent?: ComponentUnresolvedReason;
  /**
   * Which of the placement's exposures feeds each prop of this node, as prop
   * path to exposure id. Recorded only when a resolution asks for it
   * ({@link ResolveComponentOptions.exposures}), so a page served to a reader
   * never carries it.
   *
   * The editor's address for a value inside a component: the node itself is
   * re-identified and absent from the stored page, so an edit on the canvas
   * reaches the value through `instanceOf` and this id, and is written as the
   * placement's own value. Only the HOST placement's component is mapped: a
   * component nested inside it is reached through that component's own
   * fields, never directly.
   */
  exposedProps?: Readonly<Record<string, PropExposure>>;
  slots?: Record<string, ResolvedBlockNode[]>;
}

/**
 * The host placement's exposure that feeds one prop of a composed node: its
 * id, which the placement's value is stored under, and its type, which says
 * what an editor may write there (free text only through a `text` exposure).
 */
export interface PropExposure {
  readonly id: string;
  readonly type: ExposedPropertyType;
}

/** A document whose component instances have been resolved. */
export interface ResolvedDocument extends BlockDocument {
  nodes: ResolvedBlockNode[];
}

/**
 * The definitions a resolution may reach, keyed by document id.
 *
 * A `Map` rather than a record, and it is not a style preference. The keys are
 * component ids read from a stored document, and a plain record answers
 * `constructor` with a function on a key it never had — so a page referencing a
 * component called `constructor` would resolve against `Object.prototype`'s
 * method and inline whatever a property read of `.nodes` on it returned.
 */
export type DefinitionsById = ReadonlyMap<string, BlockDocument>;

/**
 * How a resolution reaches a definition.
 *
 * A lookup rather than the map itself, so that PREPARING a definition and
 * DECIDING to read one are the same act. A caller that repairs its definitions
 * up front has to predict which ones this run will reach, and reachability is
 * decided here: after an instance's overrides have chosen a component, under
 * the composition cap, over the tree the caller's own shape pass retained.
 * Every one of those is a place a second traversal answers differently, and a
 * disagreement costs the page a definition that WAS supplied.
 *
 * `has` and `get` are separate questions and both are asked. Absence means
 * nobody supplied a definition; a value that cannot be read means one was
 * supplied and is corrupt, and the reasons this module reports keep them
 * apart — so a lookup must not answer `has` from whether `get` produced
 * something.
 *
 * A `ReadonlyMap` satisfies it, which is what every caller holding its
 * definitions in memory passes.
 */
export interface ComponentLookup {
  /** Whether anybody supplied a definition under this id. */
  has(id: string): boolean;
  /** That definition, or nothing when it cannot be read. */
  get(id: string): BlockDocument | undefined;
}

/**
 * Work a caller lets its resolutions spend, shared across every call handed it.
 *
 * `left` is decremented in place as a resolution spends it, so a caller reads
 * what remains after a call without being told separately.
 */
export interface WorkAllowance {
  /** What remains. `Infinity` sets no bound; the allowance is spent at zero. */
  left: number;
}

/** How much work one resolution may do. */
export interface ResolveComponentOptions {
  /** Node and depth caps for the tree being built. Defaults to `DEFAULT_LIMITS`. */
  limits?: DocumentLimits;
  /** Levels of component nesting allowed. Defaults to `MAX_COMPOSED_DEPTH`. */
  maxComposedDepth?: number;
  /**
   * An allowance charged for every definition entry this resolution clones or
   * prepares, for a caller that composes more than once and must bound the total.
   *
   * `limits.maxNodes` bounds what ONE composition may PRODUCE, which says nothing
   * about the work behind it or how often that work is repeated. An expansion
   * refused for the node budget is rolled back and gives its budget back, so each
   * later instance of that definition attempts it again; a node an override hides
   * is refunded the same way. This allowance is charged for all of it and gives
   * nothing back.
   *
   * Once it is spent, every instance still to be expanded is refused for
   * `budget`, exactly as one past the node budget is. The survey of the host
   * document is not charged: every call makes it once, and `limits.maxNodes`
   * already bounds it. Omitted, a resolution is bounded by its limits alone.
   */
  work?: WorkAllowance;
  /**
   * Record on each composed node which exposure feeds each of its props
   * ({@link ResolvedBlockNode.exposedProps}). For an editor only: a render
   * leaves it off, and its output carries no map.
   */
  exposures?: boolean;
  /**
   * What happens to an instance carrying visibility conditions. `"stand"`,
   * the default, leaves it standing, gate and all, for the pass that prunes
   * hidden nodes to remove: a reader that decides no condition composes
   * nothing it will not serve. `"carry"` expands it, and every root that
   * replaces it carries the instance's conditions joined to its own, for a
   * reader that decides each condition against the entry or the list item:
   * the composed tree then shows exactly where the instance would have.
   *
   * @experimental Settles with the editor's condition controls.
   */
  conditioned?: "stand" | "carry";
}

/** One instance that was left standing, and why. */
export interface UnresolvedInstance {
  /** The instance node's id, as it appears in the returned document. */
  instanceId: string;
  /** The component it referenced; empty when the node named none. */
  componentId: string;
  reason: ComponentUnresolvedReason;
}

/** What a resolution produced. */
export interface ResolvedComposition {
  /** The document with every resolvable instance inlined. */
  document: ResolvedDocument;
  /**
   * Every definition id this resolution READ, in first-reached order,
   * unresolvable ones included.
   *
   * Unresolvable ones belong in it because the list's consumer is cache
   * tagging: a page that failed to resolve a component because it is not
   * published yet must still regenerate when it IS, and a tag list built only
   * from successes is exactly the list that never recovers.
   */
  referenced: readonly string[];
  /** Every instance that could not be inlined. Empty on a clean resolution. */
  unresolved: readonly UnresolvedInstance[];
  /**
   * Every DOM id this resolution minted, mapped back to what it came from.
   *
   * Empty when nothing was scoped, which is also what a document holding no
   * instances returns — the two say the same thing to every reader.
   */
  renamedDomIds: ReadonlyMap<string, string>;
  /**
   * Every component a reference loop closed on, in the order the loops closed.
   *
   * Kept when an expansion stopped by a limit is rolled back, which `unresolved`
   * is not. `unresolved` describes the tree this returns, so a refusal made
   * inside a subtree nobody receives is dropped from it; a loop is a property of
   * the definitions, and it exists whether or not the expansion that found it
   * had room to finish. A loop inside an expansion refused as `unreadable` is
   * dropped as well, because that instance is drawn as a placeholder with no
   * loop in it. A caller asking whether the definitions loop at all reads this.
   */
  loopsClosed: readonly string[];
}

/**
 * The prefix every inlined node's id wears.
 *
 * Deliberately not a UUID shape. Stored ids are UUIDs, so a reader looking at a
 * resolved tree — in the DOM, in a React warning, in a stylesheet — can tell at
 * a glance which nodes exist in the stored document and which were composed for
 * this render, and nothing that persists an id can mistake one for the other.
 */
export const SCOPED_ID_PREFIX = "cx-";

/**
 * How many dot segments of a `propPath` are followed.
 *
 * A bound on work rather than a design opinion. The path comes from a stored
 * definition that nothing here validated, and each segment costs a record copy.
 */
export const MAX_PROP_PATH_SEGMENTS = 16;
