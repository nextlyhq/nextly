/**
 * Which components a document references and uses, read without composing it:
 * component usage and reach, variant references, and the components a
 * placement installs.
 *
 * @module resolve-instances-references
 */
import type { BlockNode, ComponentDocument, ExposedProperty } from "./document";
import { walkForest } from "./forest-walk";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import { boundedLimit } from "./measure-bytes";
import { isPlainRecord } from "./plain-record";
import {
  appliedWrites,
  boundedNodeIndex,
  effectiveOverrides,
  finalProps,
  usableExposures,
} from "./resolve-instances-exposures";
import { componentIdOf } from "./resolve-instances-run";
import { boundedOwnKeys } from "./safe-record";

/**
 * What a document says about the components it references directly.
 *
 * Two values, because an empty list and an unread document are different
 * answers and a caller must be able to tell them apart. The walk is bounded,
 * and a bound that ends it early leaves a PREFIX — which, for the question an
 * index of this asks, is the dangerous direction: "references nothing" is what
 * permits deleting a component a page still renders.
 */
export interface ComponentUsage {
  /** The component ids the document references, in first-reached order. */
  ids: string[];
  /**
   * Whether the whole forest was read.
   *
   * False means `ids` is a prefix of the answer rather than the answer. A
   * caller must not read a missing id as absent while this is false.
   */
  complete: boolean;
}

/** One walk over a forest, answering both questions it is asked. */
interface ForestSurvey {
  /** The component ids it names, de-duplicated, in first-reached order. */
  readonly ids: string[];
  /** The instance nodes that name them, in the same order. */
  readonly placements: ComponentPlacement[];
  /** Whether the whole forest was read. */
  readonly complete: boolean;
}

/**
 * Which components a forest names, and which NODES name them.
 *
 * ONE traversal for both, because they are one question asked two ways and a
 * caller that needs both should not pay for the forest twice — nor risk two
 * walks disagreeing about the bound, the descent rule or the ordering. The
 * budget is spent per ENTRY, so the two answers are always prefixes of the same
 * read.
 */
