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
  compileDocumentCss,
  compileTokensCss,
  type BreakpointDef,
} from "../core/style-compiler";
import type { BlockDocument } from "../core/types";

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
  /** Design-token overrides (`{ "color.primary": "#..." }`). Defaults ship a palette. */
  tokens?: Record<string, string>;
  /** Reserved (i18n, spec §13) — threaded through but ignored in the MVP. */
  locale?: string;
}

export function PageRenderer({
  document,
  registry = defaultBlockRegistry,
  dataProvider,
  customCss,
  breakpoints,
  tokens,
}: PageRendererProps): ReactNode {
  if (!document?.root) return null;

  const css =
    compileTokensCss(PAGE_ROOT_CLASS, tokens) +
    "\n" +
    compileDocumentCss(document, { breakpoints }) +
    "\n" +
    sanitizeCustomCss(customCss ?? "", PAGE_ROOT_CLASS);

  return (
    <div className={PAGE_ROOT_CLASS}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <RenderNode
        node={document.root}
        registry={registry}
        dataProvider={dataProvider}
        budget={{ n: DEFAULT_QUERY_BUDGET }}
      />
    </div>
  );
}
