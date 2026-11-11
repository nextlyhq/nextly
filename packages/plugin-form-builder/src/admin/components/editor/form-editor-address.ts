/**
 * Where each page of the form editor lives, and how a click on a link to one
 * moves there without reloading the admin.
 *
 * @module admin/components/editor/form-editor-address
 */
import { navigateTo } from "@nextlyhq/plugin-sdk/admin";
import type { MouseEvent } from "react";

import { FORM_PAGES, type FormPageId } from "../../../form-pages";

/** A saved form's edit address: Builder, and the base of every other page. */
function formEditAddress(collectionSlug: string, entryId: string): string {
  return `/admin/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(entryId)}`;
}

/** The address of one page of a saved form. */
export function formPageAddress(
  collectionSlug: string,
  entryId: string,
  page: FormPageId
): string {
  const base = formEditAddress(collectionSlug, entryId);
  const declared = FORM_PAGES.find(each => (each.path ?? "builder") === page);
  return declared?.path === undefined ? base : `${base}/${declared.path}`;
}

/**
 * Follow a plain click on a link inside the admin through the admin's own
 * navigation, so the page is not reloaded and the editor keeps what it holds.
 * A click that asks for a new tab or window (a modifier, a middle click) is
 * left to the browser, which opens the link's own address.
 */
export function followWithinAdmin(
  event: MouseEvent<HTMLAnchorElement>,
  href: string
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigateTo(href);
}
