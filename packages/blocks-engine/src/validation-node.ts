/**
 * The checks one node gets: the document's limits, its id, type and origin,
 * DOM ids, slots, classes, attributes, styles, visibility, and a component
 * instance's own fields.
 *
 * @module validation-node
 */
import { checkCssClassNames } from "./css-class-names";
import {
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  MAX_CLASSES_PER_NODE,
  readBlockOrigin,
  renderedDomId,
  STYLE_STATES,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import { documentTooLargeMessage, LIMIT_WARNING_RATIO } from "./limits";
import type { DocumentSurvey } from "./measure-bytes";
import { isPlainRecord } from "./plain-record";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./style/named-class";
import {
  canResolveName,
  chargeIssueBudget,
  type ReadyStyleIssueBudget,
  siteAllowanceSpent,
  siteTruncationNotice,
  structuralAllowanceSpent,
  validateStyleValues,
} from "./style/validate-style-value";
import { validateBindings } from "./validation-bindings";
import {
  ENGINE_NODE_TYPES,
  isNodeType,
  isNodeVersion,
  type IssueCode,
  type IssueSeverity,
  type ValidationContext,
  type ValidationIssue,
} from "./validation-contract";

/**
 * Whole-document verdicts, which a per-value walk can restate more precisely.
 *
 * Each of these describes the document as a WHOLE — its size, or what the
 * writer would do to it — rather than naming a place in it. A consumer that
 * walks the document itself can report the same fact against the actual key,
 * so it needs to know which issues are summaries it is entitled to replace.
 *
 * Exported because that consumer would otherwise keep its own list, and a list
 * in another package is a second statement of this one: `plugin-page-builder`
 * held exactly such a set, naming two of these, and adding a third verdict here
 * silently reclassified it there — the precise per-key report was dropped in
 * favour of the summary it was meant to replace.
 *
 * `invalid-document` is deliberately NOT here. It says the walk cannot run at
 * all, so nothing can restate it.
 *
 * Kept beside the code that emits them: a new document-level verdict is added
 * in this file, and belongs in this set in the same edit.
 */
/**
 * Verdicts meaning the engine did NOT measure the document in full.
 *
 * The bounded walk stopped early — at the byte cap, at a structural cap, or at
 * a member it refused to read — so `bytes`, `nodes` and `depth` are lower
 * bounds. A consumer that responds by making a second, UNBOUNDED pass over the
 * same document undoes the bound the engine exists to impose.
 *
 * Serializing is the pass that matters, and for an unreadable document it is
 * worse than expensive. The survey declines to invoke an accessor precisely so
 * that document-supplied code does not run inside a precondition;
 * `JSON.stringify` invokes it happily. A caller that reaches for the whole
 * document after this verdict executes exactly the code the refusal existed to
 * avoid, and materializes whatever it returns.
 *
 * Exported for the same reason as {@link DOCUMENT_VERDICT_CODES}: the consumer
 * would otherwise name these itself, and a name kept in step by hand is how a
 * new verdict silently joins the safe list.
 */
export const INCOMPLETE_SURVEY_CODES: ReadonlySet<IssueCode> = new Set([
  "document-too-large",
  "document-unreadable",
  "node-count-exceeded",
  "depth-exceeded",
]);

export const DOCUMENT_VERDICT_CODES: ReadonlySet<IssueCode> = new Set([
  "document-too-large",
  "document-unwritable",
  "document-unreadable",
  "document-lossy",
  "document-size-warning",
]);

export function checkLimits(
  survey: DocumentSurvey,
  issues: ValidationIssue[]
): void {
  // ONE traversal answers all three bounds, taken by the caller and handed
  // here.
  //
  // Depth, node count and serialized size were measured by two separate walks,
  // and the second of them had to decide what counts as a node and how deep it
  // sits in order to measure anything at all. So "what is a node" had two
  // implementations that agreed on the day they were written and nothing to
  // keep them agreeing — and a document sits between them only when they
  // disagree, which is exactly when nobody is looking. Every accepted document
  // also paid for the tree twice.
  if (survey.tooDeep) {
    issues.push({
      path: "/nodes",
      code: "depth-exceeded",
      severity: "error",
      message: `Node tree is nested deeper than the maximum of ${survey.limits.maxDepth}.`,
    });
  }
  if (survey.tooManyNodes) {
    issues.push({
      path: "/nodes",
      code: "node-count-exceeded",
      severity: "error",
      message: `Document exceeds the maximum of ${survey.limits.maxNodes} nodes.`,
    });
  }
  // A structurally over-cap document is already rejected, and the walk stopped
  // at that breach — so its byte count is a lower bound rather than a
  // measurement, and reporting a size from it would report a number that was
  // never finished.
  if (survey.tooDeep || survey.tooManyNodes) return;

  // The CAUSE, not just the refusal. A document over the limit is fixed by
  // removing content; one holding a value JSON cannot write is not made smaller
  // by deleting blocks, and reporting it as "too large" sends its author to
  // work that cannot help.
  //
  // Read off the SAME survey that answered depth and node count, not a second
  // measurement. Over-limit is reported ahead of unwritable for a document that
  // is both: the byte issue gates the precise walk downstream, so losing it to
  // the other cause is what lets an unbounded traversal run.
  const { bytes } = survey;
  if (survey.tooLarge) {
    issues.push({
      path: "",
      code: "document-too-large",
      severity: "error",
      message: documentTooLargeMessage(survey.limits.maxBytes),
    });
  } else if (survey.unwritable) {
    issues.push({
      path: "",
      code: "document-unwritable",
      severity: "error",
      message:
        "Document holds a value JSON cannot write, so it has no stored form.",
    });
  } else if (survey.unreadable) {
    // `unreadable`, not `!complete`. A survey is ALSO incomplete when its byte
    // count is approximate — a node hook returning a replacement — and such a
    // document was read perfectly well; JSON merely rewrites it. Reporting that
    // here told an author the validator refused to read a member it had read,
    // and sent them looking for a member that is not the problem.
    //
    // After `unwritable`, because a cycle is both and "no stored form" is the
    // more actionable of the two. Before `lossy`, because a walk that stopped
    // short cannot describe what it never reached.
    issues.push({
      path: "",
      code: "document-unreadable",
      severity: "error",
      message:
        "Document holds a member the validator will not read, so it cannot be measured.",
    });
  } else if (survey.lossy) {
    // A DIFFERENT statement, because the document has a stored form and it is
    // not this one. Reporting it as unwritable said the content could not be
    // saved at all, which sent an author looking for a value that JSON refuses
    // when the real answer is that a value they hold will come back changed.
    issues.push({
      path: "",
      code: "document-lossy",
      severity: "error",
      message:
        "Document holds a value JSON rewrites, so the stored form differs from it.",
    });
  } else if (bytes > survey.limits.maxBytes * LIMIT_WARNING_RATIO) {
    issues.push({
      path: "",
      code: "document-size-warning",
      severity: "warning",
      message: `Document is ${bytes} bytes, over ${Math.round(
        LIMIT_WARNING_RATIO * 100
      )}% of the ${survey.limits.maxBytes}-byte limit.`,
    });
  }
}

export interface NodeCheckState {
  ctx: ValidationContext;
  issues: ValidationIssue[];
  knownBreakpoints: Set<string>;
  unknownSeverity: IssueSeverity;
  seenIds: Map<string, string>;
  /** Non-empty DOM ids seen so far (from `cssId` or `attributes.id`) → pointer. */
  seenDomIds: Map<string, string>;
  /**
   * The block types each container type starts each of its slots with,
   * expanded once per type for the whole document: the answer depends on the
   * type alone, and a page may hold the same locked block many times.
   */
  /** Each block type's starting children, slot by slot, as an insert creates them. */
  startingChildren:
    | ((type: string, slot: string) => readonly BlockNode[])
    | undefined;

  /** Shared across the whole document, so the limit is not per node. */
  styleBudget: ReadyStyleIssueBudget;
  /**
   * Set when the document already failed the byte cap. Its style values are
   * still walked for shape, which is cheap, but not PARSED: parsing every
   * value builds an AST apiece, and a document this size is rejected whatever
   * those values turn out to be, so the byte cap would otherwise bound the
   * document without bounding the work spent reading it.
   */
  skipValueParsing: boolean;
}

/**
 * A node's id: present, non-empty, and unique across the whole document.
 *
 * Its own function because the node check is already at the complexity this
 * repo's gate allows, and because "which id is this, and has it been seen" is a
 * question with its own state — the seen-ids map — that nothing else there
 * touches. Early returns rather than nesting, which says the same thing with
 * one level less of it.
 */
function checkNodeId(
  node: Record<string, unknown>,
  path: string,
  state: NodeCheckState
): void {
  const { issues } = state;
  if (typeof node.id !== "string" || node.id.length === 0) {
    issues.push({
      path: pointer(path, "id"),
      code: "missing-node-id",
      severity: "error",
      message: "Every node needs a non-empty string id.",
    });
    return;
  }
  const firstSeenAt = state.seenIds.get(node.id);
  if (firstSeenAt !== undefined) {
    issues.push({
      path: pointer(path, "id"),
      code: "duplicate-node-id",
      severity: "error",
      message: `Node id "${describeValue(node.id)}" is already used at ${firstSeenAt}.`,
      suggestion: "Give every node a unique id.",
    });
    return;
  }
  state.seenIds.set(node.id, pointer(path, "id"));
}

/** A node's type: a namespaced slug, and — given a registry — registered. */
function checkNodeType(
  node: Record<string, unknown>,
  path: string,
  state: NodeCheckState
): void {
  const { issues } = state;
  if (!isNodeType(node.type)) {
    issues.push({
      path: pointer(path, "type"),
      code: "invalid-node-type",
      severity: "error",
      message: `Node type "${describeValue(node.type)}" must be a namespaced slug like "core/heading".`,
    });
    return;
  }
  if (
    state.ctx.registry &&
    // Engine-owned synthetic types are not registrable blocks and so are never
    // present in a block registry; exempt them from the registration check.
    !ENGINE_NODE_TYPES.has(node.type) &&
    !state.ctx.registry.has(node.type)
  ) {
    issues.push({
      path: pointer(path, "type"),
      code: "unknown-node-type",
      severity: state.unknownSeverity,
      message: `Node type "${describeValue(node.type)}" is not registered.`,
      suggestion: "Register the block or remove the node.",
    });
  }
}

/**
 * A node's provenance record, if it carries one.
 *
 * A document reaches storage by two roads — an op through `applyOp`, and a
 * field write through this validator — and only the op road asked this. So an
 * import or a script could persist `{ from: "pattern", id: "", digest: "" }`,
 * which every later provenance reader takes at face value: a staleness check
 * comparing against a pattern with no id answers confidently and wrongly, and a
 * save-over restoring the DOM ids an insert renamed reads a record it cannot
 * trust.
 *
 * Through {@link isBlockOrigin}, which is the op road's own predicate and lives
 * beside the type it describes. A record one road admits and the other refuses
 * is one that exists in the database and cannot be edited, so both ask the same
 * question rather than two that agree for now.
 *
 * ERROR in both modes. Forgiving mode exists to keep a document READABLE when a
 * future build wrote something this one does not understand; a half-written
 * record is not a future value but a claim about history with a piece missing,
 * and a reader cannot tell which piece.
 *
 * The asymmetry this closes is pre-existing and general rather than new: this
 * validator does not check `migrationFailed` either. `origin` joins that set
 * instead of creating it, and it is the one a planner now reads back.
 */
/**
 * Whether a node's stored `origin` is one to report as malformed.
 *
 * The four-way reading comes from {@link readBlockOrigin}, beside the type, so
 * this asks the guard's own question instead of naming its fields a second time
 * — the reason it can tell `computed` from `malformed` without a parallel list
 * to keep in step.
 *
 * `computed` is left alone. A field the guard consults being an accessor makes
 * the record untrusted, but it may be perfectly well formed, and the document
 * holding it is one `surveyDocument` refuses to measure and already reports
 * `document-unreadable`. A second verdict naming this one field would send an
 * author to repair something that may not be broken.
 *
 * `unreadable` is NOT left alone, and the difference is the whole point.
 * Reflection can fail where an accessor cannot be missed: the survey walks the
 * keys a record HAS, so a Proxy trap that throws only for an ABSENT field —
 * `renamed`, say — is never triggered by it, and the document is reported
 * perfectly readable. Deferring on that let `{ from: "pattern", id: "" }`
 * through with no issue raised at all. Nothing can establish such a record is
 * whole, so it is not treated as though something had.
 */
function reportsAMalformedOrigin(node: Record<string, unknown>): boolean {
  const descriptor = ownOriginDescriptor(node);
  if (descriptor === undefined || descriptor.get !== undefined) return false;
  const origin: unknown = descriptor.value;
  if (origin === undefined) return false;
  const reading = readBlockOrigin(origin);
  return reading === "malformed" || reading === "unreadable";
}

/**
 * The node's own `origin` descriptor, or `undefined` when reflection fails.
 *
 * Reading a descriptor off the NODE can throw too — the node itself may be a
 * Proxy — and that failure says nothing about the record, so there is nothing
 * to report about one. The document is refused as unreadable by the survey.
 */
function ownOriginDescriptor(
  node: Record<string, unknown>
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(node, "origin");
  } catch {
    return undefined;
  }
}

