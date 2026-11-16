/**
 * What the binding picker shows beside each field, as the editor's content
 * services: the language and zone a date or a number is previewed in, and
 * the values of a collection list's first entry beside its item's fields.
 *
 * Its own module, so the editor's service wiring names one call for the
 * picker's previews rather than holding each read's terms itself.
 *
 * @module admin/editor/picker-previews
 */
import type { InspectorPanel, OpenPassages } from "@nextlyhq/builder/shell";
import type { DocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import type { ComponentProps } from "react";

import { siteTimeZoneFor } from "../canvas-bindings-client";

import { canvasListSample } from "./canvas-page-context";

/** The editor's content services, as the inspector takes them. */
type ContentServices = NonNullable<
  ComponentProps<typeof InspectorPanel>["contentServices"]
>;

/** Where the picker's previews are read: the canvas, its languages and its author. */
export interface PickerPreviewTerms {
  readonly passages: OpenPassages;
  /** The entry the canvas is drawn as, which the zone and related lists read. */
  readonly canvas: DocumentIdentity | null;
  /**
   * The collection a related list reads the canvas's entry in, as the canvas
   * decides it (`listEntryCollectionOf`): none for a component or a Single.
   */
  readonly entryCollection: string | null | undefined;
  readonly userId: string | null;
  /** The language the canvas's render formats bound values in. */
  readonly formatLocale: string | undefined;
  /** The language being edited, which the canvas reads its lists in. */
  readonly locale: string | undefined;
}

/**
 * The picker's previews as service members.
 *
 * - The language and zone a date or a number is previewed in, so it reads as
 *   the page shows it: the canvas's language, and the site's zone, read when
 *   a picker first opens and once for this editor (its passages), never on a
 *   canvas load: the canvas reads it only for a page that already formats a
 *   date. No zone is read without an entry to ask for or a person to ask as.
 * - A list's first entry, beside its item's fields: the canvas's own read of
 *   the list, as the canvas draws it for this author, a list of related
 *   entries reading the canvas's entry.
 */
export function pickerPreviewServices({
  passages,
  canvas,
  entryCollection,
  userId,
  formatLocale,
  locale,
}: PickerPreviewTerms): Pick<
  ContentServices,
  "bindingLocale" | "readSiteTimeZone" | "readListSample"
> {
  // The entry exactly as the canvas's page context takes it, so a list of
  // related entries samples the rows the canvas draws.
  const entry = {
    entryCollection: entryCollection ?? undefined,
    entryId: canvas?.kind === "collection" ? canvas.documentId : undefined,
  };
  return {
    ...(formatLocale === undefined ? {} : { bindingLocale: formatLocale }),
    ...(canvas === null || userId === null
      ? {}
      : { readSiteTimeZone: () => siteTimeZoneFor(passages, canvas, userId) }),
    readListSample: props => canvasListSample(props, locale, userId, entry),
  };
}
