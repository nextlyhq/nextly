/**
 * The block types at the roots of a document as resolution would compose it,
 * read without composing it.
 *
 * @module resolve-instances-roots
 */
import {
  type BlockDocument,
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  type ComponentDocument,
} from "./document";
import { MAX_COMPOSED_DEPTH } from "./limits";
import { isPlainRecord } from "./plain-record";
import type {
  ComponentLookup,
  ComponentUnresolvedReason,
  ResolveComponentOptions,
  ResolvedBlockNode,
} from "./resolve-instances-contract";
import {
  definitionFor,
  type DefinitionReader,
  readableDefinition,
} from "./resolve-instances-expand";
import { type NodePlan, planEdits } from "./resolve-instances-exposures";
import {
  componentIdOf,
  type ComposedScope,
  ROOT_SCOPE,
} from "./resolve-instances-run";
import { isConditionGated } from "./visibility";

// ---------------------------------------------------------------------------
// The roots a document composes to, without composing it
// ---------------------------------------------------------------------------

/**
 * The block types at the roots of a document as `resolveComponentInstances`
 * would compose it — read without composing it. Each type ONCE, in the order
 * it is first met.
 *
 * A palette judges where a component may be placed by the ROOTS of what it
 * draws, and a library of three thousand definitions asks that of every one
 * when it opens. Composing each to read its roots clones every definition it
 * reaches, so a library of small wrappers around one large definition costs
 * its size per wrapper; this reads the roots and follows a root instance into
 * the definition it names, reading each definition once, so it costs the
 * roots.
 *
 * The types rather than the roots, because the question asked of the answer
 * — may every one of these sit here — reads each type once, and the composed
 * forest can be far wider than the set of types at its roots: a definition
 * whose roots are two hundred instances of another whose roots are two
 * hundred more composes to forty thousand roots of one type. Answering the
 * forest's width would cost that per query; answering its types costs the
 * registry's. For the same reason a definition's roots are answered once per
 * query and remembered, whatever number of instances point at it and at
 * whatever depth — with one care, in {@link rootTypesOfNode}: what fits at
 * the surface may not fit at the composition cap.
 *
 * `undefined` where the resolver would leave a root STANDING — an instance
 * it cannot expand — because a root the resolver leaves standing is a
 * placeholder the palette must not judge as a block. The refusals are the
 * resolver's own, asked through the same reader: a missing or unreadable
 * definition, a cycle, the composition cap, and an instance gated by an
 * entry-field condition, which the resolver returns unexpanded. A gated BLOCK
 * stays a root, as it does in the composed forest. What is not asked is room:
 * the node budget and the depth cap are properties of the page the document
 * is placed on, and the placement's own preflight asks the resolver about
 * those with the page in hand.
 *
 * Empty for a document whose roots compose to nothing, which is a document
 * with nothing to place.
 */
export function composedRootTypes(
  document: BlockDocument,
  definitions: ComponentLookup,
  options: Pick<ResolveComponentOptions, "maxComposedDepth"> = {}
): readonly string[] | undefined {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return undefined;
  }
  const reader: RootsReader = {
    definitions,
    maxComposedDepth: options.maxComposedDepth ?? MAX_COMPOSED_DEPTH,
    definitionsRead: new Map<
      string,
      ComponentDocument | ComponentUnresolvedReason
    >(),
    rootsRead: new Map<string, RememberedRoots>(),
  };
  // The one boundary, at the published entry point rather than per definition,
  // because the document's own roots are read by the same walk and no
  // per-definition guard covers them.
  //
  // Caught rather than asked first, which is this module's usual answer to a
  // stored shape: what raises here is a property ACCESSOR, and reading the
  // property IS the raise, so there is no question to ask before it. An
  // in-process caller can supply one — the lookup is a Map the host fills, not
  // a document parsed from a response — and the RESOLVER survives such a node.
  // A query the resolver outlives must not be what takes the editor down: its
  // one caller builds the insert panel's catalogue, so a single unreadable
  // definition would leave an author no panel at all.
  //
  // `undefined` is the answer already defined for a forest this cannot judge,
  // and its callers already withhold the tile for it.
  try {
    return rootTypesOf(document.nodes, reader, ROOT_SCOPE);
  } catch {
    return undefined;
  }
}

