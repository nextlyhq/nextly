/**
 * Saving a selection as a linked component: saving it, converting it in place,
 * and duplicating a component; reading the exposures and slots an author
 * nominated; and the refusals only a component asks for, such as an exposure
 * that names two nodes or a composition nested too deep.
 *
 * @module composition-planners-components
 */
import type {
  LibraryTarget,
  PlanRefusal,
  PlanResult,
} from "./composition-planners-contract";
import {
  plannedSave,
  type PlannedSave,
  type RestampOps,
  type RunPlacement,
} from "./composition-planners-patterns";
import {
  countById,
  destinationOf,
  duplicateDomIdRefusal,
  lockRefusal,
  orphanedAnchorWarnings,
  overIndexBound,
  placementRefusal,
  shapeRefusal,
} from "./composition-planners-refusals";
import {
  type BlockDocument,
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  type ComponentDocument,
  type ExposedProperty,
  type ExposedPropertyType,
  type ExposedSlot,
  isComponentDocument,
} from "./document";
import {
  DEFAULT_LIMITS,
  type DocumentLimits,
  MAX_ENVELOPE_ENTRIES,
} from "./limits";
import { type DocumentSurvey, surveyDocument } from "./measure-bytes";
import type { NestingSource } from "./nesting";
import {
  applyOps,
  type BuilderOp,
  documentRefusal,
  forestRefusal,
  listRefusal,
  type OpPosition,
  subtreeRemovalRefusal,
} from "./ops";
import { isPlainRecord } from "./plain-record";
import {
  componentIdsIn,
  type ComponentLookup,
  type ComponentUnresolvedReason,
  resolveComponentInstances,
  type ResolvedBlockNode,
} from "./resolve-instances";
import { boundedOwnKeys, defineEntry } from "./safe-record";
import { newId, reidForestWithMap, walkNodes } from "./tree";
import { componentEnvelopeIssues, isErrorIssue } from "./validation";

// ---------------------------------------------------------------------------
// Components — a selection saved as a LINKED definition
// ---------------------------------------------------------------------------

/**
 * One property of the saved definition an instance will be allowed to override.
 *
 * Named in the PAGE's vocabulary: `nodeId` is a node id as it stands in the
 * document being saved from, because that is the only id the surface that
 * nominated it has ever seen. The save re-mints every one of them, and the
 * planner re-aims the pointer — see `SavedPattern.nodeIds`.
 *
 * ## Why the caller nominates these and the planner does not derive them
 *
 * Which of a block's props is a headline and which is a spacing knob is a
 * property of that block's DEFINITION, and the engine cannot read one: a
 * planner is pure and holds no registry, by ruling, so the vocabulary it would
 * have to classify by is not reachable from here. The same boundary already
 * stops this module synthesising an `assets` index and stops the envelope
 * validator resolving a `propPath` against a schema.
 *
 * That is a division of labour rather than a limitation. The surface doing the
 * nominating has the registry, and it also has the author — and every
 * comparable tool measured (Webflow, Figma, Framer, Builder.io, WordPress
 * synced patterns) makes the author confirm each editable field rather than
 * committing silently. A pre-selection is a suggestion to review; the planner's
 * job is to say whether the reviewed answer will survive being stored.
 */
export interface RequestedProperty {
  /** The stable slug instances will key their overrides by. */
  readonly id: string;
  /** What the inspector will call it. */
  readonly label: string;
  /** A node id in the SOURCE document, inside the selection. */
  readonly nodeId: string;
  /** Dot path into that node's props, in the binding-path grammar. */
  readonly propPath: string;
  readonly type: ExposedPropertyType;
  /** The choices, for `select` only. */
  readonly options?: readonly { value: string; label: string }[];
}

/**
 * A region of the saved definition an instance will be allowed to fill.
 *
 * `nodeId` is a SOURCE document id, on the same terms as
 * {@link RequestedProperty.nodeId}. No `id` field: the key of
 * {@link ComponentExposure.slots} is the id, for the reason {@link ExposedSlot}
 * gives — one spelling makes a disagreement between key and field
 * unrepresentable rather than merely detectable.
 */
export interface RequestedSlot {
  readonly label: string;
  readonly nodeId: string;
  /** Which of that node's slots. */
  readonly slot: string;
  /** Block types the slot accepts; unset accepts whatever the container does. */
  readonly allow?: readonly string[];
}

/** What the author chose to leave editable on the component being saved. */
export interface ComponentExposure {
  readonly properties?: readonly RequestedProperty[];
  readonly slots?: Readonly<Record<string, RequestedSlot>>;
}

