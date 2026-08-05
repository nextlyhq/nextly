import {
  compilePageCss,
  nodeClassNames,
  walkNodes,
  type BlockDocument,
  type CompiledPageCss,
  type NodeStyles,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";

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

/**
 * The shared default styles for every block type the document uses.
 *
 * The compiler emits one rule per block TYPE rather than copying a type's
 * defaults into every node, and it takes those defaults from the compile
 * context. A caller compiling at render time already handed this renderer the
 * resolver holding the definitions, so requiring them to mirror `baseStyles`
 * into the context as well is a coupling that is easy to miss and silent when
 * missed: the renderer still writes the block-type class and the sheet simply
 * has no rule for it, so every block loses its defaults and nothing says why.
 *
 * A context that already carries `blockBases` is left alone — an explicit
 * choice by the caller outranks what can be derived here.
 */
function blockBasesFor(
  document: BlockDocument,
  blocks: BlockResolver
): Record<string, NodeStyles> {
  const bases: Record<string, NodeStyles> = {};
  walkNodes(document.nodes, node => {
    if (bases[node.type] !== undefined) return;
    const baseStyles = blocks.get(node.type)?.baseStyles;
    if (baseStyles !== undefined) bases[node.type] = baseStyles;
  });
  return bases;
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
/**
 * A stored artifact made safe to render against.
 *
 * The artifact is a database record, so it can predate the current shape or
 * have been written by an older version, and neither half can be taken on
 * trust. A missing `classes` map is the dangerous one: the class lookup happens
 * while assembling a block's arguments, BEFORE the try/catch around its render,
 * so one bad stylesheet row would throw in the page component where no block
 * boundary can contain it.
 *
 * Repairs rather than refuses. Classes are recomputed from the document by the
 * same helper the compiler uses, so a document with a broken artifact renders
 * unstyled instead of not at all — and the CSS is dropped with them, since a
 * stylesheet written against classes nobody now carries would match nothing.
 */
function normalizeStoredStyles(
  styles: PageStyles,
  document: BlockDocument
): PageStyles {
  const classesUsable =
    typeof styles.classes === "object" &&
    styles.classes !== null &&
    !Array.isArray(styles.classes);
  if (classesUsable) {
    return typeof styles.css === "string" ? styles : { ...styles, css: "" };
  }
  return {
    css: "",
    classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
    ...(styles.scope === undefined ? {} : { scope: styles.scope }),
  };
}

export function resolvePageStyles(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined,
  blocks: BlockResolver,
  /**
   * Whether condition-gated nodes were removed from `document` before this ran.
   *
   * It changes what a STORED artifact may be trusted for. The artifact is
   * compiled at write time from the whole document, and conditions are decided
   * at read time, so a sheet saved before any gating knows nothing about it:
   * the gated node's markup is withheld while the rules compiled for it — and
   * any URL inside them — are still published.
   *
   * Recompiling is the right answer whenever the inputs to do so are present.
   * When they are not, the sheet is withheld: the format says a hidden node is
   * omitted from server output, and an unstyled page keeps that promise while a
   * styled one breaks it. Classes are kept either way, so blocks still carry
   * the names the rest of the system expects.
   *
   * The complete fix is not available from this package: it needs the artifact
   * to carry its rules per node so a reader can drop the ones it prunes,
   * which is a change to what the compiler emits.
   */
  prunedGatedNodes = false
): PageStyles {
  if (styles && !prunedGatedNodes)
    return normalizeStoredStyles(styles, document);
  if (styles && styleContext === undefined) {
    return { ...normalizeStoredStyles(styles, document), css: "" };
  }
  if (styleContext) {
    const context: StyleCompileContext =
      styleContext.blockBases === undefined
        ? { ...styleContext, blockBases: blockBasesFor(document, blocks) }
        : styleContext;
    return toPageStyles(compilePageCss(document, context), context.scope);
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