function checkNodeOrigin(
  node: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[]
): void {
  // Through the DESCRIPTOR, never an ordinary read. `surveyDocument` refuses to
  // invoke an accessor and already reports such a document `document-unreadable`
  // — so reading one here runs the document's own code inside the check deciding
  // whether to trust it, which is the rule `ops.ts` states about node fields.
  // Measured before this: a throwing getter escaped `validate()` as a native
  // error, and a benign one was invoked TWICE, once per read below.
  //
  // An accessor is left to the verdict that already covers it rather than given
  // a second one here: a document whose fields compute themselves is refused as
  // a whole, and reporting its `origin` as malformed would send an author to fix
  // a record that may be perfectly well formed.
  //
  // An INHERITED `origin` is absent for the same reason it is elsewhere in this
  // engine: `structuredClone` and object spreads copy own properties, so a value
  // reached through the prototype is not what would be stored.
  if (!reportsAMalformedOrigin(node)) return;
  issues.push({
    path: pointer(path, "origin"),
    code: "invalid-origin",
    severity: "error",
    message:
      "A node's origin must say where it came from, whole: a pattern needs an id and a digest, a component an id.",
    suggestion: "Remove the record, or write it complete.",
  });
}

export function validateNode(
  node: BlockNode,
  path: string,
  state: NodeCheckState,
  hidden: boolean
): void {
  const { issues } = state;
  if (!isPlainRecord(node)) {
    issues.push({
      path,
      code: "invalid-node",
      severity: "error",
      message: "A node must be an object.",
    });
    return;
  }

  checkNodeId(node, path, state);
  checkNodeType(node, path, state);
  checkNodeOrigin(node, path, issues);

  // version: positive integer.
  if (!isNodeVersion(node.version)) {
    issues.push({
      path: pointer(path, "version"),
      code: "invalid-node-version",
      severity: "error",
      message: "A node version must be a positive integer.",
    });
  }

  if (!isPlainRecord(node.props)) {
    issues.push({
      path: pointer(path, "props"),
      code: "invalid-props",
      severity: "error",
      message: "A node props field must be an object.",
    });
  }

  validateSlots(node, path, state);
  validateClasses(
    node,
    path,
    issues,
    state.ctx,
    state.styleBudget,
    state.skipValueParsing
  );
  validateAttributes(node, path, issues);
  validateNosnippet(node, path, issues);
  validateCssClasses(node, path, issues, state.skipValueParsing);
  validateStyles(node, path, state);
  validateVisibility(node, path, state);
  validateBindings(node, path, issues);
  validateComponentInstance(node, path, issues);
  validateDomIds(node, path, state, hidden);
}