/**
 * Save a contiguous run of blocks as a component DEFINITION.
 *
 * **The page is not touched**, exactly as `planSaveAsPattern` does not
 * touch it: this fills the library and leaves the original blocks where they
 * are. Replacing them with an instance is {@link planConvertToComponent}, and
 * the difference between the two is that one line of ops and nothing else.
 *
 * **The tree it stores is byte-for-byte the tree a pattern save would store**
 * from the same selection — one builder, `savedPatternDocument`, for the
 * reason given there. A component is that document plus an envelope and a
 * `kind`, not a second way of copying a selection.
 *
 * ## The envelope is where the ids stop matching
 *
 * `exposed` and `slots` are POINTERS into the tree, and the save re-mints every
 * node id in it. A pointer copied across unchanged names a pre-copy id the
 * stored document does not contain — and that definition loads, renders, and
 * offers the property in the inspector, where editing it writes an override
 * that resolves to nothing. The failure surfaces on every instance in the site
 * as "my change did nothing", far from the save that caused it.
 *
 * So each pointer is re-aimed through the map the copy returned. A nomination
 * naming a node OUTSIDE the selection has no entry in that map and is carried
 * across untouched, which the envelope check then reports for exactly what it
 * is. That is deliberate: minting a fresh id makes the collision impossible, so
 * a surviving page id cannot be mistaken for a stored one, and the rule that
 * says whether a pointer resolves stays in one place instead of two.
 *
 * ## What it refuses
 *
 * Everything `planSaveAsPattern` refuses about the selection, through the
 * same call — plus everything the definition's own publish gate would refuse
 * about the envelope, asked as {@link componentEnvelopeIssues} rather than
 * re-implemented: a pointer at a node that is not there, two exposures sharing
 * an id, a prop path that is not a path, options on something that is not a
 * `select` and a `select` without them, a slot the node does not declare, and a
 * type outside the vocabulary. Strict validation is the publish gate for this
 * collection, so a definition that fails it is one an author could save and
 * never publish; refusing here happens while they still have the selection in
 * front of them.
 */
