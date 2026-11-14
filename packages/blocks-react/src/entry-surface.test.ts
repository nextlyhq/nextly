/**
 * What the package's entry points actually export.
 *
 * A published changeset once advertised `defineBlock` as a new export while the
 * root entry never re-exported it, so every `import { defineBlock } from
 * "@nextlyhq/blocks-react"` failed to resolve. Nothing caught it: the symbol
 * existed, its own module's tests imported it by relative path, and typechecking
 * a package cannot notice that a public entry omits something.
 *
 * So the entry list is pinned. The value is not the list itself but the failure
 * it forces: adding a symbol to a module no longer silently fails to reach the
 * people the release notes told about it, and removing one from the entry is a
 * deliberate edit here rather than an accident there.
 *
 * Values only. Types are erased before this runs and cannot be enumerated, so
 * they are covered by the compile-time import below instead.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as bindingWireModule from "./binding-wire";
import * as boundaryModule from "./block-boundary";
import * as blocksEntry from "./blocks/index";
import * as listReadModule from "./blocks/list-read";
import * as blockPropsModule from "./blocks/props";
import * as typographyDefaultsModule from "./blocks/typography-defaults";
import * as containerRootModule from "./blocks/container-root";
import * as componentSourceModule from "./component-source";
import * as contextModule from "./context";
import * as listCollectionsModule from "./list-collections";
import * as richTextModule from "./rich-text";
import * as pagePartsModule from "./page-parts";
import * as pageReadCountModule from "./page-read-count";
import * as pageReadStagesModule from "./page-read-stages";
import * as pageRendererModule from "./page-renderer";
import * as pageStyleTraceModule from "./page-style-trace";
import * as placeholderModule from "./placeholder";
import * as previewContainerModule from "./preview-container";
import * as prepareModule from "./prepare-document";
import * as readPageModule from "./read-page";
import * as resolverModule from "./resolver";
import * as sanitizeModule from "./sanitize";
import * as sharedStyleInputsModule from "./shared-style-inputs";
import * as stylesModule from "./styles";
import * as visibilityModule from "./visibility";
import * as rootEntry from "./index";
import * as nextEntry from "./next";

// Type-only, and the point is that it compiles: the tests project typechecks
// this file, so a type that stops being exported from the root fails the build
// rather than this suite. Without it the pin below would cover values alone.
import type {
  BlockRenderArgs,
  PageContext,
  QueryBudget,
  ReactBlockDefinition,
  ReconciledStyleInputs,
} from "./index";

/**
 * Whether an exported value is a block definition.
 *
 * Structural rather than an `instanceof`: `defineBlock` returns its argument
 * unchanged, so a definition is a plain object and there is no class to test.
 * The three fields checked are the ones the registry requires.
 */
function isBlockDefinition(
  value: unknown
): value is { name: string; version: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.render === "function"
  );
}

/**
 * Source modules the root entry re-exports from, and the values each one
 * deliberately keeps internal.
 *
 * The snapshot below catches an export REMOVED from the entry. It cannot catch
 * one that never arrived: adding a public value to `context.ts` and forgetting
 * the re-export leaves `Object.keys(rootEntry)` unchanged, and that is exactly
 * the defect this suite was written after.
 *
 * So the entry is compared against its sources. A new public value fails here
 * until it is either re-exported or named below with a reason, which makes
 * withholding one a deliberate act rather than an oversight.
 */
