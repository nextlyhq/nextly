/**
 * "./render" entry — server-first renderer. Import-safe: no "use client" (except the
 * isolated ErrorBoundary island), no browser globals, NO getNextly (the host injects a
 * dataProvider). Built-in block renderers are registered as a side effect in M3.2.
 */
import "./blocks"; // side-effect: register the 7 built-in blocks into defaultBlockRegistry

export { PageRenderer } from "./PageRenderer";
export type { PageRendererProps } from "./PageRenderer";
export { RenderNode } from "./RenderNode";
export type { RenderNodeProps } from "./RenderNode";
export { BlockErrorBoundary } from "./ErrorBoundary";
export type { DataProvider, FindArgs, ResolvedMedia } from "./dataProvider";
export * from "./blocks";

/**
 * The origin policy, for a block registered from outside this package.
 *
 * A block's `render` receives `remotePatterns` and is responsible for putting
 * its own media through this: the renderer cannot inspect the React element a
 * block returns, so a custom block that writes an author-controlled URL into an
 * `src` or an inline background reaches whatever host it names unless it asks.
 *
 * `mediaUrl` for an attribute, `cssMediaUrl` for a value interpolated into a
 * CSS `url("…")` — the second also refuses the delimiters that would end the
 * declaration it sits in.
 */
export { mediaUrl, cssMediaUrl } from "./blocks/util";