export function planSaveAsComponent<TFields>(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: LibraryTarget<TFields>,
  exposure: ComponentExposure,
  nesting: NestingSource,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<TFields> {
  const saved = plannedSave(document, selectedIds, nesting, limits);
  if (saved.problem !== undefined) return saved;

  const definition = componentDocument(saved, exposure, limits);
  if (definition.problem !== undefined) return definition;

  return {
    create: {
      collection: target.collection,
      document: definition.document,
      fields: target.fields,
    },
    pageOps: [],
    warnings: [],
  };
}

/**
 * Save a run as a component AND replace it on the page with one instance.
 *
 * {@link planSaveAsComponent} plus the ops that take the run out and put a
 * linked instance where it stood. Built here beside it rather than in a second
 * module, because the two have to agree about what was stored and where it came
 * from, and a save whose replacement is written somewhere else is a round trip
 * nothing tests end to end.
 *
 * ## The definition's id comes from the caller
 *
 * The instance carries the definition's id in its props, so the ops and the row
 * they point at have to agree — and the only moment they can be made to is
 * before either is written. A planner cannot mint one: the id format belongs to
 * the collection the row lands in, which the engine cannot see. So the caller
 * decides it, the ops name it, and `PlannedCreate.id` echoes it back so
 * the plan is executable without its caller having to remember what it passed.
 *
 * A caller that creates the row under a DIFFERENT id has built an instance
 * pointing at nothing. That is the one failure this shape cannot refuse, and it
 * is refusable by construction on the other side: the create and the ops are
 * one unit of work, and the id is an input to both.
 *
 * ## Ops, in this order
 *
 * Every selected root is removed, then one instance is inserted at the index
 * the first of them held. The run is contiguous and sorted, so after the
 * removes that index is where the run began — including when the run ended the
 * list, where it is an append.
 *
 * ## What it refuses that the save alone does not
 *
 * The plan IS the dry run, so every refusal these ops would meet is made here:
 * a locked block on the page, which `remove` refuses for a reason no re-ordering
 * of the group can satisfy; a selected root the document holds twice, which
 * `remove` refuses because it could not say which it meant; a container that is
 * gone or duplicated; and a slot whose own rules will not take a component
 * instance. The nesting question is asked of the INSTANCE rather than of the
 * blocks it replaces — they are not the node going in, and a slot that accepted
 * a heading need not accept a component.
 */
export function planConvertToComponent<TFields>(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: LibraryTarget<TFields>,
  componentId: string,
  exposure: ComponentExposure,
  nesting: NestingSource,
  limits: DocumentLimits = DEFAULT_LIMITS,
  /**
   * The component definitions the page and the run place, to judge the
   * composed depth of the page the plan leaves. Absent, that depth is not
   * judged here and is left to the write's own validation.
   */
  components?: ComponentLookup
): PlanResult<TFields> {
  // Before anything is built on it, at runtime as well as in the type, for the
  // reason the save-over checks its target id: this is a published entry point
  // and the value reaching it comes from a JavaScript caller as often as from a
  // typed one. An empty id yields an instance that references nothing, and no
  // later stage looks at it again.
  if (typeof componentId !== "string" || componentId === "") {
    return { problem: "invalid-source" };
  }

  // Read ONCE, for the same reason the id above is checked at runtime: this is
  // a published entry point, and `limits` is an object the caller owns. Every
  // member can be a getter or a proxy trap, so two reads can answer
  // differently — and the stages below have to agree about the cap or the
  // agreement between them is the thing an author relies on. Measured on this
  // function before the snapshot: `maxNodes` was read five times, and a getter
  // answering honestly on four of them and `0` on the fifth approved a
  // conversion whose definition contained an instance of itself. Poisoning any
  // OTHER single read was refused, which is what makes this the fifth read's
  // agreement with the first rather than a general validation weakness.
  //
  // Named property reads rather than a spread. A spread copies OWN ENUMERABLE
  // properties, which is the wrong set at both ends: it MISSES a member reached
  // through the prototype or defined non-enumerably — measured, a
  // `Object.create(DEFAULT_LIMITS)` reads `maxNodes` as 5,000 and spreads to
  // `{}`, so every cap arrives `undefined` and a call that worked throws from
  // `renameScopes` — and it READS unrelated members the planner never uses, so
  // a caller whose limits object carries an enumerable getter for something
  // else has that getter run, and a throwing one takes this call down.
  //
  // The annotation is what keeps the list honest: `DocumentLimits` is a closed
  // set of required members, so a member added to it stops this literal
  // compiling rather than being quietly read live. An OPTIONAL member added
  // later would not, and would have to be added here by hand.
  const bounds: DocumentLimits = {
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
    maxBytes: limits.maxBytes,
  };

  const saved = plannedSave(document, selectedIds, nesting, bounds);
  if (saved.problem !== undefined) return saved;

  const definition = componentDocument(saved, exposure, bounds);
  if (definition.problem !== undefined) return definition;

  // A definition holding an instance of ITSELF. The selection can already
  // contain one — a dangling `def-1` on the page, converted while creating
  // `def-1` — and the resolver classifies that as a cycle and leaves it
  // unresolved, so a conversion whose dry run succeeded replaces visible
  // content with a broken placeholder. Asked through the resolver's own
  // published index, not a walk of this module's own.
  //
  // The caller's own node cap is passed, and passing it is the whole guard.
  // The index
  // walks depth-first under a node budget and STOPS silently, returning a
  // prefix that is indistinguishable from a definition referencing nothing —
  // and "references nothing" is the answer that approves the conversion. Left
  // to its default the walk ran under 5,000 however the host had configured
  // the caller, so on a site that raised the cap a self-reference sitting past
  // node 5,000 in walk order approved a conversion the resolver then leaves
  // unresolved. Measured: at a budget equal to the definition's own node count
  // the walk reads all of it, and one below that it answers `[]`.
  //
  // Threading the caller's cap is sufficient, rather than merely better. The
  // definition reaching this line is one `plannedSave` accepted under the SAME
  // `bounds`, and that ceiling is `maxNodes` nodes exactly — measured at the
  // boundary: a selection of `maxNodes` is accepted and walks whole, and
  // `maxNodes + 1` is refused as `"exceeds-limits"` before this line is
  // reached. So there is no definition here that this walk can truncate, which
  // is why the prefix is not tested for and no refusal for one exists.
  if (
    componentIdsIn(definition.document.nodes, bounds.maxNodes).includes(
      componentId
    )
  ) {
    return { problem: "self-reference" };
  }

  const replaced = replaceOps(document, saved, componentId, nesting, bounds);
  if (replaced.problem !== undefined) return replaced;

  // The composed depth, which nothing above measures: the run's own nodes are
  // within the cap where they stand, and become one more level of component
  // nesting once they are drawn through a placement. Judged only when the
  // caller supplies the definitions the page places, since a page composed
  // without them reads every placement as missing and so as no depth at all.
  if (components !== undefined) {
    const deeper = composedDepthRefusal({
      document,
      ops: replaced.ops,
      componentId,
      definition: definition.document,
      components,
      limits: bounds,
    });
    if (deeper !== undefined) return deeper;
  }

  return {
    create: {
      collection: target.collection,
      id: componentId,
      document: definition.document,
      fields: target.fields,
    },
    pageOps: replaced.ops,
    // Computed from the document as it stands, BEFORE the ops are applied: the
    // question is which links the conversion leaves behind, and the answer is
    // only available while the run is still on the page.
    warnings: orphanedAnchorWarnings(document, saved.selected),
  };
}

/**
 * Duplicate a component definition into a library row of its own.
 *
 * **The envelope is re-aimed, not merely carried.** A definition is not only a
 * tree: `exposed` and `slots` are POINTERS into it, and a duplicate re-identifies
 * every node. Copying the pointers across unchanged produces a document that
 * loads, renders, shows its properties in the inspector — and fails its own
 * publish gate with one error per exposure, because strict validation refuses a
 * pointer at a node the document does not contain. The design's one line for
 * this planner does not reach that; `reidForestWithMap` returns `nodeIds` for
 * exactly this purpose.
 *
 * **Exposed ids are KEPT.** Variant presets are keyed by them, so re-minting
 * would demand a second rewrite of every variant's keys and buy nothing: a fresh
 * duplicate has no instances, and an exposed id is scoped to its own document,
 * so two definitions sharing one is not a collision.
 *
 * **DOM ids are KEPT**, for the reason a saved pattern keeps them: the duplicate
 * is a document of its OWN rather than a copy placed beside the original, so
 * there is nothing to collide with. Composition mints per-instance ids when it
 * inlines a definition, so two definitions carrying one `cssId` never put two of
 * them on a page.
 *
 * **The SOURCE is asked one question first.** `documentRefusal` refuses a
 * document JSON cannot write, and it reads the whole document — the envelope
 * included. That is what makes every field below safe to read once: a stored row
 * whose `exposed` is an accessor, or whose entries are computed, is refused
 * before anything walks it. A caller-supplied REQUEST has no such rule and has
 * to be read into data first; a stored document does, and asking it is cheaper
 * and more honest than restating it.
 */
export function planDuplicateComponent<TFields>(
  definition: BlockDocument,
  target: LibraryTarget<TFields>,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<TFields> {
  // The CONTAINER, before its kind is read off it. This is a published entry
  // point handed a stored row, and a row can be `null` — where reading `.kind`
  // takes a native error out of a function that promises a refusal.
  if (!isPlainRecord(definition)) return { problem: "not-a-component" };
  // The envelope AND the forest, BEFORE the kind is read. `documentRefusal`
  // refuses a document whose fields compute themselves, and `kind` is one of
  // them — so asking the kind first ran a caller's accessor, taking a native
  // error out of a function that promises a refusal. The same input class this
  // planner already handled for a computed `exposed`, at the field read that
  // happens first.
  //
  // Paired as every other planner in this module pairs them: `documentRefusal`
  // reads the envelope and the `nodes` array, not the entries inside it, so a
  // `null` among the nodes or nested in a slot is otherwise copied without
  // complaint into a duplicate that plans successfully and then cannot be
  // published.
  if (
    documentRefusal(definition) !== undefined ||
    forestRefusal(definition.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }
  // A pattern duplicated through here would be stored as a component and
  // refused by the collection it landed in, having reported success.
  if (!isComponentDocument(definition)) return { problem: "not-a-component" };
  // The NODE contracts, which `forestRefusal` does not reach: it establishes
  // that the forest holds plain serializable records, not that each is a node
  // this engine would carry. A legacy `type: "box"` survives it, and the copy
  // then reports success for a definition strict validation refuses. The
  // pattern paths ask this of every root they lift; so does this.
  const shape = shapeRefusal(definition.nodes);
  if (shape !== undefined) return shape;

  const copied = reidForestWithMap([...definition.nodes], "keep");
  // The envelope, DEEP-COPIED, minus the nodes the copier already rebuilt.
  // Spreading the source left `variants`, `settings`, `assets` and every nested
  // `options` array shared with it, so editing the duplicate edited the
  // component it came from — measured, renaming the copy's variant renamed the
  // original's. A duplicate is a row of its own or it is not a duplicate.
  //
  // Safe to clone because `documentRefusal` has already refused anything JSON
  // cannot write, which is what `structuredClone` refuses too.
  const carried = structuredClone({
    ...definition,
    nodes: [],
  }) as ComponentDocument;
  const duplicate = {
    ...carried,
    kind: "component" as const,
    nodes: copied.nodes,
    ...aimedExposed(carried.exposed, copied.nodeIds),
    ...aimedSlotMap(carried.slots, copied.nodeIds),
  } satisfies ComponentDocument;

  // Measured ONCE, and read by both questions below. The bounds that decide
  // whether an envelope index describes the whole forest have to be settled
  // BEFORE one is built; the rest of what the survey knows is asked after, so a
  // caller-sized envelope still earns the verdict about the envelope.
  const survey = surveyDocument(duplicate, limits);
  if (overIndexBound(survey)) return { problem: "exceeds-limits" };

  const issues = componentEnvelopeIssues(duplicate, limits);
  if (issues.some(isErrorIssue)) {
    return { problem: "invalid-exposure", issues: issues.filter(isErrorIssue) };
  }

  // Two nodes rendering ONE id. The copy keeps DOM ids, so a source that
  // already spelled one twice hands the duplicate the same fault — and nothing
  // above sees it: the envelope check reads pointers, and the document refusal
  // reads storability and size. Strict validation, the gate this predicts,
  // refuses it as `duplicate-dom-id`, so the plan would succeed and the row
  // could never be published. The pattern paths already ask this.
  const duplicated = duplicateDomIdRefusal(duplicate.nodes);
  if (duplicated !== undefined) return duplicated;

  return (
    definitionRefusal(duplicate, survey) ?? {
      create: {
        collection: target.collection,
        document: duplicate,
        fields: target.fields,
      },
      pageOps: [],
      warnings: [],
    }
  );
}

/**
 * A definition's exposed list, re-aimed at the copy.
 *
 * Bounded and shape-guarded on the same terms a nomination is, because a stored
 * row is untrusted in the same ways — but read ONCE without a snapshot pass,
 * since `documentRefusal` has already refused a document whose fields compute
 * themselves. What is left is plain data that may still be the wrong shape, and
 * anything this cannot re-aim is carried for the envelope check to name.
 */
function aimedExposed(
  exposed: unknown,
  nodeIds: ReadonlyMap<string, string>
): { exposed?: ExposedProperty[] } {
  if (exposed === undefined) return {};
  if (!Array.isArray(exposed) || exposed.length > MAX_ENVELOPE_ENTRIES) {
    return { exposed: exposed as ExposedProperty[] };
  }
  const aimed: ExposedProperty[] = [];
  for (const one of exposed) aimed.push(aimedProperty(one, nodeIds));
  return { exposed: aimed };
}

/** A definition's slot map, re-aimed at the copy, on the same terms. */
function aimedSlotMap(
  slots: unknown,
  nodeIds: ReadonlyMap<string, string>
): { slots?: Record<string, ExposedSlot> } {
  if (slots === undefined) return {};
  if (!isPlainRecord(slots)) {
    return { slots: slots as Record<string, ExposedSlot> };
  }
  const names = boundedOwnKeys(slots, MAX_ENVELOPE_ENTRIES);
  if (names === null) return { slots: slots as Record<string, ExposedSlot> };
  const aimed: Record<string, ExposedSlot> = {};
  for (const id of names) defineEntry(aimed, id, aimedSlot(slots[id], nodeIds));
  return { slots: aimed };
}

/** The definition a component save would store, or why it could not. */
interface SavedComponent {
  readonly document: ComponentDocument;
  readonly problem?: undefined;
  readonly permitted?: undefined;
  readonly issues?: undefined;
}

/**
 * The saved tree, plus the envelope the author nominated, re-aimed and checked.
 *
 * ONE implementation, called by both component planners, for the reason
 * `savedPatternDocument` is: save and convert must produce the identical
 * definition from the identical selection, and two builders that agreed today
 * would diverge the day one of them moved.
 *
 * The envelope is checked on what is STORED rather than on what was nominated.
 * Only some of a nomination travels — the pointer is re-aimed and the rest is
 * carried verbatim — so judging the request would answer about a document
 * nobody stores. The same distinction `savedPatternDocument` draws, and
 * it has caught a defect on each side of it.
 */
function componentDocument(
  saved: PlannedSave,
  exposure: ComponentExposure,
  limits: DocumentLimits
): SavedComponent | PlanRefusal {
  // The CONTAINER, before either field is read off it. The guards below judge
  // the fields and their entries; none of them can be reached at all if the
  // request itself is not a record — `null` throws, and a string or an array
  // answers `undefined` to both reads and is silently taken for "expose
  // nothing", which reports success for a request nobody could honour.
  //
  // `undefined` is the exception and means exactly that: a caller with nothing
  // to expose. It is the one value that says so rather than failing to say
  // anything.
  if (exposure !== undefined && !isPlainRecord(exposure)) {
    return { problem: "invalid-exposure" };
  }
  const asked: ComponentExposure = exposure ?? {};

  // ONCE, before either pass. Both work from the result, so the id the guard
  // judges is the id the mapper stores.
  const read = readExposure(asked);

  // A collection nothing may read is refused HERE rather than handed on. The
  // envelope check is what names what is wrong with a value this cannot map —
  // but only for a value it can itself read, and an array with an accessor
  // index explodes wherever it is first touched.
  if (unreadable(read)) return { problem: "invalid-exposure" };

  const ambiguous = ambiguousNomination(saved.selected, read);
  if (ambiguous !== undefined) return ambiguous;

  const definition: ComponentDocument = {
    ...saved.stored,
    kind: "component",
    ...exposedProperties(read, saved.nodeIds),
    ...exposedSlots(read, saved.nodeIds),
  };

  // Measured ONCE, and read by both questions below. The bounds that truncate
  // an envelope index are settled before one is built; this path reaches that
  // case too — a run saved as a component under a host `maxNodes` smaller than
  // the run.
  const survey = surveyDocument(definition, limits);
  if (overIndexBound(survey)) return { problem: "exceeds-limits" };

  // The HOST's limits, not this module's default. The envelope check indexes
  // the forest under whatever node cap it is given, and a host that raised
  // `maxNodes` can hold a definition larger than the default — whose later
  // nodes then fall outside a default-sized index, so its exposures are
  // reported as pointing at nothing. Strict validation, the gate this predicts,
  // is given the host's limits; a dry run using its own would refuse a
  // component the apply would publish, which is the direction nobody can debug.
  const issues = componentEnvelopeIssues(definition, limits);
  if (issues.some(isErrorIssue)) {
    return { problem: "invalid-exposure", issues: issues.filter(isErrorIssue) };
  }

  // The stored-document rule, asked of the definition WITH its envelope on.
  // `savedPatternDocument` asks it of the tree, before there is an envelope —
  // and the envelope is caller-supplied, so a field this cannot judge can still
  // make the whole document unstorable: an option carrying a `BigInt` survives
  // the envelope check, which reads `value` and `label`, and JSON cannot write
  // it. The plan would report success and the create would fail on save.
  return definitionRefusal(definition, survey) ?? { document: definition };
}

/**
 * The exposure request, read ONCE into plain data.
 *
 * Every value this module will use is taken here and never asked for again.
 * That is the whole point: a request reaching a published entry point may hold
 * accessors, and until this pass runs nothing about it is data. Reading a field
 * where it is needed meant reading it several times — and a value that answers
 * differently on each read makes two passes disagree about the same nomination.
 *
 * Measured before this existed: `nodeId` was read three times, twice by the
 * ambiguity guard and once by the mapper. A getter answering `safe` twice and
 * then `dup` walked past the guard and stored the ambiguous pointer the guard
 * exists to refuse — the plan reporting success, the pointer resolving, and
 * every instance override editing a node the author never chose.
 *
 * It is also the one place a bound belongs. Each collection was bounded
 * wherever it happened to be traversed, which is three chances to add a fourth
 * traversal and forget.
 *
 * SHAPE-PRESERVING, not shape-correcting. A value this cannot read is carried
 * across exactly as given, because the envelope check is what says what is
 * wrong with it, in the vocabulary the publish gate already uses. Normalising
 * here would answer for a document nobody stores.
 */
interface ReadExposure {
  /** The nominated properties. */
  readonly properties: ReadCollection;
  /** The nominated slot regions. */
  readonly slots: ReadMap;
  /**
   * Every source node id the read entries name.
   *
   * Collected DURING the read rather than by a later pass over the result, and
   * that is what makes the bound hold: a collection carried verbatim because it
   * is over-cap or unreadable was never traversed, so it names nothing here and
   * a second pass cannot go looking. A separate walk would have to re-apply the
   * same bound, which is a second place to add a traversal and forget.
   */
  readonly named: readonly string[];
}

/**
 * A collection this module READ, one it is CARRYING, or one that is absent.
 *
 * Three states with three names rather than one value standing for all of them,
 * for the reason `PlacementTarget` gives about nullable parents: a
 * collection carried verbatim — past the cap, or the wrong shape — is still an
 * array as often as not, so anything reading it as "the entries" walks exactly
 * what the cap refused. Measured twice while writing this. Only `"read"` holds
 * entries, so only entries can be mapped, and the mistake stops being
 * representable rather than merely being fixed.
 */
type ReadCollection =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly entries: readonly unknown[] }
  | { readonly kind: "carried"; readonly value: unknown }
  /**
   * A collection nothing may read — not this module, and not the validator.
   *
   * Distinct from `"carried"`, which hands a value on for the envelope check to
   * refuse in its own words. That only works for a value the check can READ: an
   * array whose indices are accessors explodes wherever it is first touched, so
   * carrying it moves the explosion into validation instead of preventing it.
   * Measured exactly that way.
   */
  | { readonly kind: "unreadable" };

/**
 * The same three states for the slot MAP, whose keys are the exposure ids.
 *
 * Its own type rather than a list's, because the two are not interchangeable
 * and one type covering both is how the carried case came to be walked as
 * entries in the first place: a map read successfully is not a list of entries,
 * and a map carried verbatim must not be read at all.
 */
type ReadMap =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly slots: Record<string, unknown> }
  | { readonly kind: "carried"; readonly value: unknown }
  | { readonly kind: "unreadable" };

function readExposure(exposure: ComponentExposure): ReadExposure {
  const named: string[] = [];
  return {
    properties: readEntries(exposure.properties, one =>
      readProperty(one, named)
    ),
    slots: readSlotMap(exposure.slots, named),
    named,
  };
}

/**
 * A list of entries, bounded and read by index; anything else verbatim.
 *
 * By index because `map` and `Symbol.iterator` are inherited members a caller
 * may shadow, which throws where this module promises a refusal — on a list
 * whose entries are all well formed. Bounded because the envelope check refuses
 * an over-cap list in one step, so reading it first is precisely the work that
 * cap exists to refuse; the over-cap value is handed on for that refusal.
 */
function readEntries(
  value: unknown,
  read: (one: unknown) => unknown
): ReadCollection {
  if (value === undefined) return { kind: "absent" };
  if (!Array.isArray(value)) return { kind: "carried", value };
  // The list is DATA before a single index of it is read. An index can be an
  // accessor even on a genuine array whose entries are all well formed, so
  // neither the array check above nor the entry guards below see it — and
  // reading one runs the caller's code: a throwing getter escapes as a native
  // error, and one that appends extends `length` underneath the very bound that
  // is supposed to hold this loop. Carried for the validator to refuse, which
  // is what happens to every value this cannot read.
  if (listRefusal(value, "an exposure list") !== undefined) {
    return { kind: "unreadable" };
  }
  if (value.length > MAX_ENVELOPE_ENTRIES) return { kind: "carried", value };
  const entries: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    entries.push(read(value[index]));
  }
  return { kind: "read", entries };
}

