/**
 * `@nextlyhq/blocks-react` — the React renderer for Nextly block documents.
 *
 * This entry renders documents with React alone. It imports no Next.js, no
 * admin code, and no CMS runtime, so a document can be rendered from a plain
 * React app, a test, or a script with nothing else installed. The Next-coupled
 * helpers live at `@nextlyhq/blocks-react/next`, and `layering.test.ts` turns
 * that separation into a hard failure rather than a convention.
 *
 * Everything here is a Server Component and none of it is a client component,
 * so a page whose blocks are all server blocks ships no JavaScript for the
 * renderer itself.
 *
 * @module index
 */
export type {
  BlockHostPolicy,
  BlockRenderArgs,
  BlocksDataProvider,
  BlocksQuery,
  BlocksResult,
  PageContext,
  QueryBudget,
  ReactBlockDefinition,
  ResolvedMedia,
} from "./context";
export {
  createStandaloneContext,
  defineBlock,
  emptyDataProvider,
} from "./context";

export { PageRenderer } from "./page-renderer";
export type { PageRendererProps } from "./page-renderer";
// Re-exported because `PageRendererProps.siteStyles` NAMES it, and a prop a
// consumer cannot type is a prop they cannot pass without reaching past this
// package into the engine. The type-surface ratchet is what caught it: a public
// declaration naming an engine type the entry does not export is a surface that
// compiles here and not at the call site.
//
// The rest are `SiteSheetInput`'s TRANSITIVE closure, and they are not padding.
// Naming the outer type alone lets a consumer declare a variable and not build
// one: the tokens are a `SiteTokenSet` of `SiteToken`s whose `kind` is a
// `TokenKind`, the fonts are `FontFaceDef`s of `FontSource`s, and `darkMode` is
// a `DarkModeStrategy`. A caller writing a site's design system needs every one
// of them by name, so withholding any makes the prop typeable but unusable —
// which is the same defect as not exporting the outer type, one level in.
/**
 * The cascade behind a page, for chrome that names where a value came from.
 *
 * Exported because the reconciliation it needs — named classes, block bases, the
 * token prefix and the fetch predicate, each resolved from two tiers — is
 * private to this package. A consumer assembling its own context compiles a
 * cascade the page never had, and the shortfall is silent: no class declaration
 * reaches the trace, so every value from a named class reports as set by nobody.
 */
export { pageStyleTrace } from "./page-style-trace";
export type { PageStyleCascade, PageStyleTraceInput } from "./page-style-trace";

export type {
  DarkModeStrategy,
  FontFaceDef,
  FontSource,
  SiteSheetInput,
  SiteToken,
  SiteTokenSet,
  TokenKind,
} from "@nextlyhq/blocks-engine";

/**
 * How this renderer reconciles a route context and a stored site tier.
 *
 * Published because a surface deciding anything from "the breakpoints this page
 * compiles against" must read the SAME answer the render will use, and the
 * precedences are not guessable from the inputs: the site tier wins for
 * `breakpoints` and `blockBases`, the route wins for `namedClasses` and
 * `previewContainer`, and each skips only `undefined` — so a stored `null`
 * survives and means something.
 *
 * A parallel implementation of a reconciliation is a second answer that agrees
 * until the day it does not, and this rule offers three separate ways to
 * disagree — an inverted precedence, a wrong fallthrough, and a stated `null`
 * discarded by a nullish coalesce. None of them is visible from the inputs, so
 * a caller that reads the rule carefully and rewrites it is no safer than one
 * that guesses.
 */
export { sharedStyleInputs, type ReconciledStyleInputs } from "./page-renderer";
/**
 * The typographic baseline, and the one way to apply it.
 *
 * Both are public because a host replacing the baseline needs to read what it
 * is replacing, and because a host assembling its own compile context must
 * reach the same answer the renderer does. Spreading the record in by hand is
 * the second implementation that would drift: `withTypographyDefaults` leaves a
 * context that states its own `elementBases` alone, and a caller open-coding
 * that check is one `??` away from overwriting a host's deliberate choice.
 */
export {
  TYPOGRAPHY_DEFAULTS,
  withTypographyDefaults,
} from "./blocks/typography-defaults";

