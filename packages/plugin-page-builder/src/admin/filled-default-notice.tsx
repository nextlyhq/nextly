"use client";

/**
 * Telling the author that the header (or footer) they just published now
 * shows on every page: "<Name> now shows on every page.", "Pages that chose a
 * different header keep theirs." and "Change in Header & footer".
 *
 * The fill happens on the server, after the publish commits, from whichever
 * screen published (`default-layout/first-fill-hook`). The screen asks for
 * what is waiting for its author once the component it shows is live, which
 * is right after a publish, and when the author opens a live component, so a
 * publish from the API is told the next time they are back. The server
 * answers each fill once, to its publisher only, so two tabs never both say
 * it and a later visit says nothing.
 *
 * Mounted by the component's own screens: the builder and the admin's form.
 * "Change in Header & footer" opens the admin's list of sets.
 *
 * @module admin/filled-default-notice
 */
import {
  navigateTo,
  useDocumentStatus,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import { useEffect } from "react";

import {
  CHANGE_IN_HEADER_FOOTER,
  FILL_NOTICES_ROUTE_PATH,
  fillDetail,
  fillHeadline,
  type FillNoticesResult,
} from "../default-layout/fill-notice-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** Long enough to read both lines and reach the link. */
const FILL_NOTICE_MS = 12_000;

/** Say each fill, with the link to where the sets are changed. */
export function showFillNotices(
  result: FillNoticesResult,
  open: (href: string) => void = navigateTo
): void {
  for (const fill of result.fills) {
    toast.success(fillHeadline(fill), {
      description: fillDetail(fill),
      duration: FILL_NOTICE_MS,
      action: {
        label: CHANGE_IN_HEADER_FOOTER,
        onClick: () => open(result.setsAddress),
      },
    });
  }
}

/**
 * Take the fills waiting for the signed-in author. Undefined when the ask
 * failed: nothing is said, and the fill itself has happened regardless.
 */
export async function takeFillNotices(): Promise<
  FillNoticesResult | undefined
> {
  try {
    const answer = await writePluginRoute<{ item?: FillNoticesResult }>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: FILL_NOTICES_ROUTE_PATH,
      body: {},
    });
    return answer?.item;
  } catch {
    return undefined;
  }
}

/**
 * Ask for, and say, the fills waiting for the author, each time the component
 * this screen shows becomes live with nothing unpublished: on opening a live
 * one, and right after a publish. Nothing for any other document.
 */
export function useFilledDefaultNotice(isComponent: boolean): void {
  const status = useDocumentStatus();
  const live =
    status !== null && status.status === "published" && !status.hasWorkingDraft;
  useEffect(() => {
    if (!isComponent || !live) return;
    // Said even when this screen has closed by the time the answer comes:
    // the server answers a fill once, so one not said now is never said.
    void takeFillNotices().then(result => {
      if (result !== undefined) showFillNotices(result);
    });
  }, [isComponent, live]);
}