/** A nested list as the envelope should hold it, read or carried. */
function nestedValue(collection: ReadCollection): unknown {
  if (collection.kind === "absent") return undefined;
  if (collection.kind === "read") return collection.entries;
  // An unreadable nested list becomes an empty one rather than travelling into
  // the envelope: it is a list nothing may touch, and the entry holding it is
  // refused by the caller of this read anyway.
  return collection.kind === "carried" ? collection.value : [];
}

/** The slot map, bounded to its own keys; anything else verbatim. */
function readSlotMap(value: unknown, named: string[]): ReadMap {
  if (value === undefined) return { kind: "absent" };
  if (!isPlainRecord(value)) return { kind: "carried", value };
  const names = boundedOwnKeys(value, MAX_ENVELOPE_ENTRIES);
  if (names === null) return { kind: "carried", value };
  const slots: Record<string, unknown> = {};
  // DEFINED rather than assigned: a stored record may carry an own `__proto__`,
  // and assigning to it runs the inherited setter instead of making a property.
  for (const name of names) {
    defineEntry(slots, name, readSlot(value[name], named));
  }
  return { kind: "read", slots };
}

/** One nominated property, each field taken exactly once. */
function readProperty(one: unknown, named: string[]): unknown {
  if (!isPlainRecord(one)) return one;
  const nodeId = one.nodeId;
  if (typeof nodeId === "string") named.push(nodeId);
  const options = one.options;
  return {
    id: one.id,
    label: one.label,
    nodeId,
    propPath: one.propPath,
    type: one.type,
    ...(options === undefined
      ? {}
      : { options: nestedValue(readEntries(options, readOption)) }),
  };
}

