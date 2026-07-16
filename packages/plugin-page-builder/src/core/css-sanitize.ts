/**
 * Parser-backed page-level custom-CSS sanitizer + scoper (spec §8/§14). React-free.
 *
 * Fails closed: on a fatal parse error returns "". Strips raw markup, drops dangerous
 * at-rules (@import and anything but @media/@supports) and declarations
 * (javascript:/vbscript:/data:/expression()), then prefixes every selector with the
 * page scope class so custom CSS cannot leak onto the host site.
 */
import * as csstree from "css-tree";
import type { CssNode, List, ListItem } from "css-tree";

function isDangerousValue(val: string): boolean {
  const v = val.toLowerCase();
  return (
    v.includes("javascript:") ||
    v.includes("vbscript:") ||
    /expression\s*\(/.test(v) ||
    /url\(\s*['"]?\s*data:/.test(v)
  );
}

export function sanitizeCustomCss(css: string, scopeClass: string): string {
  if (!css) return "";

  // Defensively strip any raw <style>/<script> tags before parsing.
  const cleaned = css.replace(/<\/?(style|script)[^>]*>/gi, "");

  let ast: CssNode;
  try {
    ast = csstree.parse(cleaned);
  } catch {
    return "";
  }

  // Drop dangerous at-rules (keep only @media / @supports).
  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      const name = (node as csstree.Atrule).name.toLowerCase();
      if (name !== "media" && name !== "supports") list.remove(item);
    },
  });

  // Drop declarations with dangerous values.
  csstree.walk(ast, {
    visit: "Declaration",
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      const decl = node as csstree.Declaration;
      const value = csstree.generate(decl.value);
      if (isDangerousValue(value) && list && item) list.remove(item);
    },
  });

  // Scope every selector under the page root class.
  csstree.walk(ast, {
    visit: "Selector",
    enter(node: CssNode) {
      const sel = node as csstree.Selector;
      const first = sel.children.first;
      const alreadyScoped =
        first != null &&
        first.type === "ClassSelector" &&
        first.name === scopeClass;
      if (alreadyScoped) return;
      sel.children.prependData({ type: "Combinator", name: " " });
      sel.children.prependData({ type: "ClassSelector", name: scopeClass });
    },
  });

  return csstree.generate(ast);
}

/**
 * Per-block custom CSS (spec §4.4). Authors write CSS using the Elementor-style
 * `selector` keyword to mean "this block's root". We replace `selector` with the
 * block's scope class, then run every other selector through the same scoping +
 * declaration sanitize as page CSS so nothing can escape the block.
 */
export function sanitizeBlockCss(css: string, scopeClass: string): string {
  if (!css) return "";
  // Replace the `selector` keyword (word-boundary, not part of .foo-selector).
  const withScope = css.replace(/(^|[^\w.#-])selector\b/g, `$1.${scopeClass}`);
  return sanitizeCustomCss(withScope, scopeClass);
}