/**
 * A rendered node's DOM id — from `cssId` or the `attributes.id` escape hatch —
 * must be unique across the document, or the page emits duplicate HTML `id`
 * attributes (breaking anchors, labels, and CSS selectors). Preservable, so the
 * severity follows the mode.
 */
function validateDomIds(
  node: BlockNode,
  path: string,
  state: NodeCheckState,
  hidden: boolean
): void {
  const report = (domId: string, at: string): void => {
    const firstAt = state.seenDomIds.get(domId);
    if (firstAt !== undefined) {
      state.issues.push({
        path: at,
        code: "duplicate-dom-id",
        severity: state.unknownSeverity,
        message: `HTML id "${describeValue(domId)}" is already used at ${firstAt}.`,
        suggestion: "Give each element a unique id.",
      });
    } else {
      state.seenDomIds.set(domId, at);
    }
  };
  if (node.cssId !== undefined && typeof node.cssId !== "string") {
    state.issues.push({
      path: pointer(path, "cssId"),
      code: "invalid-css-id",
      severity: "error",
      message: "A node cssId must be a string.",
    });
  }
  // ONE id per node, through the rule the renderer follows and the composition
  // planners ask. A node can spell an id twice and emits one, so counting both
  // reported a collision the page cannot have: a node carrying `cssId:
  // "actual"` beside `attributes.id: "hero"` renders only `actual`, and
  // registering `hero` made an unrelated node's real `hero` a duplicate.
  //
  // Skipping only the spellings that are EQUAL, as this did, catches the
  // narrowest case of that and leaves the rest — and it left a save that these
  // planners permit producing a pattern this gate then refuses.
  //
  // A bag `validateAttributes` has already refused is one this walk must not
  // ENUMERATE. `Object.entries` runs an accessor, so a throwing getter would
  // escape `validate()` as a native error instead of an issue, and a
  // side-effecting one would execute the document's own code inside the check
  // deciding whether to trust it.
  //
  // The fallback is not a second copy of which spelling wins: with the bag
  // unreadable, `cssId` is the only place an id can come from, and a string
  // `cssId` shadows the bag anyway. The node is already reported as
  // `invalid-attributes`, so nothing about it is being passed as sound.
  // A node the renderer prunes emits no id, so it can collide with nothing.
  // This is the case gating exists for: personalised variants of one section,
  // each carrying the same anchor, with exactly one ever served — and reporting
  // them as duplicates blocked publishing a page the planners now let an author
  // save. The gate and the planners have to agree, or a save produces a pattern
  // that cannot be published.
  //
  // What this cannot decide is the day an evaluator arrives and two gated nodes
  // both match. That belongs to the evaluator, which alone can read the
  // conditions; nothing here has them.
  if (hidden) return;

  const readable =
    node.attributes === undefined || isPlainRecord(node.attributes);
  const rendered = readable
    ? renderedDomId(node)
    : typeof node.cssId === "string" && node.cssId !== ""
      ? node.cssId
      : undefined;
  if (rendered !== undefined)
    report(rendered, domIdPointer(node, path, rendered));
}

