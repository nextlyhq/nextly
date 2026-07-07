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
