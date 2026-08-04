import {
  compilePageCss,
  nodeClassNames,
  walkNodes,
  type BlockDocument,
  type CompiledPageCss,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

/**
 * A page's compiled stylesheet and the class each node was assigned.
 *
 * Both halves travel together because neither is usable alone: the CSS is
 * written against exactly these classes, and a renderer that kept the sheet but
 * recomputed the classes could hand a node a class no rule targets.
 *
 * `classes` is a plain object rather than the compiler's `Map` on purpose. This
 * artifact is stored next to the document and handed across the server/client
 * boundary as a prop, and a `Map` survives neither: `JSON.stringify` turns it
 * into `{}`, silently, so a page would come back styled by an empty sheet.
 */
export interface PageStyles {
  css: string;
  /** Node id to generated class name. */
  classes: Record<string, string>;
  /**
   * The scope class the selectors were anchored under, when there was one.
   *
   * Recorded here rather than asked of the caller separately, because a scope
   * that lives in two places is a scope that can disagree with itself: the
   * stylesheet's selectors already encode it, so a renderer told a different
   * one puts a class on the root that no rule mentions and the whole sheet
   * silently matches nothing. Travelling with the CSS makes that unstateable.
   */
  scope?: string;
}

/** The compiler's output in the storable shape. */
export function toPageStyles(
  compiled: CompiledPageCss,
  scope?: string
): PageStyles {
  const styles: PageStyles = {
    css: compiled.css,
    classes: Object.fromEntries(compiled.classes),
  };
  return scope === undefined ? styles : { ...styles, scope };
}

/** Every node id in a document, in document order. */
function documentNodeIds(document: BlockDocument): string[] {
  const ids: string[] = [];
  walkNodes(document.nodes, node => {
    ids.push(node.id);
  });
  return ids;
}

/**
 * The styles a render should use, from whichever of the three inputs it has.
 *
 * Ordered by how much each can be trusted:
 *
 * 1. A stored artifact. Compilation happens at write time, so what ships is
 *    what was compiled against the document as saved. Recompiling per request
 *    is the missing-CSS bug class page builders are known for, and it costs the
 *    compile on every render of an unchanged page.
 * 2. A compile context, for a consumer with no write path — the standalone
 *    case. The compiler is deterministic and needs no runtime, so this produces
 *    the same bytes the CMS would have stored.
 * 3. Neither, which still has to work. A document renders without styles, but
 *    it cannot render without CLASSES: every block is handed one and puts it on
 *    its root element. They come from the same helper the compiler uses, so the
 *    collision handling that makes two ids hashing alike distinguishable is the
 *    same in all three paths rather than reinvented in the cheapest one.
 */
export function resolvePageStyles(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined
): PageStyles {
  if (styles) return styles;
  if (styleContext) {
    return toPageStyles(
      compilePageCss(document, styleContext),
      styleContext.scope
    );
  }
  return {
    css: "",
    classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
  };
}

/**
 * CSS made safe to place inside a `<style>` element.
 *
 * A stylesheet has to be injected unescaped or every `>` in a selector breaks,
 * which means the one sequence that can end the element early has to be
 * neutralised here. `</style` inside the text closes the element in the HTML
 * parser regardless of CSS syntax, and everything after it becomes markup — the
 * shortest path from author-supplied custom CSS to script execution.
 *
 * Escaping the slash keeps the CSS meaning identical (a backslash escape is
 * valid inside a CSS string or comment, and the sequence is not valid CSS
 * anywhere else) while leaving the parser nothing to match.
 */
export function styleTextForInjection(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}