/**
 * Where the id a node renders is written, for the issue to point at.
 *
 * Derived from the VALUE {@link renderedDomId} chose rather than by asking
 * which field wins a second time: a second reading of that rule is one that can
 * disagree with the first, and then an issue names a field that is not the one
 * carrying the id.
 */
function domIdPointer(node: BlockNode, path: string, rendered: string): string {
  if (node.cssId === rendered) return pointer(path, "cssId");
  if (isPlainRecord(node.attributes)) {
    let key: string | undefined;
    for (const [name, value] of Object.entries(node.attributes)) {
      if (name.toLowerCase() === "id" && value === rendered) key = name;
    }
    if (key !== undefined) return pointer(pointer(path, "attributes"), key);
  }
  return pointer(path, "cssId");
}

function validateSlots(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.slots === undefined) return;
  if (!isPlainRecord(node.slots)) {
    state.issues.push({
      path: pointer(path, "slots"),
      code: "invalid-slots",
      severity: "error",
      message: "A node slots field must be an object of node arrays.",
    });
    return;
  }
  for (const [slot, children] of Object.entries(node.slots)) {
    if (!Array.isArray(children)) {
      state.issues.push({
        path: pointer(pointer(path, "slots"), slot),
        code: "invalid-slots",
        severity: "error",
        message: `Slot "${describeValue(slot)}" must be an array of nodes.`,
      });
    }
    // Child nodes themselves are validated by the recursive walk in validate().
  }
}