/** One `select` option, copied so the caller cannot edit the plan afterwards. */
function readOption(one: unknown): unknown {
  return isPlainRecord(one) ? { ...one } : one;
}

/** One nominated slot region, each field taken exactly once. */
function readSlot(one: unknown, named: string[]): unknown {
  if (!isPlainRecord(one)) return one;
  const nodeId = one.nodeId;
  if (typeof nodeId === "string") named.push(nodeId);
  const allow = one.allow;
  return {
    label: one.label,
    nodeId,
    slot: one.slot,
    ...(allow === undefined
      ? {}
      : { allow: nestedValue(readEntries(allow, entry => entry)) }),
  };
}

/**
 * A nomination naming a source id the selection holds TWICE.
 *
 * The save re-mints ids one per node, but the map it returns is keyed on the
 * ORIGINAL id — so two nodes sharing one lose the first mapping to the second,
 * and a pointer re-aimed through it lands on whichever copy came last. The
 * stored document is well formed and the envelope check passes, because the
 * pointer does resolve; it simply resolves to a node the author did not choose,
 * and every instance override then edits the wrong block.
 *
 * Refused rather than resolved, because the nomination is genuinely ambiguous:
 * two nodes answered to the name the author gave, and nothing here can know
 * which was meant. The same stance `"duplicate-destination"` takes elsewhere.
 *
 * Only the ids actually NOMINATED. A duplicate somewhere else in the selection
 * is a property of the page, which is saved under forgiving validation and may
 * legitimately hold one — refusing on it would reject a component whose every
 * exposure is unambiguous.
 *
 * Asked of the READ request, so the id it judges is the id that will be stored.
 */