function surveyForest(nodes: readonly unknown[], cap: number): ForestSurvey {
  const ids: string[] = [];
  const placements: ComponentPlacement[] = [];
  const seen = new Set<string>();
  let budget = cap;
  let truncated = false;
  walkForest(nodes, entry => {
    if (budget <= 0) {
      truncated = true;
      return "stop";
    }
    budget -= 1;
    const id = componentIdOf(entry.node);
    if (id !== undefined) {
      placements.push({ target: id, node: entry.node });
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return "descend";
  });
  return { ids, placements, complete: !truncated };
}

/**
 * The components a document references, and whether it could all be read.
 *
 * The richer of the two answers this module gives, with {@link componentIdsIn}
 * derived from it rather than computed beside it. They are one question, and
 * two walks over one forest agree on the day they are written: the narrow one
 * would go on returning a prefix silently after a change to the bound, the
 * ordering or the descent rule moved only the other.
 *
 * ORDER IS FIRST-REACHED, not sorted, because `componentIdsIn` publishes that
 * and its consumer is cache tagging. A caller comparing two answers for
 * equality has to sort them itself.
 */
export function componentUsageIn(
  nodes: readonly unknown[],
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ComponentUsage {
  // Through the published helper rather than a check written here, because its
  // own docblock says why it is published: more than one walk is held to these
  // numbers and they have to agree about what counts as a bound. A second rule
  // spelled locally is how two walks come to accept different budgets.
  //
  // `NaN` is the case that matters. Every `budget <= 0` comparison against it
  // is false, so the walk never stops — the bound is not loosened, it is GONE,
  // and an unbounded read of an arbitrarily large stored document is exactly
  // what the budget exists to prevent.
  //
  // A FRACTIONAL budget is accepted, and that is the helper's decision rather
  // than an oversight here. It costs at most one node beyond the cap — 2.5
  // reads three entries — and the answer stays truthful, because `complete`
  // reports what the walk actually reached rather than what the budget
  // allowed. Refusing it here and nowhere else would make this walk disagree
  // with the helper that exists to stop walks disagreeing.
  //
  // The RETURNED value is what the walk spends, though nothing can currently
  // tell it from `maxNodes`: the helper validates and returns its input
  // unchanged, so the two are the same number on every path that gets past it,
  // and a break-verify swapping them kills no test. Stated rather than left to
  // look tested, and kept anyway — a helper that later normalises, by flooring
  // a fraction say, is honoured here for free and silently ignored by the
  // other spelling.
  const cap = boundedLimit(maxNodes, "maxNodes", "componentUsageIn");
  // Through the shared walk, so this and {@link componentPlacementsIn} cannot
  // come to disagree about the bound, the descent rule or the ordering.
  const survey = surveyForest(nodes, cap);
  return { ids: survey.ids, complete: survey.complete };
}

/**
 * Every component a document can reference, over every variant it offers.
 *
 * {@link componentUsageIn} reads the ids the nodes CARRY, which is the right
 * answer to "what does this document reference as stored" and the wrong one to
 * "what can this document reach at runtime". A component may expose one of its
 * own instance nodes' `componentId` — `select` is an exposure type and
 * `componentId` a legal prop path, so "let the placer choose which card goes
 * here" is a supported shape — and a variant may then preset that exposure. The
 * override is applied BEFORE the nested instance is expanded, so the id the
 * variant installs is the one that resolves, and the id the node stores is
 * never read. Measured: with such a variant selected the resolver reports
 * `reason: "cycle"` and never references the stored id at all.
 *
 * Derived by APPLYING the overrides with the resolver's own writer and reading
 * the result back, the way {@link instanceExposure} answers its question, rather
 * than by looking for override keys that appear to name a component. Whether a
 * path lands, clobbers a string with a record, or loses to another exposure on
 * the same node is then answered by the write itself instead of by a list of
 * cases here that would be complete only until the next shape nobody enumerated.
 *
 * A SUPERSET of what any one reader receives, deliberately: only one variant is
 * selected at a time, and which one is decided by whoever places the component,
 * not by the document being judged. A caller refusing on what this returns
 * refuses a document that COULD close a loop, which is the safe direction for a
 * write guard and the reason this is separate from the usage index's question.
 *
 * A document offering no variants costs one extra record check.
 */
export function componentReferencesIn(
  document: unknown,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ComponentUsage {
  const { ids, complete } = componentReachIn(document, maxNodes);
  return { ids, complete };
}

/** What one document reaches, and the nodes it reaches through. */
export interface ComponentReachSurvey extends ComponentUsage {
  /** Its instance nodes, for an edge that belongs to the PLACEMENT. */
  readonly placements: readonly ComponentPlacement[];
}

/**
 * {@link componentReferencesIn} and {@link componentPlacementsIn}, from ONE walk.
 *
 * Published for the callers that need both — the write guard and the insert
 * panel each resolve a placement's overrides against the definition it places,
 * and each already needs the ids. Asking the two functions separately walks the
 * forest twice, which on a document whose nodes compute their own children is a
 * cost a reader can observe.
 */
export function componentReachIn(
  document: unknown,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ComponentReachSurvey {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return { ids: [], placements: [], complete: true };
  }
  const cap = boundedLimit(maxNodes, "maxNodes", "componentReachIn");
  const direct = surveyForest(document.nodes, cap);
  // A truncated forest is already "cannot be established" to every caller, and
  // the variant pass indexes the WHOLE forest to find the nodes an override
  // lands on. Returning here keeps an oversized document from being walked a
  // second time to sharpen an answer that is not going to be used.
  if (!direct.complete) {
    return { ids: direct.ids, placements: direct.placements, complete: false };
  }
  const withVariants = withVariantReferences(
    document,
    { ids: direct.ids, complete: true },
    cap
  );
  return { ...withVariants, placements: direct.placements };
}

/** {@link componentReferencesIn}'s variant pass, over a forest read whole. */
function withVariantReferences(
  document: Record<string, unknown>,
  direct: ComponentUsage,
  maxNodes: number
): ComponentUsage {
  // DERIVED from the per-variant answer rather than computed beside it: the
  // union is a view of the same walk, and two walks over one forest agree on the
  // day they are written. The CALLER's cap is forwarded: defaulting here made a
  // document the direct survey read completely come back unread from the variant
  // pass whenever the caller asked for a larger bound.
  const perVariant = variantReferencesIn(document, maxNodes);
  if (!perVariant.complete) return { ids: direct.ids, complete: false };

  const ids = [...direct.ids];
  const seen = new Set(ids);
  for (const installed of perVariant.byVariant.values()) {
    for (const id of installed) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, complete: true };
}

/** What each variant installs, and whether the variants could all be read. */
export interface VariantReferences {
  /** Variant name to the component ids its overrides install, in declared order. */
  readonly byVariant: ReadonlyMap<string, readonly string[]>;
  /** `false` where the variants or the forest could not be read within the bounds. */
  readonly complete: boolean;
}

/**
 * The component ids EACH variant installs, from ONE index of the forest.
 *
 * {@link componentReferencesIn} unions these, which answers "what could this
 * document reach" and not "what does this selection reach". A caller that
 * composes selections separately — a write guard confirming a refusal — needs
 * them apart, and needs them without paying for the forest again per variant:
 * the index is a property of the forest, and rebuilding it per variant is what
 * makes a document offering many of them quadratic in its own size.
 *
 * A variant absent from the map installs nothing. That is the useful half for a
 * caller deciding which selections are worth composing, because a variant that
 * installs no component id cannot add a reference — one that changes text or a
 * link does not reach the graph at all, and one that HIDES a node only removes
 * references the default selection was already judged on.
 */
export function variantReferencesIn(
  document: unknown,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): VariantReferences {
  const nothing = { byVariant: new Map<string, readonly string[]>() };
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return { ...nothing, complete: true };
  }
  const variants = document.variants;
  if (!isPlainRecord(variants)) return { ...nothing, complete: true };
  const names = boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES);
  // More variants than the envelope admits. Reported as unread rather than
  // scanned to the bound: a prefix of the variants is a prefix of the answer.
  if (names === null) return { ...nothing, complete: false };
  // No exposure means no override can reach a node, whatever the variants say.
  const declared = usableExposures(document.exposed);
  if (names.length === 0 || declared.length === 0) {
    return { ...nothing, complete: true };
  }

  // BOUNDED, because this is a public entry point: a caller may hand it an
  // imported document larger than any limit admits, and the internal callers
  // that happen to survey the forest first are a property of today's call graph
  // rather than a guarantee this function offers.
  const cap = boundedLimit(maxNodes, "maxNodes", "variantReferencesIn");
  const indexed = boundedNodeIndex(document.nodes as readonly BlockNode[], cap);
  if (!indexed.complete) return { ...nothing, complete: false };

  const byVariant = new Map<string, readonly string[]>();
  for (const name of names) {
    const installed = installedBy(document, name, declared, indexed.index);
    if (installed.length > 0) byVariant.set(name, installed);
  }
  return { byVariant, complete: true };
}

/**
 * The variants a placement of this definition can select, each on its own.
 *
 * {@link componentReferencesIn} unions them, which is the right answer to "what
 * could this document reach" and the wrong one to "what does a reader receive".
 * Only one variant resolves at a time, so a caller that must not diverge from
 * the rendered page — a write guard confirming a refusal, say — asks about each
 * selection separately rather than about their union. Unioning alternatives
 * invents chains that exist under none of them.
 *
 * A placement naming NO variant is a selection too, and the caller's to add:
 * this answers only what the document offers.
 *
 * `null` where the variants cannot be enumerated within the envelope bound, for
 * the reason {@link componentReferencesIn} reports the same case as unread — a
 * prefix of the variants is a prefix of the answer, and a caller cannot tell a
 * short list from a complete one.
 */
export function variantNamesIn(document: unknown): readonly string[] | null {
  if (!isPlainRecord(document)) return [];
  const variants = document.variants;
  if (!isPlainRecord(variants)) return [];
  return boundedOwnKeys(variants, MAX_ENVELOPE_ENTRIES);
}

/**
 * The component ids ONE variant's overrides put on this document's nodes.
 *
 * The overrides are applied and the result READ BACK, through the same four
 * functions the resolver and the inspector use — so whether a path lands, or
 * loses to another exposure on the same node, is answered by the write.
 */
function installedBy(
  document: Record<string, unknown>,
  variant: string,
  declared: readonly ExposedProperty[],
  nodes: ReadonlyMap<string, BlockNode>
): readonly string[] {
  return installedOn(
    document,
    { props: { variant } } as unknown as BlockNode,
    declared,
    nodes
  );
}

/**
 * Every component id ONE placing instance installs on a definition's nodes.
 *
 * The general form of {@link installedBy}: that one asks it of a synthetic
 * instance selecting a variant, and {@link componentReferencesFrom} asks it of
 * the real node doing the placing. Both are the same question — what does
 * `effectiveOverrides` write, and what does `componentIdOf` read back — so
 * neither restates the other's rules.
 */
function installedOn(
  document: Record<string, unknown>,
  instance: BlockNode,
  declared: readonly ExposedProperty[],
  nodes: ReadonlyMap<string, BlockNode>
): readonly string[] {
  const overrides = effectiveOverrides(
    document as unknown as ComponentDocument,
    instance
  );
  const installed: string[] = [];
  for (const [nodeId, props] of finalProps(
    nodes,
    appliedWrites(declared, overrides)
  )) {
    const node = nodes.get(nodeId);
    if (node === undefined) continue;
    // Through the reader the walk itself uses, so the node-type rule and the
    // non-empty-string rule are not restated here.
    const id = componentIdOf({ ...node, props });
    if (id !== undefined) installed.push(id);
  }
  return installed;
}

/** One instance node in a document, and the component it places. */
export interface ComponentPlacement {
  /** The component id the node places, as stored. */
  readonly target: string;
  /** The node itself, carrying the `variant` and `overrides` it places with. */
  readonly node: unknown;
}

/**
 * The placements a document makes, and whether the whole forest was read.
 *
 * Named for the DOCUMENT, because `ComponentPlacements` in `component-graph`
 * already names a different thing — the function answering what one component
 * places, by id. Two exported types of one name in one package is how a reader
 * comes to believe they are the same question.
 */
export interface DocumentPlacements {
  readonly placements: readonly ComponentPlacement[];
  /** False means `placements` is a prefix rather than the answer. */
  readonly complete: boolean;
}

/**
 * Every instance node a document holds, with the component each one places.
 *
 * {@link componentUsageIn} answers which components a document names;
 * this answers WHICH NODES name them, which is what a caller needs to follow an
 * edge that belongs to the placement rather than to either document — see
 * {@link componentReferencesFrom}.
 *
 * Bounded by the same budget and reported the same way: a forest the cap ended
 * early leaves a prefix, and a prefix read as the whole answer is how a
 * reference goes unnoticed.
 *
 * Nodes are returned as `unknown` deliberately. They come from storage, nothing
 * validated them, and the only thing a caller does with one is hand it back to a
 * function in this module that guards its own reads.
 */
export function componentPlacementsIn(
  document: unknown,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): DocumentPlacements {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return { placements: [], complete: true };
  }
  const cap = boundedLimit(maxNodes, "maxNodes", "componentPlacementsIn");
  const survey = surveyForest(document.nodes, cap);
  return { placements: survey.placements, complete: survey.complete };
}