// RELOCATED, not written here — see the docblock of `validation.ts`.
// fallow-ignore-next-line complexity
function validateClasses(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[],
  ctx: ValidationContext,
  budget?: ReadyStyleIssueBudget,
  overLimits = false
): void {
  // Before the field is READ, not after. Every check below walks a list whose
  // length the document controls, and each re-reads `node.classes`, so the
  // field is reached about twice per member — the unbounded work the caps exist
  // to prevent, on a document whose measurement never bounded anything.
  //
  // Safe to skip only because this flag is now the NARROW question. A document
  // JSON merely rewrites was measured in full, so it does not reach here and
  // still has its classes validated; a sparse array is exactly that case, and
  // gating on the wider "not serializable" dropped its `invalid-classes` report
  // entirely.
  if (overLimits) return;
  if (node.classes === undefined) return;
  // Index-based, not `.every` (which skips array holes), so a sparse classes
  // array — which serializes to `[null, …]` — is rejected, not accepted.
  let valid = Array.isArray(node.classes);
  if (valid) {
    for (let i = 0; i < node.classes.length; i++) {
      if (typeof node.classes[i] !== "string") {
        valid = false;
        break;
      }
    }
  }
  if (!valid) {
    issues.push({
      path: pointer(path, "classes"),
      code: "invalid-classes",
      severity: "error",
      message: "A node classes field must be an array of class-id strings.",
    });
    return;
  }
  // The compiler applies a bounded prefix of this list, so a longer one is a document that
  // validates and then renders differently from what it says. Reported here, where a save or a
  // publish can still refuse it, rather than being discovered as styling that silently did
  // nothing — the account this engine exists to give.
  //
  // An error only where a gate is being applied. A stored document already holding a longer list
  // has to stay readable, and downgrading it to a warning there says the same thing without
  // making the document unopenable.
  if (node.classes.length > MAX_CLASSES_PER_NODE) {
    issues.push({
      path: pointer(path, "classes"),
      code: "too-many-classes",
      severity: ctx.mode === "strict" ? "error" : "warning",
      message: `This node lists ${node.classes.length} classes; only the first ${MAX_CLASSES_PER_NODE} are applied.`,
    });
  }
  // A reference longer than a class id may be names nothing the library can hold, whatever a
  // caller's lookup answers: `isUsableNamedClass` refuses an entry carrying one, so the compiler
  // drops the reference. Reported here for the same reason the count above is — a document that
  // passes a strict publish and then renders without its class styling is the one outcome these
  // two halves must not produce between them.
  for (let index = 0; index < node.classes.length; index += 1) {
    const id = node.classes[index];
    if (id.length <= MAX_NAMED_CLASS_NAME_LENGTH) continue;
    issues.push({
      path: pointer(pointer(path, "classes"), index),
      code: "invalid-classes",
      severity: ctx.mode === "strict" ? "error" : "warning",
      message: `This class id is ${id.length} characters; a class id may be at most ${MAX_NAMED_CLASS_NAME_LENGTH}, so it was not applied.`,
    });
  }
  const lookup = ctx.classes;
  if (lookup === undefined) return;
  // A document a limit already refused is not read further, and the shape above
  // is all that is worth reading of it. Resolving names means handing every
  // class string to a lookup that hashes it, and a known id spends no allowance
  // to stop that, so a rejected document made of very many known ids would be
  // read in full right after a limit said not to read it.
  if (overLimits) return;
  // A WARNING in both modes, never an error. A class the site no longer defines
  // costs the element that class's styling and nothing else, and a document is
  // data while a class library is site configuration: deleting a class must not
  // make every document that used it unpublishable.
  for (let index = 0; index < node.classes.length; index += 1) {
    // A node may list as many class ids as a document has room for, and each
    // unknown one costs a lookup and an allocated issue. Bounded by the run's
    // SITE allowance, and by both of its dimensions: the count keeps one node
    // from turning a small document into a long report, and the path bytes keep
    // a node nested under a very long slot key from repeating that key in every
    // warning, which bounds how many are returned without bounding how large.
    //
    // The site allowance, not the structural one, because these are warnings
    // that never block a publish. Spending the structural allowance on them
    // would stop the checks that do decide validity, and the marker for
    // stopping those is an error.
    const id = node.classes[index];
    if (typeof id !== "string") continue;
    // Whether this id can be answered at all: from the cache for nothing, or by
    // asking the caller while there are lookups left to spend and an answer
    // could still be reported.
    if (!canResolveName(lookup, id, budget)) {
      issues.push(...siteTruncationNotice(budget, pointer(path, "classes")));
      continue;
    }
    // A KNOWN id is not a finding, so it truncates nothing. Resolving it first
    // and asking about the allowance second is what keeps the marker honest:
    // announced before the answer is known, it would claim names went unchecked
    // on a document whose every name checked out.
    if (lookup.has(id)) continue;
    const issuePath = pointer(pointer(path, "classes"), index);
    if (siteAllowanceSpent(budget)) {
      issues.push(...siteTruncationNotice(budget, issuePath));
      continue;
    }
    const issue: ValidationIssue = {
      path: issuePath,
      code: "unknown-class",
      severity: "warning",
      message: `The class "${describeValue(id)}" is not defined by this site.`,
      suggestion: "Create the class, or remove it from this node.",
    };
    chargeIssueBudget(budget, [issue]);
    issues.push(issue);
  }
}

