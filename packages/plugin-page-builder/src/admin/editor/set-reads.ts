/**
 * What a header & footer set's own screen in the builder reads: the
 * components its header and footer may name, and the set's standing among
 * the sets (published, the site default, who may do what, how many pages
 * show it).
 *
 * @module admin/editor/set-reads
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import { useDocumentLocale, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useRef } from "react";

import {
  layoutChoicesPath,
  type LayoutChoice,
  type LayoutChoicesResponse,
} from "../../layout-choices-contract";
import {
  LAYOUT_COUNTS_ROUTE_PATH,
  type LayoutPageCount,
  type LayoutPageCountsResponse,
} from "../../layout-counts-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  setAreaChoicesPath,
  type SetAreaChoicesResponse,
} from "../../set-area-choices-contract";

/** One read of an area's choices, as the hooks below answer it. */
export interface SetAreaChoicesRead {
  readonly data: SetAreaChoicesResponse | undefined;
  readonly error: unknown;
  readonly refetch: () => void;
}

/**
 * The published components `area` may name, in the language being edited:
 * the definitions of `selected`, which the canvas draws, always, and every
 * listed one's when `pictures` is asked, once a picker opens. Asked again on
 * every mount: a component published in another tab is a choice.
 */
export function useSetAreaChoices(
  area: RegionArea,
  ask: {
    readonly selected?: string | undefined;
    readonly pictures?: boolean;
    readonly enabled?: boolean;
  }
): SetAreaChoicesRead {
  const locale = useDocumentLocale()?.code ?? null;
  const read = usePluginRoute<SetAreaChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: setAreaChoicesPath(area, {
      locale,
      selected: ask.selected ?? null,
      ...(ask.pictures === true ? { pictures: true } : {}),
    }),
    enabled: ask.enabled ?? true,
    staleTime: 0,
  });
  return { data: read.data, error: read.error, refetch: read.refetch };
}

/** The set's standing among the sets, as its screen reads it. */
export interface SetStanding {
  /** Every set's choices, read about this one; undefined until answered. */
  readonly choices: LayoutChoicesResponse | undefined;
  /** This set among them, once answered. */
  readonly set: LayoutChoice | undefined;
  /** How many pages show it, once counted. */
  readonly pages: LayoutPageCount | undefined;
  /** Whether it is the site default. */
  readonly isDefault: boolean;
  /** Reads it all again, after a write that changes it. */
  readonly reread: () => void;
}

/**
 * The set `id`'s standing, read as the author: the choices read about it
 * (its published regions, its starter and draft facts, the default and the
 * rights), and the counts. Nothing is read while `id` is undefined.
 */
export function useSetStanding(id: string | undefined): SetStanding {
  const enabled = id !== undefined;
  const locale = useDocumentLocale()?.code ?? null;
  const choices = usePluginRoute<LayoutChoicesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: layoutChoicesPath(id ?? null, { locale }),
    enabled,
    staleTime: 0,
  });
  const counts = usePluginRoute<LayoutPageCountsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LAYOUT_COUNTS_ROUTE_PATH,
    enabled,
    staleTime: 0,
  });
  const reread = useRereadAll([choices.refetch, counts.refetch]);
  const data = choices.data;
  return {
    choices: data,
    set: data?.items.find(item => item.id === id),
    pages: id === undefined ? undefined : counts.data?.[id],
    isDefault: id !== undefined && data?.meta.defaultLayout === id,
    reread,
  };
}

/**
 * One call that asks each read again, the same function for as long as the
 * caller is mounted: a read's own `refetch` is a new function on each render,
 * and a reader keyed on the call would otherwise ask again on every answer.
 */
export function useRereadAll(
  refetches: readonly (() => unknown)[]
): () => void {
  const latest = useRef(refetches);
  useEffect(() => {
    latest.current = refetches;
  });
  return useCallback(() => {
    for (const refetch of latest.current) refetch();
  }, []);
}