/** What one placement installs, and whether the definition could all be read. */
export interface PlacementReferences {
  /** The component ids the placement's overrides put on the definition's nodes. */
  readonly ids: readonly string[];
  /**
   * Whether the definition's forest fit within the node bound.
   *
   * `false` makes `ids` meaningless rather than partial: a caller deciding what
   * a document reaches must treat it as unread, the way every other survey in
   * this module reports the same case.
   */
  readonly complete: boolean;
}

/**
 * Every component a PLACEMENT can reach, which neither document names alone.
 *
 * {@link componentReferencesIn} covers what a definition's own variants can
 * install, because the exposure written through is declared in the same
 * document. This covers the other half, and it needs both documents at once.
 *
 * An instance node placing B may carry `props.overrides` aimed at B's exposures.
 * If B exposes one of its own nested instances' `componentId`, that override
 * re-points it — so placing B from A can resolve to A → B → A while neither A's
 * document nor B's names the other twice. A scans as referencing B, B scans as
 * referencing whatever it stores, and the loop is in neither scan.
 *
 * The resolver applies the placement's overrides before expanding B, so the id
 * this returns is the one that resolves and the id B stores is never read.
 *
 * Takes the placed DEFINITION and the placing NODE because the edge belongs to
 * neither on its own: the override names an exposure id, and only the definition
 * says which node and which prop path that id writes to.
 *
 * Includes what the node's selected VARIANT installs as well, because
 * `effectiveOverrides` folds variant then instance — which is the order the
 * renderer applies them in.
 */
