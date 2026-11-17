/**
 * The create dialog a list's "+ New" opens in place of the create form, where
 * the view its collection's entries open in declares one (`createDialog`).
 *
 * The dialog is the plugin's component, drawn whole by it and mounted only
 * while open. Closing it with the new entry's id opens that entry where its
 * collection opens entries, through the same address a row links to; closing
 * it with none leaves the list as it was.
 *
 * @module components/features/entries/EntryList/useListCreateDialog
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { navigateTo } from "@admin/lib/navigation";
import type { OpenableCollection } from "@admin/lib/navigation/document-address";
import { useCreateDialogOf } from "@admin/lib/navigation/useDocumentAddress";
import {
  hasComponent,
  type DocumentCreateDialogProps,
} from "@admin/lib/plugins/component-registry";

/** What the list hands the hook: its collection and how a row is addressed. */
interface ListCreateDialogOptions {
  slug: string;
  /** The collection as the list holds it; `undefined` while it loads. */
  collection: OpenableCollection | undefined;
  labels: { singular: string; plural: string };
  /** The address a row of the list opens, for the new entry. */
  entryHref: (entryId: string) => string;
}

/** The dialog's state, for the list's "+ New" and its page. */
export interface ListCreateDialog {
  /**
   * Open the dialog, answering whether it did: not where no view's dialog
   * applies, or where its component is not in this admin, so the caller goes
   * to the create form instead and "+ New" never opens nothing.
   */
  open: () => boolean;
  /** The open dialog, or nothing. */
  dialog: ReactNode;
}

export function useListCreateDialog({
  slug,
  collection,
  labels,
  entryHref,
}: ListCreateDialogOptions): ListCreateDialog {
  const dialogOf = useCreateDialogOf();
  const path =
    collection === undefined
      ? undefined
      : dialogOf({ kind: "collection", slug }, { collection });
  const [opened, setOpened] = useState<string | null>(null);
  // Read when "+ New" is pressed, so a component map that registered after
  // the list drew is seen.
  const open = useCallback((): boolean => {
    if (path === undefined || !hasComponent(path)) return false;
    setOpened(path);
    return true;
  }, [path]);
  const close = useCallback(
    (createdId?: string) => {
      setOpened(null);
      if (createdId !== undefined && createdId !== "") {
        navigateTo(entryHref(createdId));
      }
    },
    [entryHref]
  );
  return useMemo(() => {
    const props: DocumentCreateDialogProps = {
      collection: { slug, labels },
      close,
    };
    return {
      open,
      dialog:
        opened === null ? null : (
          <PluginSlot path={opened} props={{ ...props }} />
        ),
    };
  }, [open, close, opened, slug, labels]);
}
