/**
 * The custom CSS a page's sheet carries: the site's, then the page's, then each
 * block's scoped to that block, after every rule the builder writes, so an
 * author's CSS wins a tie with the builder's own and the levels override in
 * the order a person reads them (the narrower one last).
 *
 * Only what the host's checker accepts is drawn, and nothing at all without a
 * checker: see {@link CustomCssPolicy}. A value refused, by the checker or
 * because a block's CSS cannot be scoped to the block, stays in the document
 * and is left out of the sheet.
 *
 * @module style/compile-page-custom-css
 */
import type { BlockDocument, BlockNode } from "../document";

import type { CustomCssPolicy } from "./compile-page-context";
import { scopeBlockCss } from "./custom-css-scope";

/** What the compile hands over: its nodes as it placed them, and their classes. */
interface CustomCssInput {
  readonly doc: BlockDocument;
  readonly nodes: readonly {
    readonly node: BlockNode;
    readonly gated: boolean;
  }[];
  readonly classes: ReadonlyMap<string, string>;
  readonly duplicateIds: ReadonlySet<string>;
  /** The selector the page's rules are anchored to. */
  readonly pageRoot: string;
  readonly policy: CustomCssPolicy | undefined;
  /**
   * The rules held out of the sheet for gated nodes. A gated block's CSS joins
   * its own entry, so it is drawn exactly when the block is.
   */
  readonly gated: Record<string, string>;
}

/**
 * The custom CSS for the sheet, in the order it is drawn, as one string ("" for
 * none). A gated block's CSS is added to that block's gated entry instead.
 */
export function customCssOf(input: CustomCssInput): string {
  const { policy } = input;
  if (policy === undefined) return "";
  const parts: string[] = [];
  const site = written(policy.site);
  if (site !== undefined && policy.accepts(site, "site")) parts.push(site);
  const page = written(input.doc.settings?.customCss);
  if (page !== undefined && policy.accepts(page, "page")) parts.push(page);
  for (const { node, gated } of input.nodes) {
    const scoped = blockCss(node, input, policy);
    if (scoped === undefined) continue;
    if (gated) {
      const held = input.gated[node.id];
      input.gated[node.id] = held ? `${held}\n${scoped}` : scoped;
      continue;
    }
    parts.push(scoped);
  }
  return parts.join("\n");
}

/** One block's CSS, accepted and scoped to the block, or `undefined`. */
function blockCss(
  node: BlockNode,
  input: CustomCssInput,
  policy: CustomCssPolicy
): string | undefined {
  const css = written(node.customCss);
  if (css === undefined) return undefined;
  // Two nodes sharing an id share a class, so CSS scoped to it would style
  // both; refused, as their styles are.
  if (input.duplicateIds.has(node.id)) return undefined;
  const className = input.classes.get(node.id);
  if (className === undefined || !policy.accepts(css, "block")) {
    return undefined;
  }
  const scoped = scopeBlockCss(css, `${input.pageRoot} .${className}`);
  return scoped.ok ? scoped.css : undefined;
}

/** Stored CSS with something in it, or `undefined`. */
function written(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
