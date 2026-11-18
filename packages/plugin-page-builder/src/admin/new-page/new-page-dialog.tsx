"use client";

/**
 * The New page dialog, wherever it opens.
 *
 * - From a collection's list, through the admin's create-dialog slot: the
 *   admin draws the dialog and its title; this draws the body
 *   ({@link NewPageCreateDialog}), and hands the made page back to the admin,
 *   which opens it where its collection opens entries: the builder, or the
 *   form for an author who may not change it.
 * - From the builder ({@link useNewPageDialog}): the Pages panel's "New
 *   page", and the page menu's. It makes the page in the collection of the
 *   page on screen, offers "Type" where more than one kind of page opens in
 *   the builder, and first asks about unsaved work on the page on screen.
 *
 * Below 600 px wide it is a full-height sheet from either place.
 *
 * @module admin/new-page/new-page-dialog
 */
import {
  navigateTo,
  useDocumentActions,
  useLeaveWithoutWarning,
  type DocumentCreateDialogProps,
} from "@nextlyhq/plugin-sdk/admin";
import { Dialog, DialogContent, DialogTitle } from "@nextlyhq/ui";
import { useCallback, useRef, useState, type JSX, type ReactNode } from "react";

import type { CreatedPageItem } from "../../pages-write-contract";
import { builderAddress, entryCreatePath } from "../editor/builder-address";

import { NewPageForm, type UnsavedWorkAsk } from "./new-page-form";
import { UnsavedWorkQuestion, useUnsavedQuestion } from "./new-page-unsaved";
import { newPageTitle } from "./new-page-words";

/**
 * The body of the dialog the admin opens from a list's "+ New".
 *
 * The admin offers it on every collection whose main field is a Page Builder
 * field, and some of those hold no pages (a field that takes only components
 * or patterns). The route is the one judge of which do, by the pages
 * search's reading, so a collection it refuses is handed to its ordinary
 * create form.
 */
export function NewPageCreateDialog({
  collection,
  close,
}: DocumentCreateDialogProps): JSX.Element {
  const slug = collection.slug;
  const toForm = useCallback(() => {
    close();
    navigateTo(entryCreatePath(slug));
  }, [close, slug]);
  return (
    <NewPageForm
      collection={slug}
      onCancel={() => close()}
      // The admin opens it by the same rule a row of the list does.
      onCreated={page => close(page.id)}
      onHoldsNoPages={toForm}
    />
  );
}

/**
 * Where a page just made opens: the builder on its Page Builder field, or
 * the page's form for an author who may not change it.
 */
export function openingAddress(page: CreatedPageItem): string {
  if (page.mayUpdate) {
    const address = builderAddress(
      { kind: "collection", slug: page.collection, documentId: page.id },
      page.field
    );
    if ("href" in address) return address.href;
  }
  return `/admin/collections/${encodeURIComponent(page.collection)}/${encodeURIComponent(page.id)}`;
}

/** What the builder tells the dialog about the page on screen. */
export interface PageOnScreen {
  /** Whether it holds work not yet saved. */
  readonly unsavedWork: boolean;
  /** Its title, as the question about unsaved work names it. */
  readonly title: string;
}

/** The builder's New page dialog: open it, and draw it. */
export interface NewPageDialogControl {
  /** Opens the dialog for a page in `collection`. */
  readonly open: (collection: string) => void;
  readonly dialog: ReactNode;
}

/** The builder's New page dialog, with its question about unsaved work. */
export function useNewPageDialog(onScreen: PageOnScreen): NewPageDialogControl {
  const [collection, setCollection] = useState<string | null>(null);
  const [singular, setSingular] = useState("page");
  const opener = useRef<HTMLElement | null>(null);
  const actions = useDocumentActions();
  const leaveWithoutWarning = useLeaveWithoutWarning();
  const question = useUnsavedQuestion(async () => {
    const save =
      actions?.saveWithoutPublishing ??
      (actions === null ? undefined : () => actions.run("save"));
    if (save === undefined) return false;
    return (await save()).ok;
  });
  const open = useCallback((slug: string) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setCollection(slug);
  }, []);
  const close = () => setCollection(null);
  const unsaved: UnsavedWorkAsk | undefined = onScreen.unsavedWork
    ? { ask: () => question.ask(onScreen.title), leaveWithoutWarning }
    : undefined;
  const onFacts = useCallback(
    (facts: { collection: { label: string } }) =>
      setSingular(facts.collection.label),
    []
  );

  const dialog = (
    <>
      <Dialog
        open={collection !== null}
        onOpenChange={isOpen => {
          if (!isOpen) close();
        }}
      >
        <DialogContent
          data-slot="new-page-dialog"
          className="sm:max-w-[560px]"
          onCloseAutoFocus={event => {
            // Back to the control that opened it, which a dialog opened
            // without a trigger of its own would otherwise lose.
            if (opener.current === null) return;
            event.preventDefault();
            opener.current.focus();
          }}
        >
          <DialogTitle>{newPageTitle(singular)}</DialogTitle>
          {collection === null ? null : (
            <NewPageForm
              collection={collection}
              offerType
              {...(unsaved === undefined ? {} : { unsaved })}
              onFacts={onFacts}
              onCancel={close}
              onCreated={page => {
                close();
                navigateTo(openingAddress(page));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <UnsavedWorkQuestion question={question} />
    </>
  );
  return { open, dialog };
}