function ambiguousNomination(
  selected: readonly BlockNode[],
  read: ReadExposure
): PlanRefusal | undefined {
  const roots = [...selected];
  for (const id of read.named) {
    if (countById(roots, id) > 1) return { problem: "ambiguous-exposure" };
  }
  return undefined;
}

/** Whether either collection is one nothing may read. */
function unreadable(read: ReadExposure): boolean {
  return (
    read.properties.kind === "unreadable" || read.slots.kind === "unreadable"
  );
}

/**
 * Why the completed definition could not be stored, or `undefined`.
 *
 * Two questions the envelope check does not answer, asked of the document WITH
 * its envelope on.
 *
 * Whether it can be stored at all — `savedPatternDocument` asks that of the
 * tree, before there is an envelope, and the envelope is caller-supplied, so a
 * field the envelope check does not read can still make the whole document
 * unwritable.
 *
 * And whether it FITS. An exposure only ever makes a document bigger, so a page
 * inside the caller's caps can become a definition that is not — and being
 * editable is a different question from being small enough. Measured through
 * the survey the publish gate uses, so the two cannot come to disagree about
 * the size of one document.
 */
function definitionRefusal(
  definition: ComponentDocument,
  survey: DocumentSurvey
): PlanRefusal | undefined {
  if (documentRefusal(definition) !== undefined) {
    return { problem: "unusable-document" };
  }
  if (survey.tooLarge || survey.tooDeep || survey.tooManyNodes) {
    return { problem: "exceeds-limits" };
  }
  return undefined;
}

