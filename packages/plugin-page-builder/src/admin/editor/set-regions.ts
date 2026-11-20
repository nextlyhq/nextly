/**
 * The header and footer a header & footer set's own screen draws around its
 * placeholder: the set's WORKING areas, as its form holds them now, so a
 * header picked in the settings panel is drawn at once, before anything is
 * saved. Each region's component is drawn from its PUBLISHED definition, as
 * a page using the set will draw it once the set is published.
 *
 * @module admin/editor/set-regions
 */
import {
  regionDocument,
  type BlockDocument,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import type { CanvasRegion, LayersRegionRow } from "@nextlyhq/builder/shell";
import { useEffect, useMemo, useState } from "react";
import {
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { areaComponentOf, areaRowsOf } from "../../layout-area-rows";
import {
  regionNaming,
  type PageLayoutRegions,
  type RegionCardFacts,
} from "../page-layout";

import { useRereadAll, useSetAreaChoices, useSetStanding } from "./set-reads";

/** The set a set's own screen is open on. */
export interface SetMode {
  /** The set, by id. */
  readonly id: string;
  /**
   * Whether a colleague holds the set: its settings are shown and not
   * offered for change.
   */
  readonly readOnly?: boolean;
}

/** The set form's fields this reads. */
const AREAS_FIELD = "areas";
const TITLE_FIELD = "title";

/** The areas in the order they are drawn and listed. */
const AREAS: readonly RegionArea[] = ["header", "footer"];

/**
 * What a set's screen says of the site default: nothing. It draws the set's
 * own areas, and an empty one is filled from its picker, not by the band a
 * page following the default shows.
 */
const NOT_THE_DEFAULT = { empty: [], followsDefault: false } as const;

/** What is drawn before any answer has arrived. */
const NOTHING_DRAWN: PageLayoutRegions = {
  canvas: [],
  layers: [],
  cards: [],
  ...NOT_THE_DEFAULT,
};

/** The set's title and the component each area names, from its form. */
export function useSetFormAreas<T extends FieldValues>(
  control: Control<T>
): {
  readonly title: string;
  readonly rows: ReturnType<typeof areaRowsOf>;
  readonly header: string | undefined;
  readonly footer: string | undefined;
} {
  const areas: unknown = useWatch({ control, name: AREAS_FIELD as Path<T> });
  const title: unknown = useWatch({ control, name: TITLE_FIELD as Path<T> });
  // Keyed by what the rows say, not by the array: the form may answer the
  // same rows as a new array on any render, and every reader below would
  // otherwise draw again each time.
  const said = JSON.stringify(areaRowsOf(areas));
  const named = typeof title === "string" ? title : "";
  return useMemo(() => {
    const rows = areaRowsOf(JSON.parse(said) as unknown);
    return {
      title: named,
      rows,
      header: areaComponentOf(rows, "header"),
      footer: areaComponentOf(rows, "footer"),
    };
  }, [said, named]);
}

/**
 * The regions a set's screen draws, their Layers rows and their cards, from
 * the set form's working areas; `undefined` for any other document, whose
 * regions are its own Layout's.
 */
export function useSetRegions<T extends FieldValues>(
  control: Control<T>,
  set: SetMode | undefined,
  canvasRoot: HTMLElement | null
): (PageLayoutRegions & { readonly reread: () => void }) | undefined {
  const form = useSetFormAreas(control);
  const enabled = set !== undefined;
  const header = useSetAreaChoices("header", {
    selected: form.header,
    enabled: enabled && form.header !== undefined,
  });
  const footer = useSetAreaChoices("footer", {
    selected: form.footer,
    enabled: enabled && form.footer !== undefined,
  });
  const setId = set?.id;
  const standing = useSetStanding(setId);
  const fresh = useMemo((): PageLayoutRegions | undefined => {
    if (setId === undefined) return NOTHING_DRAWN;
    const named: Record<RegionArea, string | undefined> = {
      header: form.header,
      footer: form.footer,
    };
    const reads = { header: header.data, footer: footer.data };
    // Nothing new while the answer for a new choice is on its way: drawn
    // without its definition, the region would show a missing component
    // for a moment. The last regions drawn stay.
    const waiting = AREAS.some(
      area =>
        named[area] !== undefined &&
        reads[area] === undefined &&
        (area === "header" ? header.error : footer.error) === null
    );
    if (waiting) return undefined;
    const definitions = new Map<string, BlockDocument>([
      ...Object.entries(header.data?.meta.definitions ?? {}),
      ...Object.entries(footer.data?.meta.definitions ?? {}),
    ]);
    const facts = standing.choices?.meta.regionComponents ?? {};
    const drawn = AREAS.flatMap(area => {
      const componentId = named[area];
      if (componentId === undefined || !definitions.has(componentId)) return [];
      return [{ area, componentId }];
    });
    const naming = (area: RegionArea, componentId: string) =>
      regionNaming(
        form.title,
        area,
        facts[componentId]?.untouchedStarter === area
      );
    const canvas = drawn.map(
      ({ area, componentId }): CanvasRegion => ({
        area,
        document: regionDocument([{ area, componentId }]),
        definitions,
        ...naming(area, componentId),
      })
    );
    const layers = drawn.map(
      ({ area, componentId }): LayersRegionRow => ({
        area,
        name: naming(area, componentId).name,
        origin: `${form.title} header & footer`,
        onActivate: () => {
          // Shown and focused on the canvas, where it is selected.
          const element = canvasRoot?.querySelector<HTMLElement>(
            `[data-nx-region="${area}"]`
          );
          element?.scrollIntoView({ block: "nearest" });
          element?.focus();
        },
      })
    );
    const cards = drawn.map(
      ({ area, componentId }): RegionCardFacts => ({
        area,
        componentId,
        setId,
        setTitle: form.title,
        starter: facts[componentId]?.untouchedStarter === area,
        ...(facts[componentId]?.draftChangesNotLive === true
          ? { note: `Draft changes not live: ${area} component` }
          : {}),
      })
    );
    return { canvas, layers, cards, ...NOT_THE_DEFAULT };
  }, [
    setId,
    form,
    header.data,
    header.error,
    footer.data,
    footer.error,
    standing.choices,
    canvasRoot,
  ]);
  // The last regions drawn, kept while the answer for a new choice is on
  // its way.
  const [shown, setShown] = useState(NOTHING_DRAWN);
  useEffect(() => {
    if (fresh !== undefined) setShown(fresh);
  }, [fresh]);
  const reread = useRereadAll([
    header.refetch,
    footer.refetch,
    standing.reread,
  ]);
  const drawn = fresh ?? shown;
  const answer = useMemo(() => ({ ...drawn, reread }), [drawn, reread]);
  return set === undefined ? undefined : answer;
}
