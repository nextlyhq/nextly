/**
 * Document validation. Produces machine-readable issues so both humans and
 * agents can locate and fix problems: every issue carries a JSON-Pointer into
 * the document, a stable code from `ISSUE_CODES`, a message, and an
 * optional suggestion. The issue shape is the stable contract external tools
 * consume to locate and repair problems.
 *
 * Runtime-free like the rest of the engine: it reads the document and a caller-
 * supplied context (breakpoints, mode, and an optional block-type lookup); it
 * never touches storage or a framework.
 *
 * ## The complexity suppressions in this module's parts
 *
 * Three functions in `validation-node` carry `fallow-ignore-next-line
 * complexity`: `validateClasses`, `validateStyleEnvelope` and
 * `validateVisibility`. They moved there unchanged, apart from an `export`,
 * when this module was split into parts, and their scores were inherited, so
 * ungated, while they sat here. The audit calls them new only because their
 * file is new, and the health baseline is generated from `main`, never from a
 * branch. Suppressed inline, one by one, as `ops.ts` does for its relocated
 * functions: a new complex function added to any part still gets caught.
 */
import { bindingSchemaIssues } from "./binding-schema-issues";
import type { BlockDocument } from "./document";
import { entryContentIssues } from "./entry-content";
import { DEFAULT_LIMITS } from "./limits";
import { type ListFieldSource, listQueryIssues } from "./list-query";
import { surveyDocument } from "./measure-bytes";
import { definitelyNotARecord, isPlainRecord } from "./plain-record";
import { validateComponentEnvelope } from "./validation-components";
import type {
  IssueSeverity,
  ValidationContext,
  ValidationIssue,
  ValidationResult,
} from "./validation-contract";
import {
  collectBreakpointIds,
  documentEnvelope,
  invalidDocumentIssue,
  nodeCheckState,
  validateNodeForest,
} from "./validation-forest";
import { checkLimits, validateStyleEnvelope } from "./validation-node";
import { validateDocumentSeo } from "./validation-seo";
import { variantLabelIssues } from "./variant-labels";
import { conditionIssues } from "./visibility-conditions";

export {
  ISSUE_CODES,
  isErrorIssue,
  isNodeType,
  isNodeVersion,
} from "./validation-contract";
export type {
  BlockTypeLookup,
  ClassLookup,
  IssueCode,
  IssueSeverity,
  TokenLookup,
  ValidationContext,
  ValidationIssue,
  ValidationMode,
  ValidationResult,
} from "./validation-contract";
export { storedBreakSignatures, walkNodeForest } from "./validation-forest";
export type { QueuedNode } from "./validation-forest";
export {
  DOCUMENT_VERDICT_CODES,
  INCOMPLETE_SURVEY_CODES,
} from "./validation-node";
export { componentEnvelopeIssues } from "./validation-components";
export { documentSeoIssues } from "./validation-seo";

/**
 * Issues only — the narrow view, DERIVED from {@link validateDocument} rather
 * than computed beside it.
 *
 * Most callers want exactly this and should keep using it. Reach for the richer
 * function when the answer decides whether to do more work on the same
 * document.
 */
