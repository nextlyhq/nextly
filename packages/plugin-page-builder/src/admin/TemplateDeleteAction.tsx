"use client";

/**
 * Delete on a template's document screen, which says what the delete means
 * before it happens, in place of the editor's own.
 *
 * The templates collection holds two kinds of document, and deleting each
 * means something different to the site:
 *
 * - **A collection's template**: its collection's entries without their own
 *   design stop being shown as pages until the collection has a published
 *   template again. The entries with an own design are listed as kept, each
 *   saying whether it is still shown (its design is published) or not until
 *   its design is published.
 * - **An entry's own design**: the entry is shown with its collection's
 *   template again, said as the entry's Design section says it.
 *
 * Which it is, and the own designs, come from the read every own-design
 * surface shares. The delete itself is the template actions route's
 * `delete-template`, judged as the caller like any write; a refusal is shown
 * in the dialog, and a delete that lands leaves the document.
 *
 * Declared as the templates collection's `documentActions.delete`, so the
 * row keeps its place, its permission and every reason it can't run.
 *
 * @module admin/TemplateDeleteAction
 */
import type { DocumentActionReplacementProps } from "@nextlyhq/plugin-sdk/admin";
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

import {
  OWN_DESIGN_WORDS,
  reasonOf,
  runTemplateAction,
  useTemplateDesigns,
  type EntryDesignsResponse,
} from "./entry-designs-client";

/** The dialog's words, beside the ones every own-design surface shares. */
export const TEMPLATE_DELETE_WORDS = {
  checking: "Checking what this template draws…",
  checkFailed: "What this template draws couldn't be checked.",
  deleteTitle: (template: string): string => `Delete the ${template} template?`,
  stopShown: (plural: string): string =>
    `${plural} without their own design stop being shown as pages until ${plural} have a published template again.`,
  keptHeading: (plural: string): string => `${plural} with their own design`,
  kept: (count: number): string => `${String(count)} · kept`,
  stillShown: "Still shown",
  notShown: "Not shown until its design is published",
  keptSays: "Their own designs are kept, and serve them once published.",
  deleteConfirm: "Delete template",
  deleting: "Deleting…",
  plainTitle: "Delete this template?",
  plainSays: "The template and its history are deleted.",
  plainConfirm: "Delete",
  held: "This document's changes are on hold.",
  failed: "The template couldn't be deleted.",
} as const;

/** What the document is, as far as the read can tell. */
export type TemplateDeleteSubject =
  | { readonly kind: "checking" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "collection-template";
      readonly answer: EntryDesignsResponse;
    }
  | {
      readonly kind: "own-design";
      readonly answer: EntryDesignsResponse;
      readonly title: string;
    }
  /** Neither could be told: a template the reader cannot see around. */
  | { readonly kind: "plain" };

/** The document `id` as the read answers it. */
export function templateDeleteSubjectOf(
  answer: EntryDesignsResponse | undefined,
  failed: boolean,
  id: string
): TemplateDeleteSubject {
  if (answer === undefined)
    return failed ? { kind: "failed" } : { kind: "checking" };
  if (answer.meta.template?.id === id) {
    return { kind: "collection-template", answer };
  }
  const design = answer.items.find(item => item.id === id);
  if (design !== undefined) {
    return { kind: "own-design", answer, title: design.title };
  }
  return { kind: "plain" };
}

