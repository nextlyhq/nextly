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

import type { EditedLook, LookEditingState } from "./look-editing";
import { useSetRegions, type SetMode } from "./set-regions";

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

/**
 * A look edited on its own and a selected region, which both take the
 * sidebar: choosing either leaves the other, so the sidebar shows what the
 * author chose last.
 */
export function useLookBesideRegion(
  look: LookEditingState,
  region: RegionSelection
): { lookEditing: LookEditingState; selection: RegionSelection } {
  const { edit, exit } = look;
  const { select, clear } = region;
  const editLook = useCallback(
    (next: EditedLook) => {
      clear();
      edit(next);
    },
    [clear, edit]
  );
  const selectRegion = useCallback(
    (area: RegionArea) => {
      exit();
      select(area);
    },
    [exit, select]
  );
  const lookEditing = useMemo(
    () => ({ ...look, edit: editLook }),
    [look, editLook]
  );
  const selection = useMemo(
    () => ({ ...region, select: selectRegion }),
    [region, selectRegion]
  );
  return { lookEditing, selection };
}

/** What follows from the region selected, for the regions drawn. */
function useSelectedRegion(
  editors: RegionEditors,
  drawn: PageLayoutRegions,
  selection: RegionSelection
): SelectedRegion {
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
  // Inside a header being edited, a block is chosen in the header and the
  // header stays chosen behind it; on the page, choosing a block leaves it.
  const editingRegion = editors.active !== editors.page;
  const { select: selectBlock } = editors.active;
  const selectOnCanvas = useCallback<EditorState["select"]>(
    (id, mode) => {
      if (!editingRegion) clear();
      selectBlock(id, mode);
    },
    [editingRegion, clear, selectBlock]
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
/**
 * The page's state, which the region selection follows, and the state of
 * what is being edited, which a block chosen on the canvas is chosen in:
 * the same state, or a header's while it is edited in place.
 */
export interface RegionEditors {
  readonly page: Pick<EditorState, "selectedId" | "select">;
  readonly active: Pick<EditorState, "select">;
}

export function usePageRegions<T extends FieldValues>(
  control: Control<T>,
  canvasRoot: HTMLElement | null,
  editors: RegionEditors,
  /** The look edited on its own, which a selected region leaves. */
  look: LookEditingState,
  /**
   * The header & footer set whose own screen this is: its regions are its
   * form's working areas, rather than a page's Layout's.
   */
  set?: SetMode
): ReturnType<typeof usePageLayoutRegions> & {
  readonly selectedRegion: SelectedRegion;
  /** The look edited on its own, leaving the region when one is chosen. */
  readonly lookEditing: LookEditingState;
} {
  const pageDrawn = usePageLayoutRegions(control, canvasRoot);
  const drawn = useSetRegions(control, set, canvasRoot) ?? pageDrawn;
  const areas = useMemo(
    (): readonly RegionArea[] => drawn.canvas.map(region => region.area),
    [drawn.canvas]
  );
  const region = useRegionSelection(editors.page, areas);
  const { lookEditing, selection } = useLookBesideRegion(look, region);
  const selectedRegion = useSelectedRegion(editors, drawn, selection);
  return useMemo(
    () => ({ ...drawn, selectedRegion, lookEditing }),
    [drawn, selectedRegion, lookEditing]
  );
}
