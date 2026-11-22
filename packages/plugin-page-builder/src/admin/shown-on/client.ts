"use client";

/**
 * The admin's read of where the builder shows a Single's values.
 *
 * @module admin/shown-on/client
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  shownOnPath,
  type ShownOnAnswer,
  type ShownOnPlace,
} from "../../shown-on-contract";
import { editorAddressOf } from "../bindings-report/client";

/** How often the answer is asked again while pages are still being checked. */
const CHECKING_POLL_MS = 10_000;

/**
 * Where the builder shows the Single's values, as the signed-in person may
 * see them: the first ten, or every place with `all`. Asked again on each
 * mount, since a save in the builder changes it, and every ten seconds while
 * the first check of every page has not finished.
 */
export function useShownOn(
  slug: string,
  { all = false, enabled = true }: { all?: boolean; enabled?: boolean } = {}
): {
  readonly data: ShownOnAnswer | undefined;
  readonly error: unknown;
  readonly refetch: () => void;
} {
  const read = usePluginRoute<ShownOnAnswer>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: shownOnPath(slug, all),
    enabled,
    staleTime: 0,
  });
  // Only while the read is wanted: a closed full list keeps its last
  // answer, and asking again for it would read for no one.
  const checking = enabled && read.data?.checking === true;
  const { refetch } = read;
  useEffect(() => {
    if (!checking) return undefined;
    const timer = setInterval(refetch, CHECKING_POLL_MS);
    return () => clearInterval(timer);
    // `refetch` is a new function each render, so the timer restarts from
    // each answer: ten seconds after it.
  }, [checking, refetch]);
  return { data: read.data, error: read.error, refetch };
}

/**
 * Where a place opens: its document's builder, on the blocks field it is in,
 * with its block selected; nowhere for a place only in another language.
 */
export function placeAddress(place: ShownOnPlace): string | undefined {
  return editorAddressOf(place, {
    nodeId: place.nodeId,
    blocksField: place.blocksField,
    ...(place.inAnotherLanguage === true
      ? { inAnotherLanguage: true as const }
      : {}),
  });
}