const SOURCE_MODULES: ReadonlyArray<{
  name: string;
  module: Record<string, unknown>;
  /** Values that exist for this package's own use, and why. */
  internal: readonly string[];
}> = [
  {
    name: "blocks/typography-defaults",
    module: typographyDefaultsModule,
    // Both values are the consumer surface: the baseline itself, so a host
    // can read what it is replacing, and the function that applies it, so a
    // host assembling its own compile context reaches the same answer the
    // renderer does rather than spreading the record in by hand.
    internal: [],
  },
  {
    name: "blocks/container-root",
    module: containerRootModule,
    // Its one value is the consumer surface: which element a Section or Box
    // renders as its root, asked by an editor.
    internal: [],
  },
  {
    name: "component-source",
    module: componentSourceModule,
    // The questions a caller outside the render can legitimately ask are
    // public: which components a page lacks, and the definitions it reaches
    // (the page builder's Layout choices read a region's components, nested
    // ones included, as the published route reads them). The constants and
    // the lookup memo are the render's own machinery: a consumer reaching for
    // the constants is sizing a batch the render decides.
    internal: [
      "COMPONENT_TAG_COLLECTION",
      "EMPTY_DEFINITIONS",
      "MAX_DISCOVERED_COMPONENTS",
    ],
  },
  {
    name: "blocks/list-read",
    module: listReadModule,
    // `conditionDayStart` is public, for the editor's canvas to judge a
    // condition's day as the published page does. The rest is how a list
    // reads its entries and counts its pages, which the list block and the
    // route drive; a consumer draws a list through the block.
    internal: [
      "dayStartIn",
      "listEntryCount",
      "listPageWindow",
      "listPagesOf",
      // Published from `./blocks` beside `listEntryCount`, for the editor's
      // canvas, rather than from the root.
      "listShownCount",
      "listWillRead",
      "namedListBase",
      "readList",
      "wholeCount",
    ],
  },
  {
    name: "binding-wire",
    module: bindingWireModule,
    // The wire form and the one question about it an editor asks are public;
    // these two are how that form is written and read back.
    internal: ["recordedFieldShapes", "shapeRefKey"],
  },
  {
    name: "blocks/props",
    module: blockPropsModule,
    // `fetchableUrl` is public, for a caller judging what a page draws by the
    // renderer's one filter. The rest is how a block reads its own stored
    // props: a block author's input is the render arguments, not these.
    internal: [
      "boundImage",
      "boundText",
      "canLink",
      "flag",
      "isAuthoredText",
      "isPresent",
      "isTrustedOrigin",
      "LINK_PROPS",
      "linkFor",
      "number",
      "oneOf",
      "readClaimOf",
      "relFor",
      "text",
      "url",
    ],
  },
  {
    name: "context",
    module: contextModule,
    // How the route batches its component reads, shared with the context's
    // own reader; a consumer's batching is its own provider's.
    internal: ["COMPONENT_BATCH_SIZE", "componentBatches", "placementsOf"],
  },
  // Public whole: the editor's count of what a page reads when published,
  // which runs the published route's own read stages.
  { name: "page-read-count", module: pageReadCountModule, internal: [] },
  {
    name: "page-read-stages",
    module: pageReadStagesModule,
    // Its types describe `countPageReads`' arguments and are published beside
    // it. The stages themselves are the route's and that count's to run; a
    // consumer asks through `countPageReads` or the route.
    internal: [
      "drawWithRegions",
      "effectiveLimits",
      "listDayInputs",
      "pagedListOf",
      "pageTimeZone",
      "readPageInputs",
      "readPageStages",
      "readsMediaInBatches",
      "stagedContext",
    ],
  },
  {
    name: "list-collections",
    module: listCollectionsModule,
    // The walk behind `listCollections`, shared with the route's other
    // questions about a page's lists; not a consumer surface.
    internal: ["anyListWhere", "listCollectionsWhere", "listPropsAsBound"],
  },
  // Public whole: how a page and the regions of its Layout share one site
  // sheet and keep their styles apart, asked by the published route and the
  // editor's canvas alike.
  { name: "page-parts", module: pagePartsModule, internal: [] },
  {
    name: "rich-text",
    module: richTextModule,
    // The component and its props are public. The node-walking helpers are
    // not: a caller wanting words out of rich text uses `richTextToPlainText`
    // from the engine, which is the same walk the CMS uses, rather than a
    // second one here. These are exported only so their own test can drive
    // them at a depth React's renderer could not reach, and at the
    // partition's bound from both sides. `drawsInteractive` is shared with the
    // rich-text block's content model in this package, not offered outside it,
    // and so is `passageHeadings`, the walk the table-of-contents block lists
    // a passage's headings by. `VIEWS_DRAWING_CHILDREN` is exported for the
    // test that holds every view to what it declares it draws.
    internal: [
      "drawsInteractive",
      "holdsBlockContent",
      "holdsInteractive",
      "MAX_PARTITION_DEPTH",
      "partitionPhrasing",
      "passageHeadings",
      "VIEWS_DRAWING_CHILDREN",
    ],
  },
  { name: "page-style-trace", module: pageStyleTraceModule, internal: [] },
  { name: "resolver", module: resolverModule, internal: [] },
  {
    name: "sanitize",
    module: sanitizeModule,
    // `sanitizeDocument` is public, so the editor's canvas judges a page's
    // conditions on the tree the renderer draws, not a corrupt node it drops.
    // Repairing duplicate ids is a step of the renderer's own preparation.
    internal: ["dedupeNodeIds"],
  },
  {
    name: "shared-style-inputs",
    module: sharedStyleInputsModule,
    // Nothing here is a consumer surface, and `sharedStyleInputsId` is the one
    // that had to be WITHDRAWN rather than never offered. It was published so a
    // write path outside the package could stamp what `toPageStyles` stores —
    // but the identity a READER derives is taken over a compile context the
    // resolver has narrowed first: block defaults reduced to the types the
    // document draws, and filled in from the resolver where the caller stated
    // none. A writer calling this with its own context computes a different
    // answer and writes an artifact every read refuses, which is the opposite of
    // what publishing it was for.
    //
    // A writer's answer is `resolvePageStyles` with no stored artifact: it
    // compiles and RETURNS the stamped result, so the value written is the value
    // a reader recomputes. Publishing a way to assemble the identity by hand
    // offers a second answer to a question that must have one.
    //
    // The pre-hash label exists to explain an unexpected recompile from inside,
    // not to be compared by a consumer who would then be holding a second
    // opinion about staleness. `stampedUnderCurrentEncoding` is that same
    // staleness question, asked by `styles.ts` on a read with no context.
    internal: [
      "sharedStyleInputsId",
      "sharedStyleInputsLabel",
      "stampedUnderCurrentEncoding",
      "UNIDENTIFIED_SHARED_INPUTS",
    ],
  },
  {
    name: "styles",
    module: stylesModule,
    // `readableGatedRules` is exported so `page-renderer` reads a stored artifact's gated map
    // through the SAME predicate the delivery uses. They once disagreed — one accepted anything
    // not undefined, the other required a plain record — so a malformed map counted as coverage
    // while going unread, and the stale sheet shipped a hidden block's rules. It crosses a module
    // boundary inside this package; it is not a consumer surface.
    // `UNIDENTIFIED_FETCH_POLICY` is the renderer's answer to a caller that
    // supplies its own fetch predicate and does NOT say which policy it stands
    // for: an identity no stored sheet can match, so nothing is reused. It
    // crosses a module boundary inside this package and is not a consumer
    // surface — a caller that wants its sheets cached states its own id rather
    // than reaching for this one, and publishing a sentinel is how it would end
    // up stored in an artifact and then matched against itself.
    // `drawlessTestFor` is the ONE derivation of "does this node draw nothing",
    // resolving a caller's own `drawsNothing` against the block declarations.
    // `page-renderer` prunes through it and `resolvePageStyles` compiles and
    // reads through it, so a host's override cannot be honoured on one path and
    // ignored on the other. It crosses a module boundary inside this package; a
    // consumer states its answer through `styleContext.drawsNothing` instead.
    // `effectiveCompile` reconciles a caller's context with what the stored
    // artifact and the host already knew — the scope that lives on the artifact,
    // the caps preparation honoured, and the identity a fetch predicate needs
    // before a stored sheet can be judged against it. `page-renderer` and
    // `read-page` both resolve a stored page and must not answer any of those
    // differently, which is why it is one function rather than two.
    // Deliberately NOT a consumer surface: publishing it would offer a third way
    // to assemble a page by hand, and assembling by hand is precisely the path
    // that gets this wrong. `preparePageForRead` is the consumer's answer.
    // `gatedEntriesCoverRemovedNodes`, `gatedMapCoversPrunedNodes` and
    // `hasDuplicateNodeIds` are the artifact-trust vocabulary: what a stored
    // sheet can still ACCOUNT for once a pass has removed something. They live
    // beside `isRecordedGatedEntry`, which they read through, so coverage and
    // delivery cannot disagree about the same map. `page-renderer` and
    // `read-page` both decide whether to trust a stored artifact and must reach
    // the same verdict — a type-level rule survives its last node either way,
    // and a duplicate id suppresses both twins' rules either way. They cross a
    // module boundary inside this package; a consumer asks the question through
    // `preparePageForRead` rather than assembling the verdict itself.
    // `toPageStyles` converts a compile into the storable shape, and it asks its
    // caller for the shared-input identity — a value only the resolver can
    // produce, because the identity is taken over a context the resolver has
    // narrowed first. Published, it is a converter that CANNOT make a reusable
    // artifact: every sheet written through it is unstamped, and an unstamped
    // sheet is refused by every context-bearing read. `resolvePageStyles` with
    // no stored artifact is the whole answer — it compiles, stamps and returns
    // the storable value in one call.
    //
    // `fetchPolicyLabel` stays public beside it, and the difference is the
    // point: that label is a pure function of the host's pattern list, and the
    // reader computes it from the same list, so a writer CAN match it.
    internal: [
      "UNIDENTIFIED_FETCH_POLICY",
      "toPageStyles",
      // `blockBasesFor` is the ONE reading of "which block types does this tree
      // draw defaults from". `resolvePageStyles` derives it from the tree it is
      // handed, which is already narrowed by the read-time passes; `page-renderer`
      // holds the wider tree the stored artifact was compiled from and states the
      // answer for it, so a covered drop does not move the identity and refuse
      // the very artifact that drop was licensed to keep. Two derivations of it
      // would disagree exactly there. It crosses a module boundary inside this
      // package; a consumer states its own through `styleContext.blockBases`.
      "blockBasesFor",
      // Internal for the same reason and by the same route: it is the same walk
      // over the same tree, reading a different field of the definition, so a
      // consumer stating its own answer states it through
      // `styleContext.blockParts` exactly as it does for the bases.
      "blockPartsFor",
      "drawlessTestFor",
      "effectiveCompile",
      "gatedEntriesCoverRemovedNodes",
      "gatedMapCoversPrunedNodes",
      "hasDuplicateNodeIds",
      "isRecordedGatedEntry",
      "isUsableGatedEntry",
      // The rules a list serves beside the first instance of a block its items
      // decide. The renderer asks it of the artifact it just compiled.
      "itemDecidedRules",
      // The newest member of that family, and the reason it lives here rather
      // than beside either caller: a migration that turns a drawing node
      // drawless leaves stale rules published, and a fix reaching only one
      // entry point recreates the divergence this list exists to prevent.
      "migrationChangedWhatDraws",
      "readableGatedRules",
    ],
  },
  {
    name: "visibility",
    module: visibilityModule,
    // `isUnconditional` is the negation of the engine's `isConditionGated`, which
    // `@nextlyhq/blocks-engine` already exports. Publishing a second spelling of one
    // question from a second package is how the compiler and this renderer came to
    // disagree about gating three separate times; the entry offers the PASS a caller
    // actually needs and leaves the predicate with its single owner.
    // `drawsNothing` is the same case one question over: the engine owns
    // `declaresNoMarkup`, and this is the spelling that reads it through a
    // resolver.
    // `pruneNodes` is the shared walk the three passes share so their identity
    // behaviour cannot diverge. It is a shape, not a policy, and a consumer
    // reaching for it is writing a fourth pass this package cannot account for.
    // `entrySubjectOf` is the route's reading of its own read bindings: the
    // entry a page's conditions judge. It lives beside the gate so the rule
    // sits with the evaluator, and only the `./next` route, which made that
    // read, has the bindings to hand it.
    //
    // The rest is how the route and the renderer decide a page's conditions
    // between them. `pruneHiddenNodes` is the pass a caller needs; each of
    // these takes the route's own read of the entry, or the state of a render
    // in progress.
    internal: [
      "conditionAllows",
      "drawsNothing",
      "entryConditionedIn",
      "entrySubjectOf",
      "gateByConditions",
      "isUnconditional",
      "itemFields",
      "markByConditions",
      "pruneNodes",
    ],
  },
  { name: "placeholder", module: placeholderModule, internal: [] },
  {
    name: "preview-container",
    module: previewContainerModule,
    internal: [],
  },
  {
    name: "page-renderer",
    module: pageRendererModule,
    // `sharedStyleInputs` is PUBLISHED, so it is absent from the list below.
    //
    // It reconciles the site tier with the route's context — named classes,
    // block bases, the token prefix — and the callers needing that answer are
    // not all inside this package. A surface that decides anything from "the
    // breakpoints this page compiles against" has to read the same answer the
    // render will use, and a compile assembled independently is a second answer
    // to one question. Publishing the RECONCILIATION is not publishing a way to
    // build a compile context: `compileContextFor` remains the only one of
    // those, and this returns a patch of already-reconciled inputs.
    //
    // `withoutStatedNulls` stays internal for the same reason: it crosses a
    // module boundary so `page-style-trace` and this module do not each decide
    // what a stated null means at a compile boundary, and a host composing a
    // context has no use for it — it exists to DELETE a copy rather than to
    // offer an API.
    //
    // `pruneRenderedPlaceholders` is the case that stays internal, and the
    // contrast is the point. It answers "which tree does this page's sheet
    // describe" for the nodes a placeholder replaced, and the editor's cascade
    // read has to ask exactly that: pruned harder, the trace withholds an
    // account of markup that is on the page; pruned less, it names a source for
    // markup that is not. Rebuilt from `rendersOwnMarkup` it would be a second
    // implementation of one pass, which is the drift the pass's own docblock
    // argues against — but it is an internal derivation rather than something a
    // host composes with, so it crosses a module boundary and stops there.
    //
    // `pageCompileContext` is internal too: it lets the `/next` route draw a
    // page and its Layout's regions with one site sheet between them, each
    // document compiled under the context the renderer itself would derive.
    // A host renders one document and has the renderer derive it.
    internal: [
      "pageCompileContext",
      "pruneRenderedPlaceholders",
      "statedBreakpoints",
      "withoutStatedNulls",
    ],
  },
  {
    name: "prepare-document",
    module: prepareModule,
    // All three cross a module boundary inside this package; none is a consumer
    // surface, and each was exported to DELETE a copy rather than to offer an
    // API.
    //
    // `rendersOwnMarkup` is NOT among them any more: it is published, because
    // the editor asks it whether a node draws its own markup before reserving a
    // dom id the page will never render. That is a question about this
    // renderer's behaviour, which only this renderer can answer.
    //
    // `pruneKnownPlaceholders` was defined a second time in `page-renderer`.
    // Two implementations of one pass agree the day they are written and drift
    // after, and this one decides what a stored stylesheet may still describe —
    // so the drift ships rules for markup that is gone.
    //
    // `prepareDocumentReadStages` is the pipeline reporting the states it passed
    // through, which one caller needs because it compares them by reference to
    // decide whether a stored artifact still fits the tree. A consumer wanting the
    // prepared document already has `prepareDocumentForRead`; a consumer wanting
    // the intermediates is reasoning about artifact trust, which is this package's
    // job and not something to hand out before anyone has asked for it.
    //
    // `readingViewOf` is the all-placeholder rule, which both entry points that
    // turn stages into something a reader presents must apply identically. It
    // is exported to delete the second copy, not to be called on its own: it
    // takes stages, and a consumer holding stages is already past this surface.
    //
    // `isUnresolvedInstance` is the same shape as `pruneKnownPlaceholders`: it
    // crosses to the block boundary so that ONE reading of the marker decides
    // both what the pipeline keeps and what the renderer draws. Two readings
    // is precisely how the renderer came to hide a node the exported reader
    // returns. A consumer never holds a resolved node without also holding the
    // stages that explain it, so there is nothing here to offer.
    //
    // `prepareDocument` and `readStagesFor` are the route preparing a page once
    // and the renderer reusing that preparation. The prop that carries one is
    // internal, and what it carries is sealed inside this module, so there is
    // nothing here a consumer could build.
    //
    // `regateDocument`, `heldConditionsOf` and `holdsBackConditions` are that
    // same preparation deciding a page's conditions once the route has read
    // its entry, sealed the same way.
    internal: [
      "heldConditionsOf",
      "holdsBackConditions",
      "isUnresolvedInstance",
      "prepareDocument",
      "prepareDocumentReadStages",
      "pruneKnownPlaceholders",
      "readingViewOf",
      "readStagesFor",
      "regateDocument",
    ],
  },
  {
    name: "read-page",
    module: readPageModule,
    // Nothing withheld: the module exists to offer one entry point, and the
    // repair test it decides with is module-private because the whole point is
    // that a caller never has to ask it.
    internal: [],
  },
  {
    name: "block-boundary",
    module: boundaryModule,
    // The renderer calls these; a consumer composes `PageRenderer` or
    // `BlockList` instead of driving normalization itself.
    internal: ["checkedOutput", "nodeRootReason"],
  },
];