/**
 * The nominated properties, re-aimed at the stored tree.
 *
 * Absent rather than an empty array when nothing was nominated, matching what
 * {@link ComponentDocument.exposed} says absence means. Writing `[]` would
 * store a field to say what its absence already says, and make two saves of one
 * selection differ by whether the caller passed a list it had not filled.
 */
function exposedProperties(
  read: ReadExposure,
  nodeIds: ReadonlyMap<string, string>
): { exposed?: ExposedProperty[] } {
  const properties = read.properties;
  if (properties.kind === "absent" || properties.kind === "unreadable") {
    return {};
  }
  if (properties.kind === "carried") {
    return { exposed: properties.value as ExposedProperty[] };
  }
  if (properties.entries.length === 0) return {};
  const exposed: ExposedProperty[] = [];
  for (const one of properties.entries) {
    exposed.push(aimedProperty(one, nodeIds));
  }
  return { exposed };
}

/** One read property, with its pointer moved onto the stored node. */
function aimedProperty(
  one: unknown,
  nodeIds: ReadonlyMap<string, string>
): ExposedProperty {
  if (!isPlainRecord(one)) return one as ExposedProperty;
  return { ...one, nodeId: storedId(one.nodeId, nodeIds) } as ExposedProperty;
}

/** The nominated slot regions, re-aimed, on the same terms as the properties. */
function exposedSlots(
  read: ReadExposure,
  nodeIds: ReadonlyMap<string, string>
): { slots?: Record<string, ExposedSlot> } {
  const requested = read.slots;
  if (requested.kind === "absent" || requested.kind === "unreadable") {
    return {};
  }
  if (requested.kind === "carried") {
    return { slots: requested.value as Record<string, ExposedSlot> };
  }
  const names = Object.keys(requested.slots);
  if (names.length === 0) return {};
  const slots: Record<string, ExposedSlot> = {};
  for (const id of names) {
    defineEntry(slots, id, aimedSlot(requested.slots[id], nodeIds));
  }
  return { slots };
}

/** One read slot, with its pointer moved onto the stored node. */
function aimedSlot(
  one: unknown,
  nodeIds: ReadonlyMap<string, string>
): ExposedSlot {
  if (!isPlainRecord(one)) return one as ExposedSlot;
  return { ...one, nodeId: storedId(one.nodeId, nodeIds) } as ExposedSlot;
}

/**
 * A source node id, as the stored document spells it.
 *
 * An id with no entry in the map is returned UNCHANGED rather than dropped or
 * replaced. It names a node outside the selection, and leaving it makes the
 * envelope check report it as the dangling pointer it is — one rule, asked
 * once, in the module that owns it. Dropping it would silently discard a
 * property the author nominated and tell them the save succeeded.
 *
 * It cannot collide with a real stored id by accident: the save mints fresh
 * ones, so a surviving source id is never one of them.
 */
function storedId(
  sourceId: unknown,
  nodeIds: ReadonlyMap<string, string>
): unknown {
  if (typeof sourceId !== "string") return sourceId;
  return nodeIds.get(sourceId) ?? sourceId;
}

/** The resolver's refusals that are judgements about depth. */
const DEPTH_REFUSALS: ReadonlySet<ComponentUnresolvedReason> = new Set([
  "composed-depth",
  "node-depth",
]);

/** The placeholders a composition leaves where depth stopped it. */
function depthBreaks(
  document: BlockDocument,
  components: ComponentLookup,
  limits: DocumentLimits
): ResolvedBlockNode[] {
  const found: ResolvedBlockNode[] = [];
  const nodes = resolveComponentInstances(document, components, { limits })
    .document.nodes as readonly ResolvedBlockNode[];
  walkNodes([...nodes], node => {
    const reason = (node as ResolvedBlockNode).unresolvedComponent;
    if (reason !== undefined && DEPTH_REFUSALS.has(reason)) {
      found.push(node);
    }
  });
  return found;
}

