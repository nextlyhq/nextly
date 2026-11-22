/**
 * The create dialog a list's "+ New" opens in place of the create form, where
 * the view its collection's entries open in declares one (`createDialog`).
 *
 * The admin draws the dialog, titled "New <singular>" in sentence case
 * ("New page"), so its focus, Escape
 * and overlay handling and its look are the admin's own, as for a declared
 * row action's component; the plugin's component draws the body and is
 * mounted only while open. Closing it with the new entry's id opens that
 * entry where its collection opens entries, through the same address a row
 * links to; closing it with none, or dismissing it, leaves the list as it
 * was.
 *
 * @module components/features/entries/EntryList/useListCreateDialog
 */
import { Dialog, DialogContent, DialogTitle } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { navigateTo } from "@admin/lib/navigation";
import type { OpenableCollection } from "@admin/lib/navigation/document-address";
import { useCreateDialogOf } from "@admin/lib/navigation/useDocumentAddress";
import {
  getComponent,
  type DocumentCreateDialogProps,
} from "@admin/lib/plugins/component-registry";
import { entryKeys } from "@admin/services/entryApi";

/**
 * A collection's singular name inside a title: lowered where it is an
 * ordinary word ("Page" → "page"), kept where it reads as a name or an
 * acronym ("FAQ", "iPhone guide"), so the dialog reads "New page".
 */
function inSentence(label: string): string {
  const [first, second] = [...label];
  if (first === undefined) return label;
  const ordinary =
    first === first.toUpperCase() &&
    first !== first.toLowerCase() &&
    (second === undefined || second === second.toLowerCase());
  return ordinary ? first.toLowerCase() + label.slice(first.length) : label;
}

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
   * applies, or where its component is not in this admin (a development
   * build warns, naming it), so the caller goes to the create form instead
   * and "+ New" never opens nothing.
   */
  open: () => boolean;
  /** The dialog, drawn while open. */
  dialog: ReactNode;
}

export function useListCreateDialog({
  slug,
  collection,
  labels,
  entryHref,
}: ListCreateDialogOptions): ListCreateDialog {
  const dialogOf = useCreateDialogOf();
  const queryClient = useQueryClient();
  const path =
    collection === undefined
      ? undefined
      : dialogOf({ kind: "collection", slug }, { collection });
  const [opened, setOpened] = useState<string | null>(null);
  // What had focus when "+ New" opened the dialog: a dialog opened without a
  // trigger of its own sends focus to the page on closing, so it is given
  // back here instead.
  const opener = useRef<HTMLElement | null>(null);
  // Resolved when "+ New" is pressed, so a component map that registered
  // after the list drew is seen.
  const open = useCallback((): boolean => {
    if (path === undefined || getComponent(path) === undefined) return false;
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpened(path);
    return true;
  }, [path]);
  const close = useCallback(
    (createdId?: string) => {
      setOpened(null);
      if (createdId === undefined || createdId === "") return;
      // The dialog created through its own route, which the list's cached
      // pages know nothing of: a person coming back finds the new entry.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(slug),
      });
      navigateTo(entryHref(createdId));
    },
    [entryHref, queryClient, slug]
  );
  return useMemo(() => {
    const props: DocumentCreateDialogProps = {
      collection: { slug, labels },
      close,
    };
    return {
      open,
      dialog: (
        <Dialog
          open={opened !== null}
          onOpenChange={isOpen => {
            if (!isOpen) close();
          }}
        >
          <DialogContent
            onCloseAutoFocus={event => {
              if (opener.current === null) return;
              event.preventDefault();
              opener.current.focus();
            }}
          >
            <DialogTitle>New {inSentence(labels.singular)}</DialogTitle>
            {opened === null ? null : (
              <PluginSlot
                path={opened}
                props={{ ...props }}
                fallback={
                  <p className="text-sm text-muted-foreground">
                    This dialog isn&apos;t available in this admin.
                  </p>
                }
              />
            )}
          </DialogContent>
        </Dialog>
      ),
    };
  }, [open, close, opened, slug, labels]);
}