export { BlockBoundary, BlockList } from "./block-boundary";
// `NODE_ID_ATTRIBUTE` is published deliberately: an editor hit-testing on the
// attribute must not hard-code its spelling, or the renderer and the editor hold
// two copies of one string and the editor breaks silently when it moves.
//
// `SLOTS_ATTRIBUTE` is public for the same reason: an editor looking for a
// container to draw an affordance on asks this attribute rather than keeping
// its own copy of the string the renderer emits.
export {
  EDITOR_NAMESPACE,
  NODE_ID_ATTRIBUTE,
  PROP_ATTRIBUTE,
  SLOTS_ATTRIBUTE,
} from "./block-boundary";
// The render-safe attribute rule, public so an editor asks it instead of
// keeping a second copy that would accept names the renderer drops.
export { isAllowedAttribute } from "./block-boundary";
export type { BlockBoundaryProps, BlockListProps } from "./block-boundary";

/**
 * Draw stored rich text as React.
 *
 * The CMS derives HTML from the same stored shape; this draws a React tree.
 * Both read the type and format bits from `blocks-engine`, which is the only
 * thing they can share — this package may not import the CMS.
 */
export { RichText, type RichTextProps } from "./rich-text";
export { BlockPlaceholder } from "./placeholder";
export type { BlockPlaceholderProps, PlaceholderReason } from "./placeholder";

export {
  createBlockResolver,
  migrationSourceFor,
  registeredBlocks,
} from "./resolver";
export type { BlockResolver } from "./resolver";

export {
  // Public because the WRITE path needs it, and unlike the shared-input identity
  // a writer can compute the SAME value a reader does: this is a pure function
  // of the host's pattern list, and `effectiveCompile` calls it on exactly that
  // list. A writer that could not compute the same label would stamp nothing,
  // every stored sheet would read as stale, and a site with a policy would
  // recompile its CSS on every render for ever.
  fetchPolicyLabel,
  resolvePageStyles,
  resolvePageStylesWithTrace,
  styleTextForInjection,
} from "./styles";
export type {
  PageStyles,
  ResolvedPageStyles,
  ResolveStyleOptions,
} from "./styles";

/**
 * Exported because `resolvePageStyles` has a precondition a caller could not otherwise meet.
 *
 * That helper expects the document it is handed to be the one that will RENDER. Called with a raw
 * document it emits rules for nodes a reader withholds, publishing the colours, fonts and
 * `url(...)` of a block nobody was served. `PageRenderer` runs these passes itself, so the ordinary
 * path is safe; a consumer assembling styles directly had the unsafe path available and no safe
 * one.
 *
 * The two are not interchangeable, and the difference is the whole point of publishing both.
 * `pruneHiddenNodes` is the gating pass ALONE, which is what a caller wants once it has run the
 * rest itself. `prepareDocumentForRead` is the whole sequence — format guard, shape repair against
 * the site's own caps, migration, gating, address repair, and pruning the subtrees a placeholder
 * replaces — and is the only thing that produces the tree the page actually presents. Gating alone
 * leaves a tree LARGER than the render's, so styles resolved against it still ship rules for nodes
 * the page drops.
 *
 * 🔴 Neither of them is the flow for serving a page's stored STYLESHEET, and preparing a document
 * then resolving styles against the result is the pairing that looks like it. What the second call
 * needs to know is whether the first REMOVED anything, and the prepared tree it receives no longer
 * says: a node the placeholder pass dropped takes its markup off the page while the block-type
 * defaults and named classes it pulled into the sheet stay, because those tiers are keyed by type
 * and by class rather than by node. `preparePageForRead` does both halves and answers that question
 * from the evidence, which is why it exists rather than a documented instruction to pass a flag.
 */
export { pruneHiddenNodes } from "./visibility";
export { prepareDocumentForRead, rendersOwnMarkup } from "./prepare-document";
export type { PrepareDocumentArgs } from "./prepare-document";
export { preparePageForRead } from "./read-page";
export type { PreparedPage, ReadPageArgs } from "./read-page";

