"use client";

/**
 * "Remove Layout…" on a Layout's edit screen, and the dialog it opens.
 *
 * A Layout's own delete and unpublish are refused, so this is where an author
 * takes one down. Opening the dialog asks the route for a dry run, which
 * writes nothing, and the dialog shows one of three states:
 *
 * - **Default**: the Layout is the site's default; the reason is shown and
 *   nothing can be confirmed.
 * - **Pages use it**: the pages naming the Layout, each a link that opens the
 *   page in a new tab, so the author can choose another Layout there and come
 *   back. Pages the author may not read are counted, not named.
 * - **Nothing in the way**: unpublish (when it is published) or delete.
 *
 * A confirmed removal still runs every check again on the server; a refusal
 * it meets is shown in the dialog.
 *
 * Drawn in the edit screen's document bar, beside History, through the
 * plugin's entry-form toolbar slot (`RemoveLayoutToolbarSlot`). That slot is
 * offered to every entry form, so it draws the button only on a saved Layout's
 * own form. The document panel offers plugins no section of their own, and the
 * slots above and below the form sit outside the document, the one above under
 * the bar itself.
 *
 * @module admin/RemoveLayoutAction
 */
import {
  navigateTo,
  useDocumentActions,
  useDocumentIdentity,
  useDocumentStatus,
  usePluginRoute,
  writePluginRoute,
  type DocumentActions,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import { useRef, useState, type JSX } from "react";

import {
  PAGE_COLLECTION_ROUTE_PATH,
  type PageCollectionResponse,
} from "../layout-choices-contract";
import type {
  RemovalCheck,
  RemoveResult,
} from "../layout-removal/remove-layout";
import { DEFAULT_LAYOUT_REFUSAL, PAGES_USE_IT } from "../layout-removal/words";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** Which Layout the action removes, and how it stands. */
export interface RemoveLayoutActionProps {
  readonly collectionSlug: string;
  readonly entryId: string | null;
  /** Whether the Layout is published now, so an unpublish is offered. */
  readonly published: boolean;
  /**
   * Why the document's writes are held (a past version on screen, a
   * colleague's claim), which holds this action too; absent when it may run.
   */
  readonly heldBecause?: string | undefined;
}

/** Where the dialog is. */
type DialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "checking" }
  | { readonly kind: "checked"; readonly check: RemovalCheck }
  | { readonly kind: "removing"; readonly check: RemovalCheck }
  | { readonly kind: "failed"; readonly message: string };

/** The route's answer, inside the mutation envelope. */
interface Envelope {
  readonly message: string;
  readonly item: RemoveResult;
}

/** One call of Remove Layout. */
function callRemove(
  id: string,
  action: "delete" | "unpublish",
  dryRun: boolean
): Promise<Envelope | undefined> {
  return writePluginRoute<Envelope>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: `/layouts/${encodeURIComponent(id)}/remove`,
    body: { action, dryRun },
  });
}

/** A refusal's own words, or a plain fallback. */
function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : fallback;
}

/**
 * Why the editor holds this document's writes, or `undefined` when Remove
 * Layout may run. Read from the editor's own Delete and Unpublish: a past
 * version on screen, a colleague's claim or a read-only form gives both a
 * reason, and where every write is refused the editor offers neither. One of
 * the two able to run is enough, since the dialog offers whichever applies.
 */
function heldReason(
  actions: Pick<DocumentActions, "actions"> | null
): string | undefined {
  const removals = (actions?.actions ?? []).filter(
    action => action.id === "delete" || action.id === "unpublish"
  );
  if (removals.length === 0) return "This document's changes are on hold.";
  if (removals.some(action => action.disabledReason === undefined)) {
    return undefined;
  }
  return removals[0]?.disabledReason;
}

/**
 * The entry-form toolbar slot: Remove Layout on a saved Layout's own form,
 * nothing on any other. The Layouts collection is matched by the slug the site
 * resolved, renamed or not. What the slot is handed (`context`, a controller
 * field) is not needed; the form says which document it is.
 */
export function RemoveLayoutToolbarSlot(_props: {
  readonly context?: "collection" | "single";
}): JSX.Element | null {
  const identity = useDocumentIdentity();
  const status = useDocumentStatus();
  const actions = useDocumentActions();
  const collection = identity?.kind === "collection";
  const resolved = usePluginRoute<PageCollectionResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PAGE_COLLECTION_ROUTE_PATH,
    enabled: collection,
  });
  const layouts = resolved.data?.layoutsCollection;
  if (
    !collection ||
    layouts === undefined ||
    identity.slug !== layouts ||
    identity.documentId === undefined
  ) {
    return null;
  }
  return (
    <RemoveLayoutAction
      collectionSlug={identity.slug}
      entryId={identity.documentId}
      published={status?.status === "published"}
      heldBecause={heldReason(actions)}
    />
  );
}

