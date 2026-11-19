"use client";

/**
 * Layers' rows for the regions of the page's layout, its header and footer,
 * which are not the page's blocks, and what Layers does while one of them is
 * edited in place.
 *
 * @module layers-regions
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import { Lock } from "lucide-react";
import * as React from "react";

import { isHTMLElement } from "../../dom-kind";
import { EDITOR_WORDS } from "../../editor-words";

/** The region Layers shows the blocks of while it is edited in place. */
export interface LayersEditedRegion {
  /** Its name, "Site header". */
  readonly label: string;
}

/**
 * The regions whose first row has had focus, by the editing session's own
 * value, so it moves there once as editing starts and not again when the
 * panel is closed and opened while the same region is edited.
 */
const focusedRegions = new WeakSet<LayersEditedRegion>();

/** One region of the page's layout, as a row of its own in Layers. */
export interface LayersRegionRow {
  readonly area: RegionArea;
  /** The region's name, "Site header". */
  readonly name: string;
  /** Where it comes from, "Main header & footer". */
  readonly origin: string;
  /** Whether the region is the canvas's selection. */
  readonly selected?: boolean;
  /** Select the region, and show it on the canvas. */
  readonly onActivate: () => void;
}

/** A region of the page's layout, as a row that is not one of the page's blocks. */
export function RegionRow({
  row,
}: {
  row: LayersRegionRow;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-layers-region"
      data-nx-layers-region={row.area}
      // Named whole, so it is announced as one sentence: what it is and where
      // it comes from. Pressed while the region is selected.
      aria-label={`${row.name}, ${row.origin}`}
      aria-pressed={row.selected === true}
      onClick={row.onActivate}
    >
      <Lock size={14} aria-hidden="true" />
      {/* A real space between name and origin, which the flex row does not
          draw: the words drawn stay apart, so the name holds them. */}
      <span className="nx-layers-region__name">{row.name}</span>{" "}
      <span className="nx-layers-region__origin">{row.origin}</span>
    </button>
  );
}

/**
 * Focus the first row of the tree once per region edited in place, as
 * editing it starts: rows are drawn a frame after the panel, so it is asked
 * after paint.
 */
function useFocusFirstRowOf(
  region: LayersEditedRegion | undefined,
  body: React.RefObject<HTMLDivElement | null>
): void {
  React.useEffect(() => {
    if (region === undefined || focusedRegions.has(region)) return;
    const row = body.current?.querySelector('[role="treeitem"]');
    if (!isHTMLElement(row)) return;
    focusedRegions.add(region);
    row.focus();
  });
}

/** What Layers and its tree are called: "Layers", or "Layers · Site header". */
export function layersTitleOf(region: LayersEditedRegion | undefined): string {
  return region === undefined
    ? EDITOR_WORDS.layers
    : `${EDITOR_WORDS.layers} · ${region.label}`;
}

/** What Layers says with no blocks to show, of the page or of the region. */
export function emptyNoteOf(region: LayersEditedRegion | undefined): string {
  const whose = region === undefined ? "This page" : region.label;
  return `${whose} has no blocks yet. Open Add in the rail to place one.`;
}

/**
 * Layers' heading while a region is edited in place, so the panel says whose
 * blocks it lists; none while the page's are, as before.
 */
export function EditedRegionHeading({
  region,
  title,
}: {
  region: LayersEditedRegion | undefined;
  title: string;
}): React.JSX.Element | null {
  return region === undefined ? null : (
    <h2 className="nx-layers-panel__heading">{title}</h2>
  );
}

/**
 * Layers' search, started afresh whenever the document it searches changes:
 * entering a region edited in place, or leaving it. Cleared in the render
 * that sees the change, so the region's rows are never drawn filtered by the
 * page's words, and the first of them is there to take focus.
 */
function useSearchOf(
  region: LayersEditedRegion | undefined
): [string, (query: string) => void] {
  const [query, setQuery] = React.useState("");
  const [searched, setSearched] = React.useState(region);
  if (searched !== region) {
    setSearched(region);
    setQuery("");
  }
  return [query, setQuery];
}

/**
 * What Layers keeps per document it shows: its search, started afresh on
 * entering or leaving a region edited in place, and the tree's element,
 * whose first row takes focus once as the region's editing starts.
 */
export function useEditedRegionLayers(region: LayersEditedRegion | undefined): {
  query: string;
  setQuery: (query: string) => void;
  body: React.RefObject<HTMLDivElement | null>;
} {
  const [query, setQuery] = useSearchOf(region);
  const body = React.useRef<HTMLDivElement | null>(null);
  useFocusFirstRowOf(region, body);
  return { query, setQuery, body };
}
