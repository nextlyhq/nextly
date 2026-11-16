/**
 * How each document drawn on one page treats the site sheet and its own
 * styles, when a page is drawn with the regions of its Layout around it.
 *
 * Two surfaces draw that arrangement: the published route (`/next`) and the
 * editor's canvas. Both ask this, so the page and its regions compile the same
 * way wherever they are drawn, and an author sees the cascade a visitor gets.
 *
 * @module page-parts
 */
import type {
  RegionArea,
  SiteSheetInput,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import { pageCompileContext } from "./page-renderer";

/** One document drawn on the page: a region of the Layout, or the page. */
export type PagePart = RegionArea | "page";

/** The site-sheet and compile inputs one part is rendered with. */
export interface PartSheet {
  readonly siteStyles?: SiteSheetInput | false;
  readonly styleContext?: StyleCompileContext;
}

/**
 * The scope the page compiles under when its stored sheet names none.
 *
 * Node ids are unique within a document, not across documents, so the page and
 * a region can hold the same id and with it the same generated class; and a
 * page-level rule is anchored at every page root. Unscoped, one document's
 * sheet would restyle the other. A distinct scope per part is the compiler's
 * own mechanism for this (`StyleCompileContext.scope`): every selector it
 * writes is constrained to the root carrying that class, and the renderer puts
 * the class on the root it mounts.
 */
const PART_SCOPE_PAGE = "nx-pb-part-page";

/** The scope one part compiles under. */
function partScope(part: PagePart, pageScope: string | undefined): string {
  if (part === "page") return pageScope ?? PART_SCOPE_PAGE;
  return `nx-pb-part-${part}`;
}

/**
 * The inputs each part is rendered with, in drawing order.
 *
 * The site sheet is emitted ONCE, by whichever part is drawn first. Every
 * document's own rules are anchored at one specificity and settled by source
 * order, so the site sheet (block defaults, named classes) has to come before
 * all of them: emitted by the page with a header above it, the block defaults
 * would land AFTER the header's own rules and beat them. The other parts are
 * rendered with `siteStyles: false` and the page compile context that sheet
 * implies, so their own rules compile exactly as they would beside it.
 *
 * `siteStyles` undefined means no breakpoints are known, so there is no site
 * sheet to place and no compile for a region: every part keeps what it would
 * have had alone. `false` is a host declining the sheet, which every part
 * keeps declining.
 *
 * `pageScope` is the scope the page's stored sheet was compiled under, kept so
 * a stored artifact still matches; a page compiled unscoped gets a scope of
 * its own here, and is recompiled for it.
 */
export function layoutPartSheets(args: {
  parts: readonly PagePart[];
  styleContext: StyleCompileContext | undefined;
  siteStyles: SiteSheetInput | false | undefined;
  pageScope?: string | undefined;
}): PartSheet[] {
  const { parts, styleContext, siteStyles, pageScope } = args;
  const emitting: PartSheet = siteStyles === undefined ? {} : { siteStyles };
  // The compile context the site's styles imply, which the renderer would
  // build for a route that states none of its own. Every part compiles under
  // it, the emitting one included, so that one is scoped too.
  const implied =
    siteStyles === undefined || siteStyles === false
      ? styleContext
      : pageCompileContext(styleContext, siteStyles);
  const inheriting: PartSheet =
    siteStyles === undefined || siteStyles === false
      ? emitting
      : { siteStyles: false, ...optionalStyleContext(implied) };
  return parts.map((part, index) =>
    scoped(
      index === 0 ? emitting : inheriting,
      implied,
      partScope(part, pageScope)
    )
  );
}

/**
 * `sheet` with `scope` set on its compile context, falling back to the
 * context the route's inputs imply for the part that emits the site sheet. A
 * part with no compile context at all compiles nothing, so there is nothing
 * to scope.
 */
function scoped(
  sheet: PartSheet,
  impliedContext: StyleCompileContext | undefined,
  scope: string
): PartSheet {
  const context = sheet.styleContext ?? impliedContext;
  return context === undefined
    ? sheet
    : { ...sheet, styleContext: { ...context, scope } };
}

function optionalStyleContext(
  context: StyleCompileContext | undefined
): PartSheet {
  return context === undefined ? {} : { styleContext: context };
}
