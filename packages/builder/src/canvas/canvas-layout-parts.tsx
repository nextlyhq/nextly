"use client";

/**
 * The regions of the page's Layout around the page: which parts are drawn,
 * in what order, each with how it treats the site sheet, and the header and
 * footer drawn around the page.
 *
 * @module canvas-layout-parts
 */

import {
  layoutPartSheets,
  type PagePart,
  type PageRendererProps,
  type PartSheet,
} from "@nextlyhq/blocks-react";
import {
  BlockEnvironmentProvider,
  type BlockEnvironment,
} from "@nextlyhq/blocks-react/environment";
import { useMemo } from "react";

import { CanvasRegionFrame, type CanvasRegion } from "./canvas-regions";

/** A region of the page's Layout, with how it treats the site sheet. */
interface DrawnRegion {
  region: CanvasRegion;
  sheet: PartSheet;
}

/** The page and the regions drawn around it, each with its sheet inputs. */
export interface LayoutParts {
  page: PartSheet;
  header: DrawnRegion | undefined;
  footer: DrawnRegion | undefined;
}

/**
 * The page and the regions around it, each with its site-sheet inputs.
 *
 * Asked of `layoutPartSheets`, the answer the published route uses, so the
 * first part drawn emits the site sheet and each part compiles under its own
 * scope. `undefined` when there is no region to draw.
 */
export function useLayoutParts(
  regions: readonly CanvasRegion[] | undefined,
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  sheet: NonNullable<PageRendererProps["siteStyles"]>
): LayoutParts | undefined {
  return useMemo(
    () => layoutPartsOf(regions, rendered, sheet),
    [regions, rendered, sheet]
  );
}

/** {@link useLayoutParts}'s answer, computed. */
function layoutPartsOf(
  regions: readonly CanvasRegion[] | undefined,
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  sheet: NonNullable<PageRendererProps["siteStyles"]>
): LayoutParts | undefined {
  const header = regions?.find(region => region.area === "header");
  const footer = regions?.find(region => region.area === "footer");
  if (header === undefined && footer === undefined) return undefined;
  const parts = drawingOrder(header !== undefined, footer !== undefined);
  const sheets = layoutPartSheets({
    parts,
    styleContext: rendered?.styleContext,
    siteStyles: sheet,
    pageScope: pageScopeOf(rendered),
  });
  const sheetFor = (part: PagePart): PartSheet =>
    sheets[parts.indexOf(part)] ?? {};
  return {
    page: sheetFor("page"),
    header: drawnRegion(header, sheetFor),
    footer: drawnRegion(footer, sheetFor),
  };
}

/** The parts in the order they are drawn: header, page, footer. */
function drawingOrder(hasHeader: boolean, hasFooter: boolean): PagePart[] {
  return [
    ...(hasHeader ? (["header"] as const) : []),
    "page",
    ...(hasFooter ? (["footer"] as const) : []),
  ];
}

/** The scope the page's own styles compile under, when it states one. */
function pageScopeOf(
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined
): string | undefined {
  const scope = rendered?.styles?.scope;
  return typeof scope === "string" ? scope : undefined;
}

/** One region with its sheet inputs, or nothing for a region not drawn. */
function drawnRegion(
  region: CanvasRegion | undefined,
  sheetFor: (part: PagePart) => PartSheet
): DrawnRegion | undefined {
  return region === undefined
    ? undefined
    : { region, sheet: sheetFor(region.area) };
}

/**
 * The page between its Layout's header and footer, as the canvas draws them.
 *
 * Each region is drawn in the page's environment, so a header block that
 * measures itself or listens is told the frame the canvas draws in, as the
 * page is. Without regions it is the page alone, exactly as before.
 */
export function RegionsAround({
  drawn,
  rendered,
  environment,
  selection,
  children,
}: {
  drawn: LayoutParts | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  environment: BlockEnvironment | undefined;
  /** The canvas's selection: a region's open tag closes when it changes. */
  selection: readonly string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const frame = (part: DrawnRegion | undefined) =>
    part === undefined ? null : (
      <BlockEnvironmentProvider value={environment}>
        <CanvasRegionFrame
          region={part.region}
          rendered={rendered}
          sheet={part.sheet}
          selection={selection}
        />
      </BlockEnvironmentProvider>
    );
  return (
    <>
      {frame(drawn?.header)}
      {children}
      {frame(drawn?.footer)}
    </>
  );
}
