/**
 * Server-first page renderer (spec §10). Import-safe: NO `getNextly`, no browser
 * globals. Emits one scoped `<style>` block (node styles + sanitized custom CSS) and
 * renders the block tree. The host injects a `dataProvider`; the default registry holds
 * the built-in blocks (populated by importing `./blocks`).
 */
import { PAGE_ROOT_CLASS } from "@nextlyhq/blocks-engine";
import type { ReactNode } from "react";

import { sanitizeCustomCss } from "../core/css-sanitize";
import { pruneUndeclaredSlots } from "../core/declared-slots";
import { defaultBlockRegistry, type BlockRegistry } from "../core/registry";
import {
  compileDocumentStyles,
  compileDocumentMotionCss,
  compileTokensCss,
  documentNodeClasses,
  documentScopeClass,
  type BreakpointDef,
  type RemotePatternInput,
} from "../core/style-compiler";
import type { BlockDocument, BlockNode } from "../core/types";

import type { DataProvider } from "./dataProvider";
import { DEFAULT_QUERY_BUDGET } from "./query/types";
import { RenderNode } from "./RenderNode";

export interface PageRendererProps {
  document: BlockDocument;
  registry?: BlockRegistry;
  dataProvider?: DataProvider;
  customCss?: string;
  breakpoints?: BreakpointDef[];
  /**
   * Hosts this page may load block images from, in the shape of Next.js's
   * `images.remotePatterns` so an entry can be copied across from
   * `next.config`. Absent means relative paths only: a remote image is a
   * request, and custom CSS in the same stylesheet can make that request
   * conditional on a selector, so an undeclared host is a way out rather than a
   * broken image.
   *
   * An absolute URL naming THIS site's own host needs an entry too. Nothing
   * here knows what this site's host is — the page is compiled once and may be
   * served from anywhere — and `next/image` draws the line in the same place.
   */
  remotePatterns?: readonly RemotePatternInput[];
  /** Design-token overrides (`{ "color.primary": "#..." }`). Defaults ship a palette. */
  tokens?: Record<string, string>;
  /** Reserved (i18n, spec §13) — threaded through but ignored in the MVP. */
  locale?: string;
  /** Reusable-block library: refId → stored subtree, resolved by `core/ref` nodes. */
  refs?: Record<string, BlockNode>;
}

export function PageRenderer({
  document: stored,
  registry = defaultBlockRegistry,
  dataProvider,
  customCss,
  breakpoints,
  remotePatterns,
  tokens,
  refs: storedRefs,
}: PageRendererProps): ReactNode {
  if (!stored?.root) return null;

  // Held to the slots each definition declares, ONCE, before anything reads the tree. A stored
  // document can carry children under a slot name a block update renamed or removed, and both the
  // compiler and the renderer walked every STORED slot — so those children's rules, asset URLs
  // included, were compiled into the sheet for markup nobody receives. Pruning here rather than in
  // each walk is deliberate: `walk` has thirty call sites and no registry, and a rule enforced in
  // thirty places is one that is eventually missed in one.
  //
  // The reusable library is pruned too. A library block is rendered by the same code and can hold
  // a stale slot for the same reason.
  const document = {
    ...stored,
    root: pruneUndeclaredSlots(stored.root, registry),
  };
  // A falsy library entry is left exactly as it is rather than pruned as a node. The library can be
  // rebuilt from stored data, and every path downstream already tolerates one — `pageStyleKeys` and
  // `compileDocumentMotionCss` skip it, `RenderNode` treats it as a missing ref and draws the
  // placeholder. Dereferencing it here would take down the whole page before that placeholder gets
  // the chance.
  const refs = storedRefs
    ? Object.fromEntries(
        Object.entries(storedRefs).map(([id, target]) => [
          id,
          target ? pruneUndeclaredSlots(target, registry) : target,
        ])
      )
    : storedRefs;

  // Everything two documents on one page must not share is anchored to a class
  // of this document's own: its token values, and the custom CSS whose
  // selectors and `@keyframes`/`@font-face` names would otherwise resolve
  // across the boundary. `nx-pb-page` stays on the element beside it, because
  // it is what a host styles page-builder content with and is meant to match
  // every document.
  const scope = documentScopeClass(document);
  // One map for the whole render: the stylesheet below and the markup beneath
  // it must name each node identically, and a hash collision is only visible —
  // and only resolvable the same way twice — from the whole id set at once.
  // The library is part of the name set, not an extra pass over it. A reusable block's nodes are
  // named from the ref they belong to, and the disambiguating suffix depends on every name at
  // once, so the document and the library have to be handed to this together or the two halves
  // can each be told a colliding key was unique.
  const classes = documentNodeClasses(document, refs);
  const css = [
    compileTokensCss(scope, tokens),
    compileDocumentMotionCss(document, refs),
    // Both style tiers together, not one after the other: they are emitted at the same specificity,
    // so concatenating the tiers would let a reusable block's custom CSS beat the typed controls of
    // a single placement of it.
    compileDocumentStyles(document, {
      breakpoints,
      remotePatterns,
      scope,
      classes,
      refs,
    }),
    // `.css` alone: the sanitizer also returns what it removed, and this path
    // renders rather than edits, so there is nowhere to show a warning. The
    // editor reads the same result and displays them.
    sanitizeCustomCss(customCss ?? "", scope).css,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={
        scope === PAGE_ROOT_CLASS
          ? PAGE_ROOT_CLASS
          : `${PAGE_ROOT_CLASS} ${scope}`
      }
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <RenderNode
        node={document.root}
        remotePatterns={remotePatterns}
        registry={registry}
        dataProvider={dataProvider}
        budget={{ n: DEFAULT_QUERY_BUDGET }}
        refs={refs}
        classes={classes}
      />
    </div>
  );
}