/**
 * The block types a NODE is judged by when the nesting rule is asked about it.
 *
 * A block answers with its own type. A component instance answers with the
 * ROOTS of the definition it draws, read through the same lookup the canvas
 * resolves against — because `nextly/component-instance` is not a registered
 * block, and every rule spelled over types gets the wrong answer for it in
 * both directions. A parent rule finds no restriction on the instance type and
 * admits a component whose root belongs only inside a Columns; a slot naming
 * what it admits does not name the instance type and bars every component from
 * it, including the ones drawing exactly what the slot asks for.
 *
 * One rule and one implementation, because the palette, the keyboard move and
 * the planners all ask it, and an offer that resolves against a forest the
 * mutation does not resolve is an offer the click then refuses — or worse,
 * accepts.
 *
 * An instance that does not resolve — no definition, an unreadable one, a
 * definition composing to nothing, a root the resolver would leave standing —
 * is judged by its own type, which is to say not at all. It draws as a
 * placeholder wherever it sits, and refusing to carry one would pin a
 * placeholder to the spot it was left in, or make a whole pattern unplaceable
 * because one row of the library is gone.
 *
 * Without a lookup every node is judged by its own type. That is the answer a
 * caller holding no library gets, and it is the behaviour every caller had
 * before the lookup existed.
 */
export function placementTypesOf(
  node: BlockNode,
  definitions?: ComponentLookup
): readonly string[] {
  // Read defensively, because a STORED forest reaches this: the internal
  // nesting walk says in as many words that a slot may hold anything, and
  // asking what a node draws reads one field further than asking its type did.
  // The planners shape-check their forest before they get here, so this is a
  // boundary rather than the whole defence — what it must not do is turn a
  // malformed entry into a raise where a refusal belongs.
  const type = isPlainRecord(node) ? node.type : undefined;
  // No type is no answer: the nesting rule has nothing to judge, and the shape
  // rule refuses the node before anything is placed.
  if (typeof type !== "string") return [];
  if (definitions === undefined || type !== COMPONENT_INSTANCE_TYPE) {
    return [type];
  }
  const props = (node as unknown as Record<string, unknown>).props;
  const componentId = isPlainRecord(props) ? props.componentId : undefined;
  if (typeof componentId !== "string") return [type];
  // The lookup is READ inside the boundary, not before it. It is a
  // caller-supplied object rather than a map this module builds, and the
  // boundary inside the roots query does not cover a `get` that raises — which
  // escapes to exactly the caller that boundary exists for.
  try {
    const document = readableDefinition(definitions.get(componentId));
    if (document === undefined || document.nodes.length === 0) return [type];
    const roots = composedRootTypes(document, definitions);
    return roots === undefined || roots.length === 0 ? [type] : roots;
  } catch {
    return [type];
  }
}

/** A definition's root types as answered once, and how deep an instance they hold for. */
interface RememberedRoots {
  readonly types: readonly string[];
  /**
   * The depth of the deepest instance these were answered at.
   *
   * The composition cap refuses by depth, so an answer is a fact about the
   * definition only down to here: what fit under an instance at depth one can
   * be refused under one at depth four, where the cap is met sooner. An
   * answer holds for every shallower instance — the same walk, with more
   * room — and is reused there; a deeper one is walked afresh.
   */
  readonly depth: number;
}

/** What the roots query needs of a run: the reader, and the answers it has already given. */
interface RootsReader extends DefinitionReader {
  rootsRead: Map<string, RememberedRoots>;
}

/**
 * The types at the roots of one forest, each once, or nothing when any root
 * cannot be answered.
 */
function rootTypesOf(
  nodes: readonly unknown[],
  reader: RootsReader,
  scope: ComposedScope,
  plans?: ReadonlyMap<string, NodePlan>
): readonly string[] | undefined {
  // A set kept in insertion order, so the answer lists types as the composed
  // forest would first meet them and a verdict's first refusal is the
  // forest's first.
  const out = new Set<string>();
  for (const node of nodes) {
    const types = rootTypesOfNode(node, reader, scope, plans);
    if (types === undefined) return undefined;
    for (const type of types) out.add(type);
  }
  return [...out];
}

