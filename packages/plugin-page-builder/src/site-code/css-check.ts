/**
 * The one checker for custom CSS, at all three levels: the whole site, one
 * page and one block.
 *
 * It holds CSS to what the site code check holds a stylesheet to, and further:
 * a CSS box has no reason to fetch from another site at all, so every
 * `url(…)` must be a path on this site, and `@import` is refused outright.
 * Anything that could end the style element, or run script in a browser that
 * still honours it, is refused. A block's CSS must also start every rule from
 * `selector`, which the compile scopes to the block.
 *
 * The same function runs in the browser, for the CSS boxes' early feedback,
 * and on the server, which is the authority on every write, so the two cannot
 * disagree. It loads css-tree's parser and walker entries only, which carry no
 * Node built-in, for that reason.
 *
 * Each refusal names the line it is on, and nothing is ever stripped: CSS the
 * checker refuses is not saved, and a stored value it refuses is kept and not
 * drawn.
 *
 * @module site-code/css-check
 */
import {
  scopeBlockCss,
  type CustomCssLevel,
  type CustomCssPolicy,
} from "@nextlyhq/blocks-engine";
import type { CssNode, WalkContext } from "css-tree";
import parse from "css-tree/parser";
import walk from "css-tree/walker";

import { cssFetches } from "./css-urls";
import { SITE_CODE_LIMITS } from "./limits";
import { siteCodeUrlProblem, STYLE_ELEMENT_END } from "./url-rule";

/**
 * Which checker this is, for a stored sheet's stamp. Change it whenever what
 * the checker accepts changes, so sheets compiled under the old rules are
 * compiled again.
 */
export const CUSTOM_CSS_CHECKER_ID = "custom-css-check-1";

/** One line of custom CSS that cannot be used, and why. */
export interface CustomCssProblem {
  /** The line it is on, from 1. */
  readonly line: number;
  /** Why, as a sentence the author can act on. */
  readonly reason: string;
}

/** Properties a browser has run script from. */
const SCRIPT_PROPERTIES = new Set(["behavior", "-moz-binding"]);

/** Everything the checker refuses in this CSS, in line order; none if it may be used. */
export function checkCustomCss(
  css: string,
  level: CustomCssLevel
): CustomCssProblem[] {
  if (css.length > SITE_CODE_LIMITS.slotChars) {
    return [
      {
        line: 1,
        reason: `This CSS is longer than ${SITE_CODE_LIMITS.slotChars} characters.`,
      },
    ];
  }
  const problems = new Problems();
  textProblems(css, problems);
  parsedProblems(css, problems);
  fetchProblems(css, problems);
  if (level === "block") {
    // A placeholder selector: only whether each rule CAN be scoped is asked.
    const scoped = scopeBlockCss(css, ".block");
    if (!scoped.ok) {
      // Only for lines nothing else refused: an `@import` is refused as an
      // import, not a second time as an at-rule a block cannot scope.
      for (const refusal of scoped.refusals) {
        if (!problems.hasLine(refusal.line)) {
          problems.add(refusal.line, refusal.reason);
        }
      }
    }
  }
  return problems.inOrder();
}

/** A problem as the CSS boxes show it: "Line 3: @import isn't allowed." */
export function customCssProblemText(problem: CustomCssProblem): string {
  return `Line ${problem.line}: ${problem.reason}`;
}

/**
 * The checker as a renderer's policy: the page's sheet draws only the custom
 * CSS this accepts, and the site's own, which it is handed here.
 */
export function customCssPolicy(site: string | undefined): CustomCssPolicy {
  return {
    id: CUSTOM_CSS_CHECKER_ID,
    accepts: (css, level) => checkCustomCss(css, level).length === 0,
    ...(site === undefined ? {} : { site }),
  };
}

/** Problems, one per line and reason. */
class Problems {
  readonly #seen = new Set<string>();
  readonly #list: CustomCssProblem[] = [];

  add(line: number, reason: string): void {
    const key = `${String(line)}\n${reason}`;
    if (this.#seen.has(key)) return;
    this.#seen.add(key);
    this.#list.push({ line, reason });
  }

  hasLine(line: number): boolean {
    return this.#list.some(problem => problem.line === line);
  }

  inOrder(): CustomCssProblem[] {
    return [...this.#list].sort((a, b) => a.line - b.line);
  }
}

/** The line an offset into the text is on, from 1. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * What is refused by its text, wherever it is, comments included: the parser
 * does not see inside a comment, and the HTML parser that ends a style element
 * does.
 */
function textProblems(css: string, problems: Problems): void {
  const wrapper = /<\s*style[\s>]/i.exec(css);
  if (wrapper !== null) {
    problems.add(
      lineAt(css, wrapper.index),
      "Paste the CSS without the <style> tags."
    );
  }
  const end = STYLE_ELEMENT_END.exec(css);
  if (end !== null && wrapper === null) {
    problems.add(
      lineAt(css, end.index),
      "</style isn't allowed: it would end the styles early."
    );
  }
  const expression = /expression\s*\(/i.exec(css);
  if (expression !== null) {
    problems.add(
      lineAt(css, expression.index),
      "expression() isn't allowed: it can run script."
    );
  }
}

/** What is refused by what the CSS says: imports, fetches, script properties. */
function parsedProblems(css: string, problems: Problems): void {
  const ast = parse(css, {
    positions: true,
    parseAtrulePrelude: false,
    onParseError: error =>
      problems.add(lineOf(error), "This CSS can't be read."),
  });
  walk(ast, {
    enter(this: WalkContext, node: CssNode) {
      const line = node.loc?.start.line ?? 1;
      if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
        problems.add(line, "@import isn't allowed.");
        return;
      }
      if (
        node.type === "Declaration" &&
        SCRIPT_PROPERTIES.has(node.property.toLowerCase())
      ) {
        problems.add(
          line,
          `${node.property.toLowerCase()} isn't allowed: it can run script.`
        );
        return;
      }
    },
  });
}

/**
 * Every fetch the CSS makes, read as site code reads a stylesheet's: a
 * `url()`, an `image-set()` string and one kept in a custom property's text
 * alike. An `@import` is refused as an import, above.
 */
function fetchProblems(css: string, problems: Problems): void {
  for (const fetch of cssFetches(css)) {
    if (fetch.via === "import") continue;
    const problem = fetchProblem(fetch.url);
    if (problem === undefined) continue;
    const at = css.indexOf(fetch.url);
    problems.add(at === -1 ? 1 : lineAt(css, at), problem);
  }
}

/**
 * Why a `url(…)` may not be used: it must be a path on this site. The site code
 * rule is asked first, so its reading of what a browser ignores in a URL is
 * the one used here; an `https:` address it would allow is still another
 * site's.
 */
function fetchProblem(url: string): string | undefined {
  const problem = siteCodeUrlProblem(url);
  const own = problem === undefined && url.trim().startsWith("/");
  return own
    ? undefined
    : `Only pictures and fonts from this site can be used: "${url}" isn't a path on this site.`;
}

/** The line a parse error is on; css-tree reports it, its types do not. */
function lineOf(error: unknown): number {
  const line = (error as { line?: unknown }).line;
  return typeof line === "number" && line > 0 ? line : 1;
}