export function validate(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationIssue[] {
  return validateDocument(doc, ctx).issues;
}

export function validateDocument(
  doc: BlockDocument,
  ctx: ValidationContext
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  // Taken before ANY return, so every path can hand back the measurement it
  // judged the document with. The walk accepts arbitrary input by design, so a
  // malformed document surveys as readily as a well-formed one — and a caller
  // that gets issues without a survey would have to guess whether the absence
  // means "not measured" or "nothing to measure".
  const survey = surveyDocument(doc, {
    maxBytes: limits.maxBytes,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
  });
  const unknownSeverity: IssueSeverity =
    ctx.mode === "strict" ? "error" : "warning";

  // A root that is not even a candidate for a record — `null`, a primitive, an
  // array — is refused before ANYTHING else is inspected, the caller's own
  // settings included. Reading an adversarial breakpoint set on behalf of a
  // document that was never going to be validated runs unrelated hostile input
  // for nothing.
  //
  // The THROW-FREE reading of the same question the envelope asks in full.
  // `isPlainRecord` settles it by asking for the prototype, which a hostile root
  // refuses — exactly the case the readability gate below exists for — so it
  // cannot run before the survey has had its say. `definitelyNotARecord` never
  // accepts what its fuller half would refuse, so refusing early here can only
  // ever agree with the envelope, and the two cannot drift apart.
  if (definitelyNotARecord(doc)) {
    issues.push(invalidDocumentIssue());
    return { issues, survey };
  }

  // The SITE's own breakpoints, before anything about the document is decided.
  // They come from the caller's settings rather than from the document, so a
  // duplicate id among them is true whatever the document turns out to be —
  // and collecting them inside the envelope meant an unreadable document
  // silently swallowed a fault in the site's configuration.
  const knownBreakpoints = collectBreakpointIds(ctx.breakpoints, issues);

  // A document the survey could not READ is not one to read, and this is the
  // first line after the measurement for that reason: everything below reaches
  // the document's own fields by ordinary property access.
  //
  // `surveyDocument` refuses to invoke an accessor — it reports the document
  // `document-unreadable` rather than run a getter it was handed. Reading on
  // regardless invokes exactly what it declined to, and a throwing getter then
  // leaves as a native error rather than the issue list this promises.
  // Measured, every field of a node did that, and so did `formatVersion`,
  // `kind` and `nodes` on the document itself — which is why the check sits
  // ahead of the envelope rather than after it.
  //
  // `unreadable`, and NOT `overLimits`. They are different facts and only one
  // is about reading: a document that merely exceeds `maxNodes` was read
  // perfectly well and reports `traversed: false` with `unreadable: false`, and
  // its nodes are still worth checking under the cap. Stopping on the broader
  // fact would drop every per-node issue such a document earns.
  //
  // The verdict is still RECORDED before returning, or a caller gets an empty
  // issue list for a document nothing could read.
  if (survey.unreadable) {
    checkLimits(survey, issues);
    return { issues, survey };
  }

  const envelope = documentEnvelope(doc, unknownSeverity, issues);
  if (envelope.stop) return { issues, survey };

  checkLimits(survey, issues);
  //
  // `document-unwritable` belongs here for a sharper reason than tidiness: the
  // byte pass could not measure what it refused. A `styles` accessor is
  // reported absent rather than invoked, so its megabytes were never counted —
  // and the per-value work below reaches the same field by ordinary property
  // access, runs the getter, and parses everything it returns. Leaving it out
  // meant the one document whose size is UNKNOWN was the one whose values were
  // parsed in full.
  // Asked of the SURVEY rather than reconstructed from the issues it produced.
  // Matching issue codes re-derives, from four strings, a fact the walk already
  // established — and a code list is a second statement of when the numbers are
  // untrustworthy, which goes stale the first time a fifth way to stop short is
  // added. `complete` is that fact, derived where it is known.
  //
  // `traversed`, NOT `complete`, and the difference is a fail-open. `complete`
  // additionally requires the counts to be the writer's, so a node hook
  // returning a replacement makes it false on a document the walk read from end
  // to end — and every per-value check below was then skipped on a document
  // with nothing wrong with it. Coverage silently dropped, no issue raised.
  //
  // The narrow question is the one this needs. A document JSON merely REWRITES
  // was measured in full, so the per-value work below is bounded and skipping it
  // would drop real issues on a document whose only fault is that a value comes
  // back changed. It is a measurement that STOPPED SHORT which leaves nothing
  // bounded, and that is exactly what `traversed` reports.
  const overLimits = !survey.traversed;

  // Per-kind rules. Only `component` has any today, and it is the kind whose
  // extra fields nothing else in the document can check: `exposed` and `slots`
  // are pointers INTO the node forest, so this is the first point at which
  // they can be resolved at all.
  //
  // After the limits verdict, and skipped once it is negative, for the same
  // reason the per-value work below is: a document the survey could not
  // traverse is refused already, and an envelope with a million entries would
  // otherwise be walked in full — and produce an issue per entry — to add
  // nothing to a refusal that has already been made.
  if (envelope.kind === "component" && !overLimits) {
    // The SURVEY's snapshot, not `limits`. `DocumentLimits` is an ordinary
    // object a caller may back with a getter, and `surveyDocument` snapshots
    // it precisely so two readings cannot disagree. Re-reading here would let
    // a shrinking limit report a node the survey counted as missing from the
    // index, which surfaces as `exposed-node-missing` on a sound definition.
    validateComponentEnvelope(
      envelope.doc,
      envelope.nodes,
      survey.limits.maxNodes,
      issues
    );
    // Here rather than in the envelope check a planner's dry run asks: whether
    // a clash is refused depends on the stored definition, which only a save
    // brings, and no exposure edit can create one.
    issues.push(...variantLabelIssues(envelope.doc.variants, ctx.stored));
  }

  const state = nodeCheckState(ctx, issues, knownBreakpoints, unknownSeverity, {
    overLimits,
  });

  // Document-level styles use the same envelope as node styles but have no
  // owning node, so validate them here or they would go unchecked.
  const settings = envelope.doc.settings;
  if (isPlainRecord(settings) && settings.styles !== undefined) {
    validateStyleEnvelope(settings.styles, "/settings/styles", state);
  }
  // Skipped past the document's limits, as the other per-value checks are:
  // the survey stopped reading, and a value of any width would otherwise be
  // walked whole.
  if (!overLimits && isPlainRecord(settings) && settings.seo !== undefined) {
    validateDocumentSeo(settings.seo, "/settings/seo", issues);
  }

  validateNodeForest(envelope.nodes, state, survey.limits.maxNodes);

  // Each collection list's query: its bounds, filter rows, sort and related
  // source, and the fields it names when the caller can answer for them.
  // Under the survey's node cap, and skipped past the limits as the per-value
  // work above is. A problem a stored form already held stays a warning, so a
  // list a schema change broke does not make its page unsavable.
  if (!overLimits) {
    const judgement = {
      ...schemaJudgement(ctx, survey.limits.maxNodes),
      // A list whose source is a named query, and a condition on its rows,
      // are judged against the query's declaration.
      ...(ctx.namedQueries === undefined
        ? {}
        : { namedQueries: ctx.namedQueries }),
    };
    issues.push(
      // As validation issues: the path names the block, so the block's id
      // each judgement also carries is left to the editor that asks for it.
      ...listQueryIssues(envelope.nodes, {
        ...judgement,
        ...(ctx.namedQueries === undefined
          ? {}
          : { namedQueries: ctx.namedQueries }),
        // So a list in a component or a Layout region, which shows on many
        // pages, is refused a split into pages of its own.
        ...(typeof envelope.kind === "string"
          ? { documentKind: envelope.kind }
          : {}),
      }).map(withoutNodeId),
      // Each block's visibility conditions, judged as its lists are: the
      // operator always, the field against the entry's or the list item's
      // schema when given, a problem a stored form held kept a warning.
      ...conditionIssues(envelope.nodes, judgement).map(withoutNodeId),
      // Each binding, on a block or in the document's own metadata, against
      // the schema of what it reads, when the caller can answer for it: the
      // same rule the renderer falls back by, a problem a stored form held
      // kept a warning.
      ...(ctx.bindingSchema === undefined
        ? []
        : bindingSchemaIssues(
            { nodes: envelope.nodes, settings },
            {
              schema: ctx.bindingSchema,
              ...(ctx.bindingEntry === undefined
                ? {}
                : { entry: ctx.bindingEntry }),
              ...(ctx.definitions === undefined
                ? {}
                : { definitions: ctx.definitions }),
              ...(ctx.stored === undefined ? {} : { stored: ctx.stored }),
              maxNodes: survey.limits.maxNodes,
            }
          ).map(withoutNodeId)),
      // The Entry content block: in a template only, one per template, and
      // its field named as text. Whether that field is a blocks field of the
      // template's collection is the server's to judge, with the schema.
      ...entryContentIssues(envelope.nodes, {
        documentKind: envelope.kind,
        maxNodes: survey.limits.maxNodes,
      }).map(withoutNodeId)
    );
  }

  return { issues, survey };
}

/**
 * What a list's query and a block's conditions are judged with: the fields
 * the public may read of each collection, the collection of the page's
 * entry, and the stored forms whose problems stay warnings. One judgement
 * for both, so a field a list may filter by is the field a condition may
 * check.
 */
function schemaJudgement(
  ctx: ValidationContext,
  maxNodes: number
): {
  readonly fields?: ListFieldSource;
  readonly entryCollection?: string | null;
  readonly stored?: readonly BlockDocument[];
  readonly maxNodes: number;
} {
  const entry = ctx.bindingEntry;
  return {
    ...(ctx.listFields === undefined ? {} : { fields: ctx.listFields }),
    // A Single's page is no collection's entry: its renderer has no entry
    // to read a relation of, or to check a condition against.
    ...(entry === undefined
      ? {}
      : { entryCollection: "collection" in entry ? entry.collection : null }),
    ...(ctx.stored === undefined ? {} : { stored: ctx.stored }),
    maxNodes,
  };
}

/** A judgement's finding as a validation issue, without its block's id. */
function withoutNodeId<Issue extends { readonly nodeId: string }>({
  nodeId: _nodeId,
  ...issue
}: Issue): Omit<Issue, "nodeId"> {
  return issue;
}