/** What one root stands for: its own type, or its definition's root types one scope deeper. */
function rootTypesOfNode(
  node: unknown,
  reader: RootsReader,
  scope: ComposedScope,
  plans?: ReadonlyMap<string, NodePlan>
): readonly string[] | undefined {
  // A root the INLINER would drop stands for nothing: `cloneDefinitionForest`
  // skips a node that is not a record or whose id is not a string, so it never
  // lands on the page. Counted, a component would be judged by the type of a
  // root the page never gets — and one whose every root is dropped would be
  // offered as placing something and place nothing.
  if (!isPlainRecord(node) || typeof node.id !== "string") return [];
  // What the instance holding this definition decided about this very node.
  // `cloneDefinitionNode` returns nothing at all for `visible === false`, so a
  // root an override hides stands for no type — a component whose only root is
  // hidden composes to nothing and must not be offered as placing anything.
  // `true` is the other half of the same rule: it deletes the node's own gate
  // before the instance branch is reached, so a gated root the instance turns
  // on is expanded rather than left standing.
  const shown = plans?.get(node.id)?.visible;
  if (shown === false) return [];
  const { type } = node;
  // A node the inliner keeps and this cannot name: the nesting rule has no
  // type to judge, so the caller is told nothing rather than a guess.
  if (typeof type !== "string") return undefined;
  if (type !== COMPONENT_INSTANCE_TYPE) return [type];
  return instanceRootTypes(node, reader, scope, shown === true);
}

/**
 * What one INSTANCE root stands for: the root types of the definition it
 * draws, or nothing where the resolver would leave it standing.
 *
 * `ungated` is the instance holding it having said "show this", which deletes
 * the node's own gate before the resolver reaches its instance branch.
 */
function instanceRootTypes(
  node: Record<string, unknown>,
  reader: RootsReader,
  scope: ComposedScope,
  ungated: boolean
): readonly string[] | undefined {
  // The resolver's own order: a gated instance is returned standing before
  // its id is even read, and an instance naming no component is malformed.
  if (!ungated && isConditionGated(node)) return undefined;
  const componentId = componentIdOf(node);
  if (componentId === undefined) return undefined;
  // The refusals first, and the resolver's own — a cycle or the cap refuses
  // THIS instance whatever was answered for its definition elsewhere.
  const found = definitionFor(componentId, reader, scope);
  if (typeof found === "string") return undefined;
  return definitionRootTypes(componentId, found, reader, scope, node);
}

/**
 * Whether any plan decides a node's visibility.
 *
 * The ordinary instance decides none — it overrides props, or nothing at all —
 * and then its definition's roots are the definition's own, which is the answer
 * worth remembering across every instance that points at it. Only an instance
 * that hides or shows one of them asks a question of its own.
 */
function hidesOrShows(plans: ReadonlyMap<string, NodePlan>): boolean {
  for (const plan of plans.values()) {
    if (plan.visible !== undefined) return true;
  }
  return false;
}

/**
 * A definition's root types for an instance at this scope: the answer already
 * given for it at this depth or a deeper one, or walked and remembered.
 */
function definitionRootTypes(
  componentId: string,
  definition: ComponentDocument,
  reader: RootsReader,
  scope: ComposedScope,
  instance: Record<string, unknown>
): readonly string[] | undefined {
  // The resolver's OWN planner, not a second reading of `props.overrides`: it
  // is what decides a node's visibility when the page is drawn, it folds the
  // chosen variant's presets under the instance's own answers, and a rule
  // spelled twice is one that will eventually differ from the render.
  const plans = planEdits(
    definition,
    instance as unknown as ResolvedBlockNode,
    undefined,
    false
  );
  const decided = hidesOrShows(plans);
  // Remembered answers are a property of the DEFINITION. An instance that
  // decides its visibility is asking a different question, so it neither reads
  // the memo nor writes to it — two instances of one component can hide
  // different roots, and the first would otherwise answer for the second.
  const remembered = decided ? undefined : reader.rootsRead.get(componentId);
  if (remembered !== undefined && scope.depth <= remembered.depth) {
    return remembered.types;
  }
  const types = rootTypesOf(
    definition.nodes,
    reader,
    {
      depth: scope.depth + 1,
      onPath: new Set(scope.onPath).add(componentId),
    },
    decided ? plans : undefined
  );
  // Only an ANSWER is remembered. A refusal under this instance can be a
  // property of where it sits — the cap, or a loop closed through the path
  // above — and the same definition may answer under the next.
  if (types !== undefined && !decided) {
    reader.rootsRead.set(componentId, { types, depth: scope.depth });
  }
  return types;
}
