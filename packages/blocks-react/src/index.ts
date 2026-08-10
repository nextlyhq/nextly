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
  resolvePageStyles,
  styleTextForInjection,
  toPageStyles,
} from "./styles";
export type { PageStyles } from "./styles";

/**
 * Exported because `resolvePageStyles` has a precondition a caller could not otherwise meet.
 *
 * That helper expects the document it is handed to be the one that will RENDER — condition-gated
 * nodes already removed. Called with a raw document it emits rules for nodes a reader withholds,
 * publishing the colours, fonts and `url(...)` of a block nobody was served. `PageRenderer` runs
 * this pass itself, so the ordinary path is safe; a consumer assembling styles directly had the
 * unsafe path available and no safe one.
 */
export { pruneHiddenNodes } from "./visibility";