/** The button, and the dialog it opens. */
export function RemoveLayoutAction({
  collectionSlug,
  entryId,
  published,
  heldBecause,
}: RemoveLayoutActionProps): JSX.Element | null {
  const [state, setState] = useState<DialogState>({ kind: "closed" });
  // Each opening of the dialog, numbered: an answer that arrives for an
  // earlier one, after the author closed it, changes nothing.
  const opening = useRef(0);
  // Nothing to remove while a Layout is being created.
  if (entryId === null || entryId === "" || entryId === "create") {
    return null;
  }

  /** Set the state, unless the dialog was closed since `asked`. */
  const settle = (asked: number, next: DialogState): void => {
    if (opening.current === asked) setState(next);
  };

  const close = (): void => {
    opening.current += 1;
    setState({ kind: "closed" });
  };

  const open = (): void => {
    opening.current += 1;
    const asked = opening.current;
    setState({ kind: "checking" });
    callRemove(entryId, "delete", true).then(
      answer => {
        const check = answer?.item.check;
        settle(
          asked,
          check === undefined
            ? { kind: "failed", message: "The Layout could not be checked." }
            : { kind: "checked", check }
        );
      },
      (error: unknown) =>
        settle(asked, {
          kind: "failed",
          message: reasonOf(error, "The Layout could not be checked."),
        })
    );
  };

  const confirm = (check: RemovalCheck, action: "delete" | "unpublish") => {
    const asked = opening.current;
    setState({ kind: "removing", check });
    callRemove(entryId, action, false).then(
      () => {
        if (action === "delete") {
          navigateTo(`/admin/collections/${collectionSlug}`);
        } else {
          // The form still holds the published Layout; reading it again
          // shows it unpublished.
          window.location.reload();
        }
      },
      (error: unknown) =>
        settle(asked, {
          kind: "failed",
          message: reasonOf(error, "The Layout could not be removed."),
        })
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={heldBecause !== undefined}
        {...(heldBecause === undefined ? {} : { title: heldBecause })}
        onClick={open}
      >
        Remove Layout…
      </Button>
      <AlertDialog
        open={state.kind !== "closed"}
        onOpenChange={next => {
          if (!next && state.kind !== "removing") close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Layout</AlertDialogTitle>
            <AlertDialogDescription>{describe(state)}</AlertDialogDescription>
          </AlertDialogHeader>
          <DialogBody state={state} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.kind === "removing"}>
              {removable(state) ? "Cancel" : "Close"}
            </AlertDialogCancel>
            {removable(state) ? (
              <ConfirmButtons
                busy={state.kind === "removing"}
                published={published}
                onConfirm={action =>
                  "check" in state ? confirm(state.check, action) : undefined
                }
              />
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Whether the dialog stands in a state that can be confirmed. */
function removable(state: DialogState): boolean {
  if (state.kind === "removing") return true;
  return state.kind === "checked" && blockedBy(state.check) === "nothing";
}

/** What stops this removal, if anything. */
function blockedBy(check: RemovalCheck): "default" | "pages" | "nothing" {
  if (check.isDefault) return "default";
  if (!check.complete || check.pages.length + check.unreadable > 0) {
    return "pages";
  }
  return "nothing";
}

/** The dialog's one sentence for each state. */
function describe(state: DialogState): string {
  switch (state.kind) {
    case "closed":
    case "checking":
      return "Checking which pages use this Layout…";
    case "failed":
      return state.message;
    case "checked":
    case "removing": {
      const blocked = blockedBy(state.check);
      if (blocked === "default") return DEFAULT_LAYOUT_REFUSAL;
      if (blocked === "pages") return PAGES_USE_IT;
      return "No page uses this Layout. Unpublishing takes it off the site and keeps it here; deleting removes it for good.";
    }
  }
}

/** The pages in the way, under the sentence, when there are any. */
function DialogBody({ state }: { state: DialogState }): JSX.Element | null {
  if (state.kind === "failed") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.kind !== "checked" || blockedBy(state.check) !== "pages") {
    return null;
  }
  const { pages, unreadable, complete, pagesCollection } = state.check;
  const counted = pages.length + unreadable;
  return (
    <div className="space-y-2">
      {pages.length > 0 ? (
        <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
          {pages.map(page => (
            <li key={page.id}>
              <a
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={`/admin/collections/${encodeURIComponent(pagesCollection)}/${encodeURIComponent(page.id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {page.title === "" ? "Untitled page" : page.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {unreadable > 0 ? (
        <p className="text-sm text-muted-foreground">
          {unreadable === 1
            ? "And 1 page you can't view."
            : `And ${String(unreadable)} pages you can't view.`}
        </p>
      ) : null}
      {complete ? null : (
        <p className="text-sm text-muted-foreground">
          {`At least ${String(counted)} ${counted === 1 ? "page uses" : "pages use"} this Layout. Not every page could be checked.`}
        </p>
      )}
    </div>
  );
}

/** Unpublish (for a published Layout) and Delete. */
function ConfirmButtons({
  busy,
  published,
  onConfirm,
}: {
  busy: boolean;
  published: boolean;
  onConfirm: (action: "delete" | "unpublish") => void;
}): JSX.Element {
  return (
    <>
      {published ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onConfirm("unpublish")}
        >
          Unpublish
        </Button>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        disabled={busy}
        onClick={() => onConfirm("delete")}
      >
        {busy ? "Removing…" : "Delete Layout"}
      </Button>
    </>
  );
}