describe("the root entry", () => {
  it("exports exactly these values", () => {
    expect(Object.keys(rootEntry).sort()).toEqual([
      "BlockBoundary",
      "BlockList",
      "BlockPlaceholder",
      // The field a component row stores its document under. Public because a
      // caller configuring a readiness check outside the render must name the
      // SAME field the render reads, and a second spelling of it is a second
      // answer.
      "COMPONENT_DOCUMENT_FIELD",
      // The editor marker namespace, public so an editor refuses a name the
      // renderer would drop rather than keeping a list beside it.
      // The read budget's default: see `createQueryBudget`.
      "DEFAULT_MAX_QUERIES",
      "EDITOR_NAMESPACE",
      // The Entry content block's marks on the editor's canvas, public so the
      // canvas's sheet draws by the names the renderer writes.
      "ENTRY_CONTENT_DRAWN_ATTRIBUTE",
      "ENTRY_CONTENT_NOTE_ATTRIBUTE",
      "INSTANCE_ATTRIBUTE",
      // The action a collection list's note offers on the editor's canvas,
      // public so the canvas acts on the name the renderer writes.
      "LIST_ACTION_ATTRIBUTE",
      // The log reference that note's copy button carries, public for the same
      // reason: the canvas copies the value the renderer wrote.
      "LIST_REF_ATTRIBUTE",
      "NODE_ID_ATTRIBUTE",
      // The container names a preview compile aims its breakpoints at. Public
      // because the surface doing the previewing must put the same identifier
      // in its own `container-name`, and a name spelled twice can be spelled
      // differently.
      // The style a previewing surface puts on its own box: the container name
      // AND the `container-type` that makes it a size-query container, in one
      // value so neither can be applied without the other.
      "PREVIEW_CONTAINER_STYLE",
      "PREVIEW_VIEWPORT_CONTAINER",
      "PROP_ATTRIBUTE",
      "PageRenderer",
      // The kinds of read a page's allowance counts, in the order the editor's
      // read meter lists them, so it cannot name a kind the budget does not.
      "READ_KINDS",
      "RichText",
      // The container marker. Public so an editor asks whether a block declares
      // slots instead of keeping a hardcoded list of container type names.
      "SLOTS_ATTRIBUTE",
      "TYPOGRAPHY_DEFAULTS",
      "UNPREVIEWABLE_CONTAINER",
      // Added deliberately: binding sources read on a server, carried to the
      // editor's canvas and read back there, by one pair of functions.
      "bindingsFromWire",
      "bindingsToWire",
      // When a day starts for a visibility condition on a date, in the site's
      // zone: public so the editor's canvas judges conditions with the rule
      // the published page judges them with.
      "conditionDayStart",
      // What a page reads when published, counted in the editor by the route's
      // own read stages.
      // Which element a Section or Box renders as its root, for an editor
      // saying what the page will hold.
      "containerRootTag",
      "countPageReads",
      "createBlockResolver",
      // The provider a route reads its lists through when given none, public
      // so a route's own `data` can narrow it rather than rewrite it.
      "createDefaultDataProvider",
      // The bound on one render's reads, and its default, public so every
      // surface that draws a page (the editor's canvas too) bounds alike.
      "createQueryBudget",
      "createStandaloneContext",
      "defineBlock",
      // The definitions a document reaches, discovered as the render does.
      "definitionsFor",
      "emptyDataProvider",
      "fetchPolicyLabel",
      // The image and embed blocks' one filter on an address, public so a
      // caller judging what a page draws asks what they ask.
      "fetchableUrl",
      // The render-safe attribute rule. Public because the editor offering that
      // field asks it rather than keeping a copy that would drift.
      "isAllowedAttribute",
      // Splits the page's reported issues for a handler that reads only the
      // bindings', the union `PageIssue` being public.
      "isBindingIssue",
      "islandsFor",
      // Which part of a page drawn inside its Layout emits the site sheet, and
      // the scope each part compiles under.
      "layoutPartSheets",
      // One block with its conditions lifted, as the editor draws one that
      // holds while conditions are applied.
      "liftedNode",
      // The collections a page's lists draw: the published route and the
      // editor's canvas ask one walk which lists a page holds.
      "listCollections",
      "migrationSourceFor",
      // Whether a recorded lookup found no field a visitor may read, so the
      // editor can say a whole source is hidden from visitors.
      "noPublicFields",
      "pageBindingRun",
      "pageStyleTrace",
      "prepareDocumentAsDrawn",
      "prepareDocumentForRead",
      "preparePageForRead",
      "previewContainerFor",
      "previewContainerStyle",
      "pruneHiddenNodes",
      "registeredBlocks",
      "rendersOwnMarkup",
      // The view of the definitions map the pipeline composes through. Public
      // because the editor composes a page beside the renderer, for the marks
      // it draws over the canvas, and must compose the same tree: repair drops
      // malformed nodes before they count against the page's budget, so a view
      // of its own would compose a different tree than the one drawn.
      "repairingLookup",
      "resolvePageStyles",
      "resolvePageStylesWithTrace",
      // A stored document made sound to walk, as the renderer makes it: public
      // so the editor judges conditions on the tree the renderer draws.
      "sanitizeDocument",
      "sharedStyleInputs",
      "styleTextForInjection",
      // The render's own discovery, asked from outside the render. Public so a
      // publish-time check reports the components a VISITOR will not see,
      // rather than walking stored documents for ids the resolver never
      // requests.
      "unsuppliedComponentIds",
      "withTypographyDefaults",
    ]);
  });

  it("checks every module the entry re-exports from", () => {
    // The list above is the guard's own coverage, and a guard that covers five
    // of six modules leaves the sixth exactly as exposed as before. Read the
    // entry's own relative imports rather than trusting the list to keep pace.
    //
    // The path pattern admits a `/`. Without it a nested re-export matched
    // NOTHING rather than matching wrongly, so the module was absent from
    // `reExported`, the difference below came out empty, and a guard reporting
    // full coverage was checking one module fewer than the entry uses.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8"
    );
    const reExported = new Set(
      [...source.matchAll(/from "\.\/([\w/-]+)"/g)].map(match => match[1])
    );
    const covered = new Set(SOURCE_MODULES.map(entry => entry.name));

    const uncovered = [...reExported].filter(name => !covered.has(name));
    expect(
      uncovered,
      `index.ts re-exports from ${uncovered.join(", ")}, which SOURCE_MODULES does not check.`
    ).toEqual([]);
  });

  it("re-exports every public value its source modules define", () => {
    // The snapshot above sees an export leaving the entry. This sees one that
    // never reached it, which is the failure that produced this suite: a symbol
    // added to a module, announced in a changeset, and importable by nobody.
    const exported = new Set(Object.keys(rootEntry));

    for (const source of SOURCE_MODULES) {
      const internal = new Set(source.internal);
      const missing = Object.keys(source.module).filter(
        name => !exported.has(name) && !internal.has(name)
      );

      expect(
        missing,
        `${source.name}.ts exports ${missing.join(", ")} but the entry does not. ` +
          `Re-export it, or add it to that module's \`internal\` list with a reason.`
      ).toEqual([]);
    }
  });

  it("keeps every `internal` classification TRUE", () => {
    /*
     * The other direction of the same claim, and the one that was missing.
     *
     * The case above asks whether a module export reached the entry, and takes
     * `internal` as the reason it did not have to. Nothing asked whether a name
     * on that list is still absent from the entry — so publishing a symbol left
     * its own rationale standing, arguing in the file that publishing it would
     * be a mistake. Measured: adding an exported name to `internal` changed no
     * assertion, because the list is only ever read as an exemption.
     *
     * A classification nothing checks is a comment wearing a data structure's
     * clothes, and it drifts in the direction that reads as deliberate.
     */
    const exported = new Set(Object.keys(rootEntry));

    for (const source of SOURCE_MODULES) {
      const stale = source.internal.filter(name => exported.has(name));

      expect(
        stale,
        `${source.name}.ts lists ${stale.join(", ")} as internal, but the entry ` +
          `publishes it. Remove it from that list and say why it is public.`
      ).toEqual([]);
    }
  });

  it("offers everything needed to declare a block without a relative import", () => {
    // The three names a block author reaches for. `defineBlock` alone is not
    // enough: hand-rolling a definition, or typing a render function that is
    // written separately from the definition, needs the other two.
    const declared: ReactBlockDefinition<{ value?: string }> = {
      name: "test/entry-surface",
      version: 1,
      description: "Declared through the package entry alone.",
      props: {},
      defaultProps: {},
      example: { props: {} },
      render: ({ className }: BlockRenderArgs<{ value?: string }>) => null,
    };

    expect(rootEntry.defineBlock(declared)).toBe(declared);
  });

  it("keeps a context type reachable for a host wiring one up", () => {
    const context: PageContext = rootEntry.createStandaloneContext();
    expect(context.entry).toBeNull();
  });
});

