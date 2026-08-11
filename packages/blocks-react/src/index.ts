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

export { BlockBoundary, BlockList } from "./block-boundary";
export type { BlockBoundaryProps, BlockListProps } from "./block-boundary";

export { BlockPlaceholder } from "./placeholder";
export type { BlockPlaceholderProps, PlaceholderReason } from "./placeholder";

export {
  createBlockResolver,
  migrationSourceFor,
  registeredBlocks,
} from "./resolver";
export type { BlockResolver } from "./resolver";

export {
  // Public because the WRITE path needs it. A stored stylesheet records which
  // host-fetch policy compiled it, and a reader refuses a sheet whose stamp is
  // not the policy now in force. A writer that could not compute the same label
  // would stamp nothing, every stored sheet would read as stale, and a site
  // with a policy would recompile its CSS on every render for ever.
  fetchPolicyLabel,
  resolvePageStyles,
  styleTextForInjection,
  toPageStyles,
} from "./styles";
export type { PageStyles, ResolveStyleOptions } from "./styles";

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
 */
export { pruneHiddenNodes } from "./visibility";
export { prepareDocumentForRead } from "./prepare-document";
export type { PrepareDocumentArgs } from "./prepare-document";

/**
 * The engine types this package's own options are written in terms of.
 *
 * **A package that names a type in its public API owes that type to its
 * callers.** These originate in `@nextlyhq/blocks-engine`, which is a
 * DEPENDENCY of this package rather than a peer — so a host installing
 * `@nextlyhq/blocks-react` does not have it as a direct dependency and cannot
 * import from it. Before this, `StyleCompileContext`, `BlockDocument` and
 * `DocumentLimits` appeared in the built `.d.ts` in parameter positions while
 * naming none of them in an export statement: a host could SEE the name it was
 * required to pass and had no way to write it down.
 *
 * `nextly`'s own types are deliberately NOT re-exported here. `nextly` is a
 * PEER dependency, so a host has installed it directly and should name
 * `ContentEntry`, `RenderContext` and the route shapes from `nextly/runtime`
 * where they live. Two import paths for one type is a worse cost than one
 * import a host already has the package for.
 */
export type {
  AnyBlockDefinition,
  Binding,
  BlockDefinition,
  BlockDocument,
  BlockNode,
  BreakpointDef,
  BreakpointId,
  BreakpointSet,
  CompiledPageCss,
  Condition,
  DocumentKind,
  DocumentLimits,
  NodeStyles,
  MigrationSource,
  NodeVisibility,
  RemotePatternInput,
  StyleCompileContext,
  StyleState,
} from "@nextlyhq/blocks-engine";