/**
 * Refuse a convert whose placement composes past a depth limit, or that
 * leaves the rest of the page composing worse than it did.
 *
 * A break is the new placement's when the placeholder is that placement or
 * was drawn through it (`instanceOf` names the host instance at every depth).
 * Any such break refuses, including one the run already held: wrapped in a
 * component it stops one level further out and hides more of the run. The
 * rest of the page is held to the count it had, so a page already holding a
 * placement too deep elsewhere can still be converted somewhere else.
 */
function composedDepthRefusal(args: {
  document: BlockDocument;
  ops: readonly BuilderOp[];
  componentId: string;
  definition: BlockDocument;
  components: ComponentLookup;
  limits: DocumentLimits;
}): PlanRefusal | undefined {
  const { componentId, definition, components, limits } = args;
  const converted = applyOps(args.document, args.ops, limits).document;
  const withCreated: ComponentLookup = {
    has: id => id === componentId || components.has(id),
    get: id => (id === componentId ? definition : components.get(id)),
  };
  const inserted = args.ops.find(op => op.kind === "insert");
  const placementId = inserted?.kind === "insert" ? inserted.node.id : "";
  const after = depthBreaks(converted, withCreated, limits);
  const throughPlacement = after.filter(
    node => node.id === placementId || node.instanceOf === placementId
  );
  if (throughPlacement.length > 0) return { problem: "composed-depth" };
  const before = depthBreaks(args.document, components, limits);
  return after.length > before.length
    ? { problem: "composed-depth" }
    : undefined;
}

/**
 * Take the run off the page and put one instance where it stood.
 *
 * Asked of the document as it stands BEFORE the removes, which is what the ops
 * will meet: the container has to exist and be unambiguous when the group is
 * applied, and the group is applied to this document.
 */
function replaceOps(
  document: BlockDocument,
  saved: PlannedSave,
  componentId: string,
  nesting: NestingSource,
  limits: DocumentLimits
): RestampOps | PlanRefusal {
  // Everything `applyOp` asks BEFORE it looks at an op — the envelope, then the
  // whole forest, because it walks every node before applying anything. A
  // malformed sibling the author never selected refuses the first remove of a
  // group whose library row has already been written, which is the rollback the
  // plan/apply split exists to avoid. Asked exactly as `restampOps` asks
  // it, since both planners emit ops against the same document.
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  const refusal =
    lockRefusal(document.nodes, saved.selected) ??
    removableRefusal(document, saved.selected);
  if (refusal !== undefined) return refusal;

  const position = replacementPosition(saved.at);
  if (position.problem !== undefined) return position;

  const instance: BlockNode = {
    id: newId(),
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  };

  // The insert path's own resolution, rather than a second reading of the same
  // position: it asks the op layer whether the position names anywhere, finds
  // the container once, and hands back the parent TYPE the nesting rule needs.
  const destination = destinationOf(document, position.at);
  if (destination.problem !== undefined) return destination;

  // Asked of the INSTANCE, not of the blocks it replaces. They are not the node
  // going in, and a slot that accepted a heading need not accept a component.
  const placement = placementRefusal(
    [instance],
    destination.place.where,
    nesting
  );
  if (placement !== undefined) return placement;

  const ops: BuilderOp[] = [
    ...saved.selected.map(
      (root): BuilderOp => ({ kind: "remove", id: root.id })
    ),
    { kind: "insert", node: instance, at: position.at },
  ];

  // The BYTE cap, asked of the apply, because the apply is the only place that
  // can answer it. `nodeShapeRefusal` says so in as many words: `assertFitsCaps`
  // measures the document a node is going INTO, so a subtree with no
  // destination cannot be judged against it. A run replaced by a larger
  // instance can cross a cap the page was inside, and the plan would be handed
  // over with its library row already written.
  //
  // Applied to a copy rather than re-derived: `applyOps` is pure, and a second
  // reading of the same rule is one more thing that can come to disagree with
  // the run it predicts.
  try {
    applyOps(document, ops, limits);
  } catch {
    return { problem: "exceeds-limits" };
  }

  return { ops };
}

/**
 * A selected root this document will not let a `remove` take.
 *
 * The op layer's own rule rather than a count of the root's id, and the two are
 * not the same question: `remove` refuses when ANY id inside the subtree it
 * takes occurs more than once in the document, because the inverse it records
 * could not put that subtree back. A root can be unique while a node three
 * levels down collides with something across the page — and the plan then
 * succeeds, the library row is written, and the first op throws.
 */
export function removableRefusal(
  document: BlockDocument,
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  for (const root of roots) {
    if (subtreeRemovalRefusal(document.nodes, root) !== undefined) {
      return { problem: "duplicate-destination" };
    }
  }
  return undefined;
}

/** Where the replacement goes, or why the run names nowhere to put it. */
interface ReplacementPosition {
  readonly at: OpPosition;
  readonly problem?: undefined;
  readonly permitted?: undefined;
  readonly issues?: undefined;
}

/**
 * The run's own place, as the position an op would put something back at.
 *
 * The narrowing {@link RunPlacement} deliberately does not do, in the one place
 * that has to commit to an answer. `contiguousRun` sets the two container
 * fields together or leaves both, so a parent named without its slot is a shape
 * it does not emit — but the fields are independently optional in its result,
 * and guessing which half to believe would either move a block to the top level
 * or address a slot nobody named. Refused as what it is instead, through the
 * cause `applyOp` would give the position it cannot be built into.
 */
export function replacementPosition(
  at: RunPlacement
): ReplacementPosition | PlanRefusal {
  if (at.parentId === undefined) return { at: { index: at.index } };
  if (at.slot === undefined) return { problem: "invalid-position" };
  return { at: { parentId: at.parentId, slot: at.slot, index: at.index } };
}