describe("the blocks entry", () => {
  it("exports the core library and every block in it", () => {
    expect(Object.keys(blocksEntry).sort()).toEqual([
      "BUTTON_TYPES",
      "CONTAINER_TAGS",
      "CONTENT_WIDTH_CLASS",
      // Added deliberately: the palette's headings and the order they are
      // offered in. A host registering these blocks is the same host ranking
      // their categories, so the ordered list ships from this entry. The four
      // individual category constants stay internal — the block files reach
      // them by relative import, and publishing them would add four names no
      // consumer needs and which could then never be renamed.
      "CORE_CATEGORIES",
      "CORE_PALETTE_ORDER",
      "FORM_FIELD_TYPES",
      "FORM_METHODS",
      "HEADING_LEVELS",
      "IMAGE_LOADING",
      "LIST_KINDS",
      "TABLE_OF_CONTENTS_DEPTHS",
      "accordion",
      "accordionItem",
      "box",
      "button",
      "card",
      // Added deliberately, for a host running a named query where it is asked
      // for: the failure a run carries, its log line, and the run itself.
      "carriedFailureOf",
      "collectionLoop",
      "column",
      "columns",
      "coreBlocks",
      "divider",
      "embed",
      // Added deliberately: the Entry content block, where a template draws
      // the entry's own blocks content.
      "entryContent",
      "form",
      "gallery",
      "heading",
      "icon",
      "image",
      "list",
      // Added deliberately: the editor's count of a list's matching entries,
      // taken from the list's own read, so the two cannot disagree.
      "listEntryCount",
      // Added deliberately: the editor's count of the entries a list draws,
      // read through the list's own read.
      "listShownCount",
      // Added deliberately: how a list's stored custom source reads, for the
      // editor's choice of it and the host that runs it.
      "namedListBase",
      "namedQueryFailureLine",
      "paragraph",
      "quote",
      "readNamedList",
      "renderContainer",
      "richText",
      "section",
      "spacer",
      "tableOfContents",
    ]);
  });

  it("lists every exported block in coreBlocks", () => {
    // A block exported but left out of the list is registered nowhere, which is
    // the quiet half of the same mistake: the symbol resolves and the block
    // never appears.
    //
    // The exported set is DERIVED rather than listed, so exporting a new block
    // without adding it to `coreBlocks` fails here. Naming one member instead
    // would leave the other eleven unchecked, which is the exact hole this
    // guard exists to close.
    // Widened to `unknown` before the guard runs: the entry's values are a
    // heterogeneous union (definitions, a readonly tag list, a class name, the
    // array itself), and a predicate cannot narrow out of that union directly.
    const exported: string[] = [];
    for (const value of Object.values(blocksEntry)) {
      const candidate: unknown = value;
      if (isBlockDefinition(candidate)) exported.push(candidate.name);
    }
    exported.sort();
    const registered = blocksEntry.coreBlocks.map(block => block.name).sort();

    expect(exported.length).toBeGreaterThan(0);
    expect(registered).toEqual(exported);
    // And no name is registered twice, which would make the comparison above
    // pass while one block shadowed another in the registry.
    expect(new Set(registered).size).toBe(registered.length);
  });
});

