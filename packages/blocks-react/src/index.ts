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
  BlocksDataProvider,
  BlocksQuery,
  BlocksResult,
  PageContext,
  ResolvedMedia,
} from "./context";
export { createStandaloneContext, emptyDataProvider } from "./context";

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
