/**
 * "Edit component": the one way the editor opens a component alone, in its own
 * Page Builder view, and the way back to where the author came from.
 *
 * ## One helper
 *
 * The inspector of a placement, the block toolbar and the Components panel
 * all offer it, and all call {@link useEditComponent}, so the address, the
 * way back and the permission are decided once.
 *
 * ## The way back
 *
 * The component's view is opened with `?return=` naming the address the author
 * left, at the placement when it is a section of the page, so Back lands where
 * they were. The view reads it back through {@link returnFromSearch}, which
 * takes an admin path and nothing else: the parameter arrives in an address
 * anyone can write, and an outside address there would be an open redirect.
 *
 * ## A full load, and unsaved changes
 *
 * Both moves are to ANOTHER document, so both load the address afresh rather
 * than moving inside the admin. Moved in place, the admin keeps the view
 * mounted and hands it the new document's form, while the editor, which reads
 * its document once as it mounts, goes on showing (and would commit) the one
 * it came from. A load mounts the new document's editor from its own form.
 * Leaving with unsaved work asks first: the admin's unsaved-changes guard
 * answers the load, as it does a reload.
 *
 * @module admin/editor/edit-component
 */
import { useCallback, useEffect, useRef } from "react";

import { useComponentEditing } from "../pattern-capability-client";

import {
  addressWithoutSection,
  documentBuilderPath,
  sectionAddress,
} from "./builder-address";

/** The query parameter naming where the component view goes back to. */
const RETURN_PARAM = "return";

/** The view's own parameter naming the blocks field it opens. */
const FIELD_PARAM = "field";

/**
 * The query parameter naming the document Back returns to, so the banner can
 * say "Back to Home" rather than a bare "Back".
 */
const FROM_PARAM = "from";

/** The longest name Back says before it is cut short. */
const FROM_MAX = 80;

/** A fixed origin to resolve a path against, which no real address has. */
const NOWHERE = "http://return.invalid";

/** The address of a component's own Page Builder view. */
export function componentEditorAddress(
  collection: string,
  componentId: string,
  returnTo: string | undefined,
  /** The blocks field the definition lives in, so the view opens that one. */
  field?: string,
  /** The name of the document left, which Back says it returns to. */
  from?: string
): string {
  const base = documentBuilderPath(collection, componentId);
  const query = new URLSearchParams();
  if (field !== undefined) query.set(FIELD_PARAM, field);
  if (returnTo !== undefined) query.set(RETURN_PARAM, returnTo);
  // Only beside a way back: a name with nowhere to go names nothing.
  const named = from === undefined ? undefined : plainLabel(from);
  if (returnTo !== undefined && named !== undefined) {
    query.set(FROM_PARAM, named);
  }
  const said = query.toString();
  return said === "" ? base : `${base}?${said}`;
}

/**
 * An admin path, as it may be navigated to, or `undefined` for anything else:
 * an outside or protocol-relative address, one that climbs out of the admin,
 * one carrying a backslash or a control character.
 */
