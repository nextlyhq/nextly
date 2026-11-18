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
 * "Change in Header & footer" opens the Pages panel at its Header & footer
 * group in the builder, as "Manage headers & footers" does there, and the
 * admin's list of sets on the form, which has no such panel.
 *
 * @module admin/filled-default-notice
 */
import {
  navigateTo,
  useDocumentActions,
  useDocumentStatus,
  writePluginRoute,
  type DocumentSaveState,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import { useEffect, useRef } from "react";

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

/**
 * The builder's way to its sets: open the Pages panel and show its Header &
 * footer group. Absent on a screen without that panel.
 */
export interface BuilderSets {
  readonly requestPanel: (panel: "pages") => void;
  readonly pages: { readonly revealSets: () => void };
}

/**
 * Say each fill, with the link to where the sets are changed: the builder's
 * own sets where `sets` is given, else the admin's list.
 */
export function showFillNotices(
  result: FillNoticesResult,
  sets?: BuilderSets
): void {
  const open = (): void => {
    if (sets === undefined) {
      navigateTo(result.setsAddress);
      return;
    }
    sets.requestPanel("pages");
    sets.pages.revealSets();
  };
  for (const fill of result.fills) {
    toast.success(fillHeadline(fill), {
      description: fillDetail(fill),
      duration: FILL_NOTICE_MS,
      action: { label: CHANGE_IN_HEADER_FOOTER, onClick: open },
    });
  }
}

/**
 * Take the fills waiting for the signed-in author. Undefined when the ask
 * failed: nothing is said, and the fill itself has happened regardless.
 */
async function takeFillNotices(): Promise<FillNoticesResult | undefined> {
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
 * Ask for, and say, the fills waiting for the author whenever the component
 * this screen shows is live with nothing unpublished and has just been
 * stored: on opening a live one, and right after each publish, including a
 * publish of changes to a component that was live already (marking a live
 * component "Use as: Header" and publishing it directly keeps it live
 * throughout, so only the store's time says a publish landed). Nothing for
 * any other kind of document.
 */
export function useFilledDefaultNotice(
  documentKind: string,
  sets?: BuilderSets
): void {
  const isComponent = documentKind === "component";
  // The latest way to the sets, read when a notice is said: asking again
  // whenever the editor's panels re-render would ask the server again.
  const setsRef = useRef(sets);
  setsRef.current = sets;
  const status = useDocumentStatus();
  const live =
    status !== null && status.status === "published" && !status.hasWorkingDraft;
  const stored = storedAtOf(useDocumentActions()?.saveState);
  useEffect(() => {
    if (!isComponent || !live) return;
    // Said even when this screen has closed by the time the answer comes:
    // the server answers a fill once, so one not said now is never said.
    void takeFillNotices().then(result => {
      if (result !== undefined) showFillNotices(result, setsRef.current);
    });
  }, [isComponent, live, stored]);
}

/** When the document was last stored, as a number a dependency compares. */
function storedAtOf(state: DocumentSaveState | undefined): number | null {
  return state?.kind === "saved" && state.at !== null
    ? state.at.getTime()
    : null;
}
