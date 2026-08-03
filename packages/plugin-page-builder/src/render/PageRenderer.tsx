/**
 * Server-first page renderer (spec §10). Import-safe: NO `getNextly`, no browser
 * globals. Emits one scoped `<style>` block (node styles + sanitized custom CSS) and
 * renders the block tree. The host injects a `dataProvider`; the default registry holds
 * the built-in blocks (populated by importing `./blocks`).
 */
import type { ReactNode } from "react";

import { sanitizeCustomCss } from "../core/css-sanitize";
import { defaultBlockRegistry, type BlockRegistry } from "../core/registry";
import {
  compileDocumentBlockCss,
  compileDocumentCss,
  compileDocumentMotionCss,
  compileTokensCss,
  type BreakpointDef,
  type RemotePattern,
} from "../core/style-compiler";
import type { BlockDocument, BlockNode } from "../core/types";

import type { DataProvider } from "./dataProvider";
import { DEFAULT_QUERY_BUDGET } from "./query/types";
import { RenderNode } from "./RenderNode";

const PAGE_ROOT_CLASS = "nx-pb-page";

export interface PageRendererProps {
  document: BlockDocument;
  registry?: BlockRegistry;
  dataProvider?: DataProvider;
  customCss?: string;
  breakpoints?: BreakpointDef[];
  /**
   * Hosts this page may load block images from, in the shape of Next.js's
   * `images.remotePatterns` so an entry can be copied across from
   * `next.config`. Absent means same-origin only: a remote image is a request,
   * and custom CSS in the same stylesheet can make that request conditional on
   * a selector, so an undeclared host is a way out rather than a broken image.
   */
  remotePatterns?: readonly RemotePattern[];
  /** Design-token overrides (`{ "color.primary": "#..." }`). Defaults ship a palette. */
  tokens?: Record<string, string>;
  /** Reserved (i18n, spec §13) — threaded through but ignored in the MVP. */
  locale?: string;
  /** Reusable-block library: refId → stored subtree, resolved by `core/ref` nodes. */
  refs?: Record<string, BlockNode>;
}

export function PageRenderer({
  document,
  registry = defaultBlockRegistry,
  dataProvider,
  customCss,
  breakpoints,
  remotePatterns,
  tokens,
  refs,
}: PageRendererProps): ReactNode {
  if (!document?.root) return null;

  const css = [
    compileTokensCss(PAGE_ROOT_CLASS, tokens),
    compileDocumentMotionCss(document),
    compileDocumentCss(document, { breakpoints, remotePatterns }),
    compileDocumentBlockCss(document),
    // `.css` alone: the sanitizer also returns what it removed, and this path
    // renders rather than edits, so there is nowhere to show a warning. The
    // editor reads the same result and displays them.
    sanitizeCustomCss(customCss ?? "", PAGE_ROOT_CLASS).css,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className={PAGE_ROOT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <RenderNode
        node={document.root}
        registry={registry}
        dataProvider={dataProvider}
        budget={{ n: DEFAULT_QUERY_BUDGET }}
        refs={refs}
      />
    </div>
  );
}