export function checkedAdminPath(value: string | null): string | undefined {
  if (
    value === null ||
    !value.startsWith("/admin/") ||
    value.startsWith("//")
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value, NOWHERE);
  } catch {
    return undefined;
  }
  // The resolved path must still be the written one: `/admin/../x` starts
  // with the prefix and resolves outside it, and a backslash or a control
  // character is rewritten by the parser, so either fails the comparison too.
  const written = value.split(/[?#]/, 1)[0];
  if (url.origin !== NOWHERE || url.pathname !== written) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Whether the editor is open on a component of the store: an entry of the
 * collection component definitions live in, in the field they live in.
 * Another collection, or another field of the same one, may hold component
 * documents too, and they are not the definitions placements resolve.
 */
export function isStoreRow(
  identity: { readonly kind: string; readonly slug: string } | null | undefined,
  store: { readonly collection: string; readonly field: string } | undefined,
  /** The blocks field open in the editor: the store's own, or another. */
  fieldName: string | undefined
): boolean {
  return (
    store !== undefined &&
    identity?.kind === "collection" &&
    identity.slug === store.collection &&
    fieldName === store.field
  );
}

/** Where a component view goes back to, read from its own address. */
export function returnFromSearch(search: string): string | undefined {
  return checkedAdminPath(new URLSearchParams(search).get(RETURN_PARAM));
}

/**
 * The name of the document Back returns to, read from the view's own address
 * as plain words. The parameter arrives in an address anyone can write, so it
 * is only ever drawn as text, on one line and bounded; where it goes is
 * decided by the checked path alone.
 */
export function returnLabelFromSearch(search: string): string | undefined {
  const from = new URLSearchParams(search).get(FROM_PARAM);
  return from === null ? undefined : plainLabel(from);
}

/** A name as one bounded line of text, or nothing when it is blank. */
function plainLabel(value: string): string | undefined {
  // Control characters become spaces, and runs of space one space.
  const line = Array.from(value, char => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (line === "") return undefined;
  return line.length <= FROM_MAX ? line : `${line.slice(0, FROM_MAX - 1)}…`;
}

/**
 * The address the author is at, to come back to: at the placement when it is
 * a section of the page, so the editor reopens with it selected.
 */
export function hereAddress(
  location: { readonly pathname: string; readonly search: string },
  sectionId: string | undefined
): string {
  const href = `${location.pathname}${location.search}`;
  // Not a section: any section the address already names is the author's
  // earlier one, and Back must not reopen there.
  return sectionId === undefined
    ? addressWithoutSection(href)
    : sectionAddress(href, sectionId);
}

/**
 * Where Back from a component's view returns to.
 *
 * From a placement: at it when it is a section of the page, so the editor
 * reopens with it selected, and otherwise without a section. From no
 * placement, as from the Components panel: the address as it stands, a
 * section it names included, since that is where the editor is open.
 */
export function backAddress(
  location: { readonly pathname: string; readonly search: string },
  nodeId: string | undefined,
  isSection: (nodeId: string) => boolean
): string {
  if (nodeId === undefined) return `${location.pathname}${location.search}`;
  return hereAddress(location, isSection(nodeId) ? nodeId : undefined);
}

/**
 * Open a component alone, or `undefined` when this author may not update
 * components, so no surface offers it.
 *
 * From a placement, `nodeId` names it, and `isSection` says whether it is a
 * top-level block of the page, asked when the author presses, of the
 * document as it is then. From the Components panel there is no placement,
 * and Back returns to the address as the author left it.
 */
export function useEditComponent(
  isSection: (nodeId: string) => boolean,
  /** The name of the document open here, which Back will say it returns to. */
  here?: string
): ((componentId: string, nodeId?: string) => void) | undefined {
  const editing = useComponentEditing();
  // The latest question, read when the author presses rather than closed over,
  // so the callback keeps one identity across the page's edits.
  const asked = useRef(isSection);
  // The name as it stands when the author presses, for the same reason.
  const named = useRef(here);
  useEffect(() => {
    asked.current = isSection;
    named.current = here;
  }, [isSection, here]);
  const open = useCallback(
    (componentId: string, nodeId?: string) => {
      if (editing === undefined) return;
      const back = backAddress(window.location, nodeId, asked.current);
      openDocument(
        componentEditorAddress(
          editing.collection,
          componentId,
          back,
          editing.field,
          named.current
        )
      );
    },
    [editing]
  );
  return editing === undefined ? undefined : open;
}

/**
 * Load another document's address afresh. Only an admin path is loaded; the
 * way back is checked before it reaches here, and the component's address is
 * built from the server's answer.
 */
export function openDocument(address: string): void {
  const checked = checkedAdminPath(address);
  if (checked !== undefined) window.location.assign(checked);
}