/** The "never quote this" mark is on or off, never another value. */
function validateNosnippet(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.nosnippet === undefined || typeof node.nosnippet === "boolean") {
    return;
  }
  issues.push({
    path: pointer(path, "nosnippet"),
    code: "invalid-nosnippet",
    severity: "error",
    message: "A node nosnippet mark must be true or false.",
  });
}

/** How many refused class names one issue names before counting the rest. */
const MAX_NAMED_CSS_CLASSES = 5;

/**
 * The author's own class names: text, every name one a block may carry.
 *
 * An ERROR in both modes, unlike an unknown shared class. A save is judged
 * forgivingly, and it is the one place every writer passes: the editor, the
 * API, an import and an agent. A name it let through would be drawn on the
 * published page, so it is refused there, naming each name and why.
 *
 * One issue for the field rather than one per name, naming the first few and
 * counting the rest, so a long list of bad names makes a short report.
 */
function validateCssClasses(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[],
  overLimits = false
): void {
  // Skipped for a document a limit already refused, as the shared classes are:
  // the text is the document's to size, and nothing here would change the
  // verdict.
  if (overLimits) return;
  const text: unknown = node.cssClasses;
  if (text === undefined) return;
  if (typeof text !== "string") {
    issues.push({
      path: pointer(path, "cssClasses"),
      code: "invalid-css-classes",
      severity: "error",
      message:
        "A node's CSS classes must be text: class names separated by spaces.",
    });
    return;
  }
  const { refused } = checkCssClassNames(text);
  if (refused.length === 0) return;
  const named = refused.slice(0, MAX_NAMED_CSS_CLASSES).map(r => r.reason);
  const more = refused.length - named.length;
  issues.push({
    path: pointer(path, "cssClasses"),
    code: "invalid-css-classes",
    severity: "error",
    message:
      more > 0
        ? `${named.join(" ")} And ${more} more names that can't be used.`
        : named.join(" "),
    suggestion: "Rename or remove these class names, then save again.",
  });
}

function validateAttributes(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.attributes === undefined) return;
  if (
    !isPlainRecord(node.attributes) ||
    !Object.values(node.attributes).every(v => typeof v === "string")
  ) {
    issues.push({
      path: pointer(path, "attributes"),
      code: "invalid-attributes",
      severity: "error",
      message: "A node attributes field must be a string-to-string map.",
    });
    return;
  }
  // Event-handler attributes are inline JS, which blocks never allow; reject
  // them at the gate. The broader render-safe attribute allowlist is owned by
  // the renderer; validation does not duplicate it here to avoid two lists
  // drifting apart.
  for (const key of Object.keys(node.attributes)) {
    if (/^on/i.test(key)) {
      issues.push({
        path: pointer(pointer(path, "attributes"), key),
        code: "invalid-attributes",
        severity: "error",
        message: `Attribute "${describeValue(key)}" is an event handler; inline JavaScript is not allowed.`,
      });
    }
  }
}

function validateStyles(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.styles === undefined) return;
  validateStyleEnvelope(node.styles, pointer(path, "styles"), state);
}

/**
 * Validate a `NodeStyles` envelope (states × breakpoints × values) at any path.
 * Shared by node styles and document-level `settings.styles`, which use the
 * same shape.
 */
/**
 * The truncation marker for the envelope walk, emitted once per run. It shares
 * the budget's flag with the property walk, so a document that stops early says
 * so exactly once, wherever it stopped.
 */
/**
 * Whether an object carries any key of its own.
 *
 * `Object.keys` would build an array of every key merely to ask, which is the
 * unbounded work the issue budget exists to prevent — and this is asked at the
 * moment the budget has just run out.
 */
function hasOwnKey(value: Record<string, unknown>): boolean {
  for (const key in value) {
    if (Object.hasOwn(value, key)) return true;
  }
  return false;
}

function styleBudgetExhausted(
  state: NodeCheckState,
  path: string
): ValidationIssue[] {
  if (state.styleBudget.truncated) return [];
  state.styleBudget.truncated = true;
  return [
    {
      path,
      code: "style-issues-truncated",
      severity: "error",
      message:
        "There are more style problems than are reported here, so the rest of this document was not checked.",
    },
  ];
}

/**
 * Record one style-envelope issue and charge the run for it.
 *
 * Both dimensions of the allowance, never the count alone: these paths carry
 * the node's own pointer, so a node nested under a very long slot key repeats
 * that key in every issue reported beneath it, and a count-only charge bounds
 * how many are returned without bounding how large they are.
 */
