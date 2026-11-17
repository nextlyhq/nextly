/**
 * Which header or footer the canvas has selected, and what follows from it:
 * Layers' rows, the sidebar's card, and the canvas's own block selection
 * clearing it.
 *
 * The selection itself is the builder's (`useRegionSelection`): it never
 * holds beside a selected block. This is the host's side, which knows the
 * regions it drew and the facts each card is drawn from.
 *
 * @module admin/editor/selected-region
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  useRegionSelection,
  type EditorState,
  type LayersRegionRow,
  type RegionSelection,
} from "@nextlyhq/builder/shell";
import { useCallback, useMemo } from "react";
import type { Control, FieldValues } from "react-hook-form";

import {
  usePageLayoutRegions,
  type PageLayoutRegions,
  type RegionCardFacts,
} from "../page-layout";

/** The selected region and what reads it. */
export interface SelectedRegion {
  readonly selection: RegionSelection;
  /** Layers' rows, each selecting its region, the selected one pressed. */
  readonly layers: readonly LayersRegionRow[];
  /** What the selected region's card is drawn from, or nothing. */
  readonly card: RegionCardFacts | undefined;
  /**
   * The canvas's block selection, which clears the region: a click on a
   * block, or on the ground around the page.
   */
  readonly selectOnCanvas: EditorState["select"];
}

/** The region selection for the regions drawn around the page. */
function useSelectedRegion(
  editor: Pick<EditorState, "selectedId" | "select">,
  drawn: PageLayoutRegions
): SelectedRegion {
  const areas = useMemo(
    (): readonly RegionArea[] => drawn.canvas.map(region => region.area),
    [drawn.canvas]
  );
  const selection = useRegionSelection(editor, areas);
  const { area, select, clear } = selection;
  const layers = useMemo(
    () =>
      drawn.layers.map(
        (row): LayersRegionRow => ({
          ...row,
          selected: row.area === area,
          onActivate: () => {
            select(row.area);
            row.onActivate();
          },
        })
      ),
    [drawn.layers, area, select]
  );
  const card = useMemo(
    () => drawn.cards.find(facts => facts.area === area),
    [drawn.cards, area]
  );
  const { select: selectBlock } = editor;
  const selectOnCanvas = useCallback<EditorState["select"]>(
    (id, mode) => {
      clear();
      selectBlock(id, mode);
    },
    [clear, selectBlock]
  );
  return useMemo(
    () => ({ selection, layers, card, selectOnCanvas }),
    [selection, layers, card, selectOnCanvas]
  );
}

/**
 * The regions drawn around the page, from the form's unsaved values, with
 * the one selected and what reads it.
 */
export function usePageRegions<T extends FieldValues>(
  control: Control<T>,
  canvasRoot: HTMLElement | null,
  editor: Pick<EditorState, "selectedId" | "select">
): PageLayoutRegions & { readonly selectedRegion: SelectedRegion } {
  const drawn = usePageLayoutRegions(control, canvasRoot);
  const selectedRegion = useSelectedRegion(editor, drawn);
  return useMemo(() => ({ ...drawn, selectedRegion }), [drawn, selectedRegion]);
}