/**
 * The engine types this package's own options are written in terms of.
 *
 * **A package that names a type in its public API owes that type to its
 * callers.** These originate in `@nextlyhq/blocks-engine`, which is a
 * DEPENDENCY of this package rather than a peer — so a host installing
 * `@nextlyhq/blocks-react` does not have it as a direct dependency and cannot
 * import from it. A type that reaches the built `.d.ts` in a parameter
 * position while no export statement names it leaves a host able to SEE the
 * name it is required to pass with no way to write it down.
 *
 * **The set is CLOSED, which is why it is larger than the names this package's
 * own signatures mention.** An exported type is only as writable as its parts:
 * a host handed `BlockDefinition` can name it and still be unable to write
 * down the `supports` object it must pass, or the `seo()` return it must
 * produce. Every type reachable from one exported here is therefore exported
 * too, so annotating any PART of the surface needs no second package.
 *
 * `/next` re-exports none of these. Its declarations import the `next` and
 * `nextly` peers, so a standalone install cannot load that entry at all; this
 * one imports nothing but the engine and resolves wherever the package does.
 *
 * `nextly`'s own types are deliberately NOT re-exported here. `nextly` is a
 * PEER dependency, so a host has installed it directly and should name
 * `ContentEntry`, `RenderContext` and the route shapes from `nextly/runtime`
 * where they live. Two import paths for one type is a worse cost than one
 * import a host already has the package for.
 */
export type {
  // Renamed, because this package declares its own `BlockRenderArgs`: a
  // one-parameter React specialization pinned to `PageContext`, which is what a
  // block written against `ReactBlockDefinition` receives. The engine's takes a
  // second parameter and leaves the context open, so a consumer annotating
  // `BlockDefinition<Props, CustomContext>` needs THIS one and cannot reach it
  // under a name already taken by a narrower type.
  BlockRenderArgs as EngineBlockRenderArgs,
  AnyBlockDefinition,
  Binding,
  BindingFormat,
  // Reachable from `BindingFormat`, whose variants are derived from the shape
  // map keyed by this type. A type a consumer can reach through a re-exported
  // one but cannot name is a hole in the surface.
  BindingFormatType,
  // Reachable from `Binding`, whose non-single branch is typed as
  // `Exclude<BindingSource, "single">` so the vocabulary has one owner. A type
  // a consumer can reach through a re-exported one but cannot name is a hole in
  // the surface, which `type-surface.test.ts` refuses.
  BindingSource,
  BlockDefinition,
  BlockDocument,
  BlockEditorMeta,
  BlockExample,
  BlockIcon,
  BlockMigrationInfo,
  BlockNode,
  BlockRenderResult,
  BlockSeoContribution,
  BlockSeoImage,
  BlockSupportValue,
  BlockSupports,
  BlockVariation,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  CompiledPageCss,
  ComponentPath,
  Condition,
  DocumentFormatVersion,
  DocumentKind,
  DocumentLimits,
  DocumentSettings,
  IssueCode,
  IssueSeverity,
  MayFetchUrl,
  MigrateFn,
  MigrationMap,
  MigrationSource,
  NamedClass,
  NodeStyles,
  NodeVisibility,
  PropSchema,
  RemotePattern,
  RemotePatternInput,
  SlotLock,
  SlotSpec,
  BreakpointContextOptions,
  StyleCompileContext,
  StyleOrigin,
  StyleState,
  StyleTraceEntry,
  StyleValue,
  StyleValues,
  TokenRef,
  ValidationIssue,
} from "@nextlyhq/blocks-engine";

/**
 * The container names a preview compile emits its breakpoints against.
 *
 * Re-exported beside {@link BreakpointContextOptions} because a consumer of this
 * package does not depend on the engine directly: without them, the previewing
 * surface would have to hard-code the same reserved identifiers in its own
 * `container-name`, and a name spelled twice is a name that can be spelled
 * differently.
 */
export {
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  /*
   * The FACTORY as well as the constants, because it is the only supplied way
   * off the predictable default.
   *
   * `PREVIEW_VIEWPORT_CONTAINER` is a default rather than a reservation — an
   * ancestor declaring the same name captures the viewport queries — so a
   * surface rendering third-party blocks is meant to mint its own. Under pnpm
   * an application declaring only this package cannot reliably import a
   * transitive dependency, so omitting this left the collision-safe path
   * reachable only by adding `@nextlyhq/blocks-engine` to its manifest or by
   * reimplementing the name validation, and the second is the one people do.
   */
  previewContainerFor,
} from "@nextlyhq/blocks-engine";
export {
  PREVIEW_CONTAINER_STYLE,
  previewContainerStyle,
} from "./preview-container";
