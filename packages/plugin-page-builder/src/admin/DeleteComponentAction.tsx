"use client";

/**
 * Where an author reaches Delete component: "Delete component…" in a
 * component's document bar, and on each row of the Components list.
 *
 * A component's own delete is refused unless it is Delete component's last
 * step, and the collection declares `admin.disableDelete`, so the admin
 * offers no Delete of its own for components. These two are the way to it,
 * and both open the same dialog (`DeleteComponentDialog`).
 *
 * - **The document bar** draws through the plugin's entry-form toolbar slot,
 *   beside History, as Remove Layout does on a Layout. A deleted component
 *   leaves for the list.
 * - **The list** offers a row action. A row action is a description, not a
 *   component, so choosing it records which row was asked for, and the list's
 *   tools above the table (`ComponentListTools`, the collection's
 *   `BeforeListTable`) draw the dialog for it. A deleted component's list is
 *   read again, so its row goes.
 *
 *   The action is registered by those tools, for the list they are drawn
 *   above, by the slug that list is keyed by. A host may rename the
 *   Components collection, and only the collection's own list draws its
 *   tools, so the action follows a rename and never reaches another
 *   collection that took the old name.
 *
 * Whether the author may delete is the dialog's dry run's answer, not a
 * guess here: the grant is judged on the server, for this component.
 *
 * @module admin/DeleteComponentAction
 */
import { registerRowAction } from "@nextlyhq/plugin-sdk/admin";
import { Button } from "@nextlyhq/ui";
import { Trash2 } from "lucide-react";
import { useState, useSyncExternalStore, type JSX } from "react";

import { DeleteComponentDialog } from "./DeleteComponentDialog";
import { TransferImport } from "./transfer-import";

/** The row action's id on the Components list. */
const DELETE_ROW_ACTION_ID = "page-builder-delete-component";

/** "Delete component…" in a component's document bar. */
export function DeleteComponentAction({
  componentId,
  onDeleted,
}: {
  readonly componentId: string;
  /** Where the author goes once the component is gone. */
  readonly onDeleted: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Delete component…
      </Button>
      {open ? (
        <DeleteComponentDialog
          componentId={componentId}
          // The edit screen names the component already.
          name={null}
          open
          onClose={() => setOpen(false)}
          onDeleted={onDeleted}
          leaveLabel="Back to Components"
        />
      ) : null}
    </>
  );
}

/** The row the list's Delete component was chosen on. */
interface Asked {
  readonly id: string;
  readonly title: string | null;
}

/**
 * The row asked for, shared by the row action and the list's tools: the
 * action runs outside React, and the tools draw the dialog for it.
 */
let asked: Asked | null = null;
const listeners = new Set<() => void>();

function ask(next: Asked | null): void {
  asked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
 * Components collection's list, by the slug the site resolved.
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
      if (id !== null) ask({ id, title: textOf(row, "title") });
    },
  });
}

/**
 * Above the Components list: Import from file, as on the Patterns and
 * Layouts lists, and the dialog for the row Delete component was chosen on.
 *
 * `collectionSlug` is the list's own, renamed or not. The row action is
 * registered for it here, while rendering: the tools are drawn above the
 * table, so they render before it reads its row actions, and registering
 * again is a no-op.
 */
export function ComponentListTools({
  collectionSlug,
}: {
  readonly collectionSlug?: string;
}): JSX.Element {
  registerDeleteComponentAction(collectionSlug ?? "");
  const current = useSyncExternalStore(
    subscribe,
    () => asked,
    () => null
  );
  return (
    <>
      <TransferImport />
      {current === null ? null : (
        <DeleteComponentDialog
          // A fresh dialog for each row, so nothing of the last one shows.
          key={current.id}
          componentId={current.id}
          name={current.title}
          open
          onClose={() => ask(null)}
          onDeleted={() => {
            ask(null);
            // The list holds the deleted row until it is read again.
            window.location.reload();
          }}
          leaveLabel="Close"
        />
      )}
    </>
  );
}
