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
 * Mounted under the Layout's edit form (`views.layouts.afterEdit`), as a
 * section of its own, apart from the fields an author edits every day.
 *
 * @module admin/RemoveLayoutAction
 */
import { navigateTo, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
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
import { useState, type JSX } from "react";

import type {
  RemovalCheck,
  RemoveResult,
} from "../layout-removal/remove-layout";
import { DEFAULT_LAYOUT_REFUSAL, PAGES_USE_IT } from "../layout-removal/words";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** What the admin hands a component mounted beside an edit form. */
export interface RemoveLayoutActionProps {
  readonly collectionSlug?: string;
  readonly entryId?: string;
  readonly entry?: { readonly status?: unknown } | null;
  readonly documentLock?: { readonly actionsDisabled?: boolean };
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

/** The section under the form, and the dialog its button opens. */
export function RemoveLayoutAction({
  collectionSlug,
  entryId,
  entry,
  documentLock,
}: RemoveLayoutActionProps): JSX.Element | null {
  const [state, setState] = useState<DialogState>({ kind: "closed" });
  // Nothing to remove while a Layout is being created.
  if (entryId === undefined || entryId === "" || entryId === "create") {
    return null;
  }
  const published = entry?.status === "published";

  const open = (): void => {
    setState({ kind: "checking" });
    callRemove(entryId, "delete", true).then(
      answer => {
        const check = answer?.item.check;
        setState(
          check === undefined
            ? { kind: "failed", message: "The Layout could not be checked." }
            : { kind: "checked", check }
        );
      },
      (error: unknown) =>
        setState({
          kind: "failed",
          message: reasonOf(error, "The Layout could not be checked."),
        })
    );
  };

  const confirm = (check: RemovalCheck, action: "delete" | "unpublish") => {
    setState({ kind: "removing", check });
    callRemove(entryId, action, false).then(
      () => {
        if (action === "delete") {
          navigateTo(`/admin/collections/${collectionSlug ?? "layouts"}`);
        } else {
          // The form below still holds the published Layout; reading it
          // again shows it unpublished.
          window.location.reload();
        }
      },
      (error: unknown) =>
        setState({
          kind: "failed",
          message: reasonOf(error, "The Layout could not be removed."),
        })
    );
  };

  return (
    <section
      aria-labelledby="remove-layout-heading"
      className="mt-6 flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="space-y-1">
        <h2 id="remove-layout-heading" className="text-sm font-semibold">
          Remove this Layout
        </h2>
        <p className="text-sm text-muted-foreground">
          {
            "Unpublish or delete it once no page uses it and it isn't the site's default."
          }
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={documentLock?.actionsDisabled === true}
        onClick={open}
      >
        Remove Layout…
      </Button>
      <AlertDialog
        open={state.kind !== "closed"}
        onOpenChange={next => {
          if (!next && state.kind !== "removing") setState({ kind: "closed" });
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
    </section>
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
