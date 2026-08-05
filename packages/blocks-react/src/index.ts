/**
 * `@nextlyhq/blocks-react` — the React renderer for Nextly block documents.
 *
 * This entry renders documents with React alone. It imports no Next.js, no
 * admin code, and no CMS runtime, so a document can be rendered from a plain
 * React app, a test, or a script with nothing else installed. The Next-coupled
 * helpers live at `@nextlyhq/blocks-react/next`, and `layering.test.ts` turns
 * that separation into a hard failure rather than a convention.
 *
 * The renderer components are added on top of this boundary; what ships here
 * is the boundary itself and the context contract every block renders against.
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