describe("the next entry", () => {
  it("exports exactly these values", () => {
    // The route helper joins the entry marker here. Types are erased, so
    // `BlocksPageConfig` and `DerivedPageSeo` never appear in this list — the
    // guard is about what a consumer can CALL.
    expect(Object.keys(nextEntry).sort()).toEqual([
      "BLOCKS_REACT_NEXT_ENTRY",
      "DEFAULT_MAX_QUERIES",
      "createBlocksPage",
      // Added deliberately: the one route serving every address the site's
      // address store holds, a page's or a collection's entry's.
      "createContentPage",
      "createPublicBlocksPage",
      "createPublicContentPage",
      "createPublicSinglePage",
      "createSinglePage",
      // Added deliberately: what a page's design says about it, asked
      // outside a route by the route's own derivation, so a check or an
      // admin screen reads the values the published page is answered with.
      "designMetadataFor",
      // Added deliberately: what a page's bindings read, through whichever
      // reader a route passes, so the editor's canvas reads its binding
      // sources by the published page's own implementation.
      "readBindingSources",
    ]);
  });
});

describe("the type published beside `sharedStyleInputs`", () => {
  it("is the one that function returns", () => {
    /*
     * Two properties, and they are checked by different mechanisms.
     *
     * The ANNOTATION is the type half, and the TESTS PROJECT compiling this
     * file is what asserts it — so this case going green is not the evidence
     * for it; `check-types` is. A name published beside a function but
     * describing something else leaves a consumer able to read the type and
     * unable to use it, which no runtime assertion can observe. This package
     * held two types under one name, and the exported one required
     * `breakpoints` while the function may resolve nothing.
     *
     * The VALUE is the runtime half: `{}` is what "may resolve nothing" means,
     * and it is the case the required field would have rejected.
     */
    const resolved: ReconciledStyleInputs = rootEntry.sharedStyleInputs(
      undefined,
      undefined
    );

    expect(resolved).toEqual({});
  });
});