export function TemplateDeleteAction({
  entryId,
  mayWrite,
  close,
}: DocumentActionReplacementProps): JSX.Element {
  const read = useTemplateDesigns(entryId);
  const subject = templateDeleteSubjectOf(
    read.data,
    read.error !== null,
    entryId
  );
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const confirm = (): void => {
    // Asked at the moment of writing: the document can change hands while
    // the dialog is open.
    if (!mayWrite()) {
      setRefusal(TEMPLATE_DELETE_WORDS.held);
      return;
    }
    setBusy(true);
    setRefusal(null);
    runTemplateAction({ kind: "delete-template", id: entryId }).then(
      () => close("deleted"),
      (error: unknown) => {
        setBusy(false);
        setRefusal(reasonOf(error, TEMPLATE_DELETE_WORDS.failed));
      }
    );
  };

  return (
    <AlertDialog
      open
      onOpenChange={next => {
        if (!next && !busy) close();
      }}
    >
      <AlertDialogContent>
        <DialogWords subject={subject} />
        {subject.kind === "failed" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={read.refetch}
          >
            {OWN_DESIGN_WORDS.retry}
          </Button>
        ) : null}
        {refusal === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {subject.kind === "own-design" ? OWN_DESIGN_WORDS.keep : "Cancel"}
          </AlertDialogCancel>
          {subject.kind === "checking" || subject.kind === "failed" ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={confirm}
            >
              {busy
                ? TEMPLATE_DELETE_WORDS.deleting
                : confirmLabel(subject.kind)}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The confirming button's words, naming the act. */
function confirmLabel(
  kind: "collection-template" | "own-design" | "plain"
): string {
  switch (kind) {
    case "collection-template":
      return TEMPLATE_DELETE_WORDS.deleteConfirm;
    case "own-design":
      return OWN_DESIGN_WORDS.removeConfirm;
    case "plain":
      return TEMPLATE_DELETE_WORDS.plainConfirm;
  }
}

/** The dialog's title, its sentence and, for a template, what it keeps. */
function DialogWords({
  subject,
}: {
  subject: TemplateDeleteSubject;
}): JSX.Element {
  switch (subject.kind) {
    case "checking":
    case "failed":
      return (
        <AlertDialogHeader>
          <AlertDialogTitle>
            {TEMPLATE_DELETE_WORDS.plainTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {subject.kind === "checking"
              ? TEMPLATE_DELETE_WORDS.checking
              : TEMPLATE_DELETE_WORDS.checkFailed}
          </AlertDialogDescription>
        </AlertDialogHeader>
      );
    case "plain":
      return (
        <AlertDialogHeader>
          <AlertDialogTitle>
            {TEMPLATE_DELETE_WORDS.plainTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {TEMPLATE_DELETE_WORDS.plainSays}
          </AlertDialogDescription>
        </AlertDialogHeader>
      );
    case "own-design": {
      const { meta } = subject.answer;
      const template =
        meta.template?.status === "published" ? meta.template.title : null;
      return (
        <AlertDialogHeader>
          <AlertDialogTitle>
            {OWN_DESIGN_WORDS.removeTitle(meta.names.singular)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {OWN_DESIGN_WORDS.removeSays(
              subject.title,
              template,
              meta.names.plural
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
      );
    }
    case "collection-template": {
      const { meta, items } = subject.answer;
      const title = meta.template?.title ?? "";
      return (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {TEMPLATE_DELETE_WORDS.deleteTitle(title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {TEMPLATE_DELETE_WORDS.stopShown(meta.names.plural)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {items.length === 0 ? null : (
            <div className="space-y-2 text-sm">
              <div className="overflow-hidden rounded-md border border-border">
                <p className="flex justify-between gap-3 bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
                  <span>
                    {TEMPLATE_DELETE_WORDS.keptHeading(meta.names.plural)}
                  </span>
                  <span>{TEMPLATE_DELETE_WORDS.kept(items.length)}</span>
                </p>
                <ul
                  className="max-h-48 divide-y divide-border overflow-y-auto"
                  aria-label={TEMPLATE_DELETE_WORDS.keptHeading(
                    meta.names.plural
                  )}
                >
                  {items.map(item => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {item.title}
                      </span>
                      <span
                        className={[
                          "shrink-0 text-xs",
                          item.status === "published"
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {item.status === "published"
                          ? TEMPLATE_DELETE_WORDS.stillShown
                          : TEMPLATE_DELETE_WORDS.notShown}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-muted-foreground">
                {TEMPLATE_DELETE_WORDS.keptSays}
              </p>
            </div>
          )}
        </>
      );
    }
  }
}