function pushStyleIssue(state: NodeCheckState, issue: ValidationIssue): void {
  state.issues.push(issue);
  chargeIssueBudget(state.styleBudget, [issue]);
}

// RELOCATED, not written here — see the docblock of `validation.ts`.
// fallow-ignore-next-line complexity
export function validateStyleEnvelope(
  styles: unknown,
  stylesPath: string,
  state: NodeCheckState
): void {
  if (!isPlainRecord(styles)) {
    // Charged like every other style issue, and checked first: one per node
    // sounds bounded until a document carries thousands of nodes, and the cap
    // is document-wide rather than per node.
    if (structuralAllowanceSpent(state.styleBudget)) {
      state.issues.push(...styleBudgetExhausted(state, stylesPath));
      return;
    }
    pushStyleIssue(state, {
      path: stylesPath,
      code: "invalid-style-values",
      severity: "error",
      message: "A styles field must be an object.",
    });
    return;
  }
  // Enumerated lazily: `Object.entries` would build a pair for every state name
  // before the budget below sees the first one, which is the allocation the
  // budget exists to bound.
  for (const stateKey in styles) {
    if (!Object.hasOwn(styles, stateKey)) continue;
    const byBreakpoint = styles[stateKey];
    // The envelope's own keys are as unbounded as the values inside it: a
    // document can carry a hundred thousand unknown state names. The budget
    // therefore governs the whole style walk, not only the property level.
    //
    // Bailing here is right only for a state that produces an issue of its
    // own. A known state holding a map may hold nothing at all, and the marker
    // is an error, so deciding its fate before looking inside would reject a
    // document that was read in full. The breakpoint loop judges each entry.
    const stateIsKnown = STYLE_STATES.includes(
      stateKey as (typeof STYLE_STATES)[number]
    );
    const stateHasOwnIssue = !stateIsKnown || !isPlainRecord(byBreakpoint);
    if (structuralAllowanceSpent(state.styleBudget) && stateHasOwnIssue) {
      state.issues.push(...styleBudgetExhausted(state, stylesPath));
      return;
    }
    const statePath = pointer(stylesPath, stateKey);
    if (!stateIsKnown) {
      pushStyleIssue(state, {
        path: statePath,
        code: "invalid-style-state",
        severity: "error",
        message: `"${describeValue(stateKey)}" is not a known style state.`,
        suggestion: `Use one of: ${STYLE_STATES.join(", ")}.`,
      });
      continue;
    }
    if (!isPlainRecord(byBreakpoint)) {
      pushStyleIssue(state, {
        path: statePath,
        code: "invalid-style-values",
        severity: "error",
        message: `Style state "${describeValue(stateKey)}" must map breakpoint ids to values.`,
      });
      continue;
    }
    for (const breakpointId in byBreakpoint) {
      if (!Object.hasOwn(byBreakpoint, breakpointId)) continue;
      const values = byBreakpoint[breakpointId];
      // Two different questions, so two different tests. Stopping the WHOLE
      // walk here is only free if this entry would say nothing at all, and an
      // unknown breakpoint still reports that it is unknown — exempting it
      // would let the walk run past the cap while emitting. Skipping just this
      // entry's VALUES, at the recheck below, is free whenever there are none,
      // whatever the breakpoint id turned out to be.
      const noValuesHere = isPlainRecord(values) && !hasOwnKey(values);
      const nothingLeftHere =
        noValuesHere && state.knownBreakpoints.has(breakpointId);
      if (structuralAllowanceSpent(state.styleBudget) && !nothingLeftHere) {
        state.issues.push(...styleBudgetExhausted(state, statePath));
        return;
      }
      const bpPath = pointer(statePath, breakpointId);
      if (!state.knownBreakpoints.has(breakpointId)) {
        pushStyleIssue(state, {
          path: bpPath,
          code: "unknown-breakpoint",
          severity: state.unknownSeverity,
          message: `Breakpoint "${describeValue(breakpointId)}" is not defined for this site.`,
        });
      }
      // Rechecked between the two: an unknown breakpoint and a malformed value
      // are independently chargeable, so the first can spend the last slot and
      // the second would otherwise push past the cap without saying it stopped.
      // Nothing is skipped when this breakpoint holds no values, though, and
      // the marker is an error — claiming a document went unchecked when it did
      // not would reject it for having been fully read.
      if (structuralAllowanceSpent(state.styleBudget) && !noValuesHere) {
        state.issues.push(...styleBudgetExhausted(state, bpPath));
        return;
      }
      if (!isPlainRecord(values)) {
        pushStyleIssue(state, {
          path: bpPath,
          code: "invalid-style-values",
          severity: "error",
          message: `Style values at "${describeValue(breakpointId)}" must be an object.`,
        });
        continue;
      }
      // The envelope's shape is only half of what makes a style block valid:
      // the properties inside it have to be ones the catalog defines, holding
      // values of the shape it declares. Checking them here is what puts unsafe
      // values in front of the same gate every other document defect passes.
      // The property walk charges the budget for every issue it returns, so
      // there is nothing to subtract here; doing so would bill each one twice.
      state.issues.push(
        ...validateStyleValues(
          values,
          bpPath,
          state.ctx.mode,
          state.styleBudget,
          state.skipValueParsing,
          state.ctx.tokens
        )
      );
    }
  }
}

