"use client";

/**
 * Where an author reaches Delete component: the document's own Delete, in the
 * "…" menu, and each row of the component store's list.
 *
 * A component's own delete is refused unless it is Delete component's last
 * step, so both open the same dialog (`DeleteComponentDialog`) instead.
 *
 * - **The document's Delete** is replaced on the store's collection
 *   (`views[slug].documentActions.delete`): the row keeps its place, the
 *   permission it needs and every reason it can't run (a past version on
 *   screen, a colleague's claim), and choosing it opens
 *   `DeleteComponentReplacement`. Closing it after the delete leaves the
 *   document as the built-in Delete does, the list's cache refreshed.
 * - **The list** offers a row action. A row action is a description, not a
 *   component, so choosing it tells the list's tools which row was chosen,
 *   and they draw the dialog for it: `ComponentListTools` above the plugin's
 *   own collection's list, or `ComponentStoreDeleteHost` in the header for a
 *   host's store, whose own slot above the list the host may already fill. A deleted component's list is read again, so
 *   its row goes.
 *
 *   The action is registered by those tools, by the store's slug, the key
 *   its list is read under, so it follows a rename or a host's store and
 *   never reaches another collection, whichever slug it took.
 *
 * Whether the author may delete is the dialog's dry run's answer, not a
 * guess here: the grant is judged on the server, for this component.
 *
 * @module admin/DeleteComponentAction
 */
import {
  registerRowAction,
  usePluginClientConfig,
  type DocumentActionReplacementProps,
} from "@nextlyhq/plugin-sdk/admin";
import { Trash2 } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import { DeleteComponentDialog } from "./DeleteComponentDialog";
import { TransferImport } from "./transfer-import";

/** The row action's id on the component store's list. */
const DELETE_ROW_ACTION_ID = "page-builder-delete-component";

/**
 * The document's own Delete on the component store, replaced: the dialog,
 * open from the start, for the document on screen.
 */
export function DeleteComponentReplacement({
  entryId,
  mayWrite,
  close,
}: DocumentActionReplacementProps): JSX.Element {
  return (
    <DeleteComponentDialog
      componentId={entryId}
      // The edit screen names the component already.
      name={null}
      open
      mayStart={mayWrite}
      onClose={() => close()}
      // The editor leaves the deleted document and refreshes its lists.
      onDeleted={() => close("deleted")}
      leaveLabel="Back to the list"
    />
  );
}

/** The row the list's Delete component was chosen on. */
interface Asked {
  readonly id: string;
  readonly title: string | null;
}

/**
 * The mounted lists' tools, by the list they are drawn above, each told when
 * its own list's row action is chosen. The action runs outside React, so it
 * reaches the tools through this; the row chosen is the tools' own state, so
 * it goes with them when the list is left and a list opened again starts with
 * no dialog.
 */
const openers = new Map<string, ((asked: Asked) => void)[]>();

/**
 * Tell the latest tools mounted for `listSlug`: one dialog, even where a
 * page draws the header (and its tools) twice.
 */
function ask(listSlug: string, next: Asked): void {
  const mounted = openers.get(listSlug) ?? [];
  mounted[mounted.length - 1]?.(next);
}

/** A row's non-empty string field, or null. */
function textOf(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The lists the row action is registered on, so each gets one copy. */
const registeredOn = new Set<string>();

/**
 * Offer "Delete component…" on each row of the list keyed `listSlug`: the
 * component store's list, by the slug the site resolved.
 */
function registerDeleteComponentAction(listSlug: string): void {
  if (listSlug === "" || registeredOn.has(listSlug)) return;
  registeredOn.add(listSlug);
  registerRowAction<Record<string, unknown>>(listSlug, {
    id: DELETE_ROW_ACTION_ID,
    label: "Delete component…",
    icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
    destructive: true,
    isVisible: row => textOf(row, "id") !== null,
    onSelect: row => {
      const id = textOf(row, "id");
      if (id !== null) ask(listSlug, { id, title: textOf(row, "title") });
    },
  });
}

/**
 * Above the component store's list: the dialog for the row Delete component
 * was chosen on.
 *
 * `collectionSlug` is the list's own, renamed or not. The row action is
 * registered for it here, while rendering: the tools are drawn above the
 * table, so they render before it reads its row actions, and registering
 * again is a no-op.
 */
export function ComponentDeleteListTools({
  collectionSlug,
}: {
  readonly collectionSlug?: string;
}): JSX.Element | null {
  const listSlug = collectionSlug ?? "";
  registerDeleteComponentAction(listSlug);
  const [current, setCurrent] = useState<Asked | null>(null);
  useEffect(() => {
    const mine = openers.get(listSlug) ?? [];
    mine.push(setCurrent);
    openers.set(listSlug, mine);
    return () => {
      const at = mine.indexOf(setCurrent);
      if (at !== -1) mine.splice(at, 1);
    };
  }, [listSlug]);
  if (current === null) return null;
  return (
    <DeleteComponentDialog
      // A fresh dialog for each row, so nothing of the last one shows.
      key={current.id}
      componentId={current.id}
      name={current.title}
      open
      onClose={() => setCurrent(null)}
      onDeleted={() => {
        setCurrent(null);
        // The list holds the deleted row until it is read again.
        window.location.reload();
      }}
      leaveLabel="Close"
    />
  );
}

/**
 * The delete tools for a host's own component store, drawn through the
 * plugin's header slot, on every admin page. They register the row action on
 * that store's list, by the slug the plugin's options named (`clientConfig`),
 * and draw its dialog; nothing where the store is the plugin's own
 * collection, whose list draws the tools itself.
 */
export function ComponentStoreDeleteHost(): JSX.Element | null {
  const config = usePluginClientConfig(PAGE_BUILDER_PLUGIN_NAME);
  const store = config?.componentStore;
  if (typeof store !== "string" || store === "") return null;
  return <ComponentDeleteListTools collectionSlug={store} />;
}

/**
 * Above the plugin's own Components list: Import from file, as on the
 * Patterns and Layouts lists, and the delete tools.
 */
export function ComponentListTools({
  collectionSlug,
}: {
  readonly collectionSlug?: string;
}): JSX.Element {
  return (
    <>
      <TransferImport />
      <ComponentDeleteListTools
        {...(collectionSlug === undefined ? {} : { collectionSlug })}
      />
    </>
  );
}