export function componentReferencesFrom(
  definition: unknown,
  instance: unknown,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): PlacementReferences {
  if (!isPlainRecord(definition) || !Array.isArray(definition.nodes)) {
    return NO_REFERENCES;
  }
  if (!isPlainRecord(instance)) return NO_REFERENCES;
  const declared = usableExposures(definition.exposed);
  // No exposure means no override can reach a node, so the forest is not walked
  // at all — which is what keeps the ordinary placement free.
  if (declared.length === 0) return NO_REFERENCES;

  const cap = boundedLimit(maxNodes, "maxNodes", "componentReferencesFrom");
  const indexed = boundedNodeIndex(
    definition.nodes as readonly BlockNode[],
    cap
  );
  // A TRUNCATED index cannot answer this. An override names an exposure, and the
  // exposure names the node it writes to by id — so a node the index never
  // reached is indistinguishable from an override that lands nowhere, and the
  // ids found so far are a prefix. Reported as unread rather than returned,
  // because a prefix here is exactly what "references nothing" looks like.
  if (!indexed.complete) return { ids: [], complete: false };

  return {
    ids: installedOn(
      definition,
      instance as unknown as BlockNode,
      declared,
      indexed.index
    ),
    complete: true,
  };
}

/** Shared, because the four "nothing to install" exits are the same answer. */
const NO_REFERENCES: PlacementReferences = { ids: [], complete: true };

/**
 * The component ids a document references directly, in first-reached order.
 *
 * Answers nothing about whether the whole document was read. A caller deciding
 * whether a component is USED needs {@link componentUsageIn} instead: a walk
 * this one truncated returns a prefix that is indistinguishable here from a
 * document referencing nothing.
 */
export function componentIdsIn(
  nodes: readonly unknown[],
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): string[] {
  return componentUsageIn(nodes, maxNodes).ids;
}