// RELOCATED, not written here — see the docblock of `validation.ts`.
// fallow-ignore-next-line complexity
function validateVisibility(
  node: BlockNode,
  path: string,
  state: NodeCheckState
): void {
  if (node.visibility === undefined) return;
  const vis = node.visibility;
  const visPath = pointer(path, "visibility");
  if (!isPlainRecord(vis)) {
    state.issues.push({
      path: visPath,
      code: "invalid-visibility",
      severity: "error",
      message: "A node visibility field must be an object.",
    });
    return;
  }
  // Placement gates exist only while a page is drawn; a document saved with
  // one would ask the renderer for a gate no author set.
  if (Object.hasOwn(vis, "within")) {
    state.issues.push({
      path: pointer(visPath, "within"),
      code: "invalid-visibility",
      severity: "error",
      message:
        "visibility.within is set only while a page is drawn and can't be stored.",
    });
  }
  if (vis.conditions !== undefined) {
    // Each condition needs a string `field` AND a string `op`; the optional
    // `value` may be anything. Index-based loops (not `.every`, which skips
    // holes) so a sparse array's undefined entries are rejected, not passed.
    const ok = isConditionsShapeValid(vis.conditions);
    if (!ok) {
      state.issues.push({
        path: pointer(visPath, "conditions"),
        code: "invalid-visibility",
        severity: "error",
        message:
          "visibility.conditions must be an OR-array of AND-arrays of {field, op, value?}.",
      });
    }
  }
  if (vis.devices !== undefined) {
    if (!isPlainRecord(vis.devices)) {
      state.issues.push({
        path: pointer(visPath, "devices"),
        code: "invalid-visibility",
        severity: "error",
        message: "visibility.devices must map breakpoint ids to booleans.",
      });
    } else {
      for (const [breakpointId, value] of Object.entries(vis.devices)) {
        const devicePath = pointer(pointer(visPath, "devices"), breakpointId);
        if (!state.knownBreakpoints.has(breakpointId)) {
          state.issues.push({
            path: devicePath,
            code: "unknown-breakpoint",
            severity: state.unknownSeverity,
            message: `Breakpoint "${describeValue(breakpointId)}" is not defined for this site.`,
          });
        }
        // The stored shape is Record<breakpointId, boolean>; a truthy string or
        // number would render differently from the author's intent.
        if (typeof value !== "boolean") {
          state.issues.push({
            path: devicePath,
            code: "invalid-visibility",
            severity: "error",
            message: `visibility.devices["${describeValue(breakpointId)}"] must be a boolean.`,
          });
        }
      }
    }
  }
}

/**
 * True if `conditions` is a well-formed OR-of-AND array of `{field, op}`.
 * Iterates by index rather than with `.every`, which skips array holes, so a
 * sparse array's `undefined` entries are treated as invalid, not passed over.
 */
function isConditionsShapeValid(conditions: unknown): boolean {
  if (!Array.isArray(conditions)) return false;
  for (let g = 0; g < conditions.length; g++) {
    const group: unknown = conditions[g];
    if (!Array.isArray(group)) return false;
    for (let c = 0; c < group.length; c++) {
      const cond: unknown = group[c];
      if (
        !isPlainRecord(cond) ||
        typeof cond.field !== "string" ||
        typeof cond.op !== "string"
      ) {
        return false;
      }
    }
  }
  return true;
}

function validateComponentInstance(
  node: BlockNode,
  path: string,
  issues: ValidationIssue[]
): void {
  if (node.type !== COMPONENT_INSTANCE_TYPE) return;
  // Only check componentId once props is an object: if props is missing or
  // malformed, `invalid-props` already covers it and a `/props/componentId`
  // pointer would target a location a fixer cannot edit.
  if (!isPlainRecord(node.props)) return;
  const componentId = node.props.componentId;
  if (typeof componentId !== "string" || componentId.length === 0) {
    issues.push({
      path: pointer(pointer(path, "props"), "componentId"),
      code: "invalid-component-instance",
      severity: "error",
      message:
        "A component-instance node must set props.componentId to the component's id.",
    });
  }

  // `overrides` is a MAP keyed by exposed id, and only the shape is checkable
  // here: which ids exist is a property of a definition this document does not
  // carry. The shape still has to be refused, because a resolver enumerating
  // it either throws on a string and an array, or reads their indices as
  // exposure ids and applies values to properties nobody named.
  //
  // Only when present. Absent means the instance overrides nothing, which is
  // the ordinary state of a freshly placed component.
  const overrides = node.props.overrides;
  if (overrides !== undefined && !isPlainRecord(overrides)) {
    issues.push({
      path: pointer(pointer(path, "props"), "overrides"),
      code: "invalid-component-instance",
      severity: "error",
      message: `A component instance's props.overrides must be an object keyed by exposed id, not ${describeValue(overrides)}.`,
    });
  }
}
