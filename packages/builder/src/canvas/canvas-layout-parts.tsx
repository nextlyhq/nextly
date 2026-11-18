"use client";

/**
 * The regions of the page's Layout around the page: which parts are drawn,
 * in what order, each with how it treats the site sheet, and the header and
 * footer drawn around the page.
 *
 * @module canvas-layout-parts
 */

import type { RegionArea } from "@nextlyhq/blocks-engine";
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
import { useEffect, useMemo, useRef, useState } from "react";

import { isHTMLElement } from "../dom-kind";

import type { CanvasEditingRegion } from "./canvas-props";
import {
  CanvasRegionFrame,
  EditedRegionFrame,
  EmptyRegionBand,
  REGION_ATTRIBUTE,
  type CanvasRegion,
  type EmptyRegionBandProps,
} from "./canvas-regions";

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
 *
 * With regions, the page sits in a part of its own that lays out as if it
 * were not there (`display: contents`), always, so editing a region in place
 * and leaving it never draws the page again from scratch: the part only
 * turns `inert` and hidden from assistive technology while a region is
 * edited, with the other region likewise, and the edited one is drawn from
 * its live document. Leaving gives that region back its focus, where the
 * author went in.
 */
export function RegionsAround({
  drawn,
  rendered,
  environment,
  selection,
  editing,
  bands,
  children,
}: {
  drawn: LayoutParts | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  environment: BlockEnvironment | undefined;
  /** The region selected, and the ways to select and edit one. */
  selection: {
    readonly selectedRegion?: RegionArea | null;
    readonly onSelectRegion?: (area: RegionArea) => void;
    readonly onEditRegion?: (area: RegionArea) => void;
  };
  /** The region edited in place, while one is. */
  editing: CanvasEditingRegion | undefined;
  /**
   * What is drawn where an area has no region, by area: the host's band
   * saying so, with its ways to fill it. None while a region is edited.
   */
  bands?: Partial<Readonly<Record<RegionArea, EmptyRegionBandProps>>>;
  children: React.ReactNode;
}): React.JSX.Element {
  const pagePart = useRef<HTMLDivElement | null>(null);
  useFocusBackOnLeaving(pagePart, editing?.area);
  const dimmed = editing !== undefined;
  // An area with no region, and a band for it: the band in the region's
  // place, while nothing is edited in place.
  const band = (area: RegionArea) => {
    const given = bands?.[area];
    return given === undefined || dimmed ? null : (
      <EmptyRegionBand area={area} band={given} />
    );
  };
  if (drawn === undefined) {
    return (
      <>
        {band("header")}
        {children}
        {band("footer")}
      </>
    );
  }
  const frame = (part: DrawnRegion | undefined) =>
    part === undefined ? null : (
      <BlockEnvironmentProvider value={environment}>
        {editing?.area === part.region.area ? (
          <EditedRegionFrame
            area={part.region.area}
            document={editing.document}
            definitions={editing.definitions}
            rendered={rendered}
            sheet={part.sheet}
          />
        ) : (
          <CanvasRegionFrame
            region={part.region}
            rendered={rendered}
            sheet={part.sheet}
            selected={!dimmed && selection.selectedRegion === part.region.area}
            onSelect={selection.onSelectRegion}
            onEdit={selection.onEditRegion}
            dimmed={dimmed}
          />
        )}
      </BlockEnvironmentProvider>
    );
  return (
    <>
      {drawn.header === undefined ? band("header") : frame(drawn.header)}
      <div
        ref={pagePart}
        className={PAGE_PART_CLASS}
        inert={dimmed}
        aria-hidden={dimmed ? "true" : undefined}
      >
        {children}
      </div>
      {drawn.footer === undefined ? band("footer") : frame(drawn.footer)}
    </>
  );
}

/**
 * The class on the part holding the page between its regions. Laid out as if
 * it were not there (`display: contents`): `contents` for a canvas drawn in
 * the editor's own document, whose sheet has the utility, and the frame
 * sheet's rule for one drawn in its frame.
 */
const PAGE_PART_CLASS = "nx-canvas-page-part contents";

/**
 * Focus the region just left, once, as the editing of it ends: found beside
 * the page's part, in the canvas it is drawn in. A leave is its own value,
 * so leaving the same region twice focuses it twice.
 */
function useFocusBackOnLeaving(
  pagePart: React.RefObject<HTMLDivElement | null>,
  area: RegionArea | undefined
): void {
  const [held, setHeld] = useState(area);
  const [left, setLeft] = useState<{ area: RegionArea } | null>(null);
  if (held !== area) {
    setHeld(area);
    setLeft(area === undefined && held !== undefined ? { area: held } : null);
  }
  useEffect(() => {
    if (left === null) return;
    const frame = pagePart.current?.parentElement?.querySelector(
      `[${REGION_ATTRIBUTE}="${left.area}"]`
    );
    if (isHTMLElement(frame)) frame.focus({ preventScroll: true });
  }, [left, pagePart]);
}
