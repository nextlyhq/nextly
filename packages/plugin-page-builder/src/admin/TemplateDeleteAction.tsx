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
 * `delete-template`, judged as the caller like any write. Opening the dialog
 * runs it as a dry run, which rolls the write back, so a delete the site
 * would refuse (a rule or hook of the templates collection, say) is said
 * before the author confirms, and the delete is not offered. The confirmed
 * delete is judged again: a refusal that appears in between is shown in the
 * dialog too, and a delete that lands leaves the document.
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
import { useEffect, useState, type JSX } from "react";

import {
  inSentence,
  OWN_DESIGN_WORDS,
  reasonOf,
  runTemplateAction,
  useTemplateDesigns,
  type EntryDesignItem,
  type EntryDesignsResponse,
} from "./entry-designs-client";

/** The dialog's words, beside the ones every own-design surface shares. */
const TEMPLATE_DELETE_WORDS = {
  checking: "Checking what this template draws…",
  checkFailed: "What this template draws couldn't be checked.",
  judging: "Checking whether it can be deleted…",
  judgeFailed: "Whether it can be deleted couldn't be checked.",
  refused: "This can't be deleted.",
  deleteTitle: (template: string): string => `Delete the ${template} template?`,
  stopShown: (plural: string): string =>
    `${plural} without their own design stop being shown as pages until ${plural} have a published template again.`,
  keptHeading: (plural: string): string => `${plural} with their own design`,
  kept: (count: number): string => `${String(count)} · kept`,
  stillShown: "Still shown",
  notShown: "Not shown until its design is published",
  keptSays: "Their own designs are kept, and serve them once published.",
  keptMore: "And more not listed here.",
  keptUnlisted: (plural: string): string =>
    `Some ${inSentence(plural)} may have their own design that isn't listed here.`,
  deleteConfirm: "Delete template",
  deleting: "Deleting…",
  plainTitle: "Delete this template?",
  plainSays: "The template and its history are deleted.",
  plainConfirm: "Delete",
  held: "This document's changes are on hold.",
  failed: "The template couldn't be deleted.",
} as const;

/** What the document is, as far as the read can tell. */
type TemplateDeleteSubject =
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

/**
 * What the site says of the delete before it is confirmed: the dry run's
 * verdict, made as the caller and rolled back.
 */
type DeleteVerdict =
  | { readonly kind: "judging" }
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly refusals: readonly string[] }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Run the delete of `id` as a dry run, again each time `attempt` changes,
 * and answer its verdict. An answer for an earlier template or attempt,
 * arriving late, changes nothing.
 */
function useDeleteVerdict(id: string, attempt: number): DeleteVerdict {
  const [verdict, setVerdict] = useState<{
    readonly id: string;
    readonly attempt: number;
    readonly verdict: DeleteVerdict;
  } | null>(null);
  useEffect(() => {
    let live = true;
    const settle = (next: DeleteVerdict): void => {
      if (live) setVerdict({ id, attempt, verdict: next });
    };
    runTemplateAction({ kind: "delete-template", id }, true).then(
      result => {
        // An answer without a verdict is not a yes: the delete is offered
        // only on one that says the site would accept it.
        if (result === undefined) {
          settle({
            kind: "failed",
            message: TEMPLATE_DELETE_WORDS.judgeFailed,
          });
        } else if (result.refusals.length > 0) {
          settle({ kind: "refused", refusals: result.refusals });
        } else {
          settle({ kind: "allowed" });
        }
      },
      (error: unknown) =>
        settle({
          kind: "failed",
          message: reasonOf(error, TEMPLATE_DELETE_WORDS.judgeFailed),
        })
    );
    return () => {
      live = false;
    };
  }, [id, attempt]);
  // Until this template's and this attempt's answer lands, it is judging.
  return verdict !== null && verdict.id === id && verdict.attempt === attempt
    ? verdict.verdict
    : { kind: "judging" };
}

/** The document `id` as the read answers it. */
function templateDeleteSubjectOf(
  answer: EntryDesignsResponse | undefined,
  failed: boolean,
  id: string
): TemplateDeleteSubject {
  if (answer === undefined)
    return failed ? { kind: "failed" } : { kind: "checking" };
  if (answer.meta.template?.id === id) {
    return { kind: "collection-template", answer };
  }
  // Asked about an entry's own design, the read answers for that entry
  // alone, by its key: whether this is one never rests on the capped list.
  const design =
    answer.meta.entry === null
      ? undefined
      : answer.items.find(item => item.id === id);
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
  const [attempt, setAttempt] = useState(0);
  const verdict = useDeleteVerdict(entryId, attempt);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const known = subject.kind !== "checking" && subject.kind !== "failed";

  // One Retry asks again whatever failed: the read, the dry run, or both.
  const retry = (): void => {
    if (read.error !== null) read.refetch();
    if (verdict.kind === "failed") setAttempt(attempt + 1);
  };

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
        {known ? <VerdictWords verdict={verdict} /> : null}
        {subject.kind === "failed" || verdict.kind === "failed" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={retry}
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
          {known ? (
            <Button
              type="button"
              variant="destructive"
              // Offered only once the dry run says the site would accept it.
              disabled={busy || verdict.kind !== "allowed"}
              onClick={confirm}
            >
              {busy
                ? TEMPLATE_DELETE_WORDS.deleting
                : confirmLabel(subject.kind)}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The dry run's verdict where it is not a plain yes: said while it is out,
 * the site's own words when it would refuse, or why it couldn't be asked.
 */
function VerdictWords({
  verdict,
}: {
  verdict: DeleteVerdict;
}): JSX.Element | null {
  switch (verdict.kind) {
    case "allowed":
      return null;
    case "judging":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {TEMPLATE_DELETE_WORDS.judging}
        </p>
      );
    case "failed":
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{verdict.message}</AlertDescription>
        </Alert>
      );
    case "refused":
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <p className="font-medium">{TEMPLATE_DELETE_WORDS.refused}</p>
            {verdict.refusals.length === 1 ? (
              <p>{verdict.refusals[0]}</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {verdict.refusals.map((each, index) => (
                  <li key={`${String(index)}-${each}`}>{each}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      );
  }
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

/** A title and its sentence, as every state of the dialog opens. */
function Heading({
  title,
  says,
}: {
  title: string;
  says: string;
}): JSX.Element {
  return (
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>{says}</AlertDialogDescription>
    </AlertDialogHeader>
  );
}

/** The dialog's title, its sentence and, for a template, what it keeps. */
function DialogWords({
  subject,
}: {
  subject: TemplateDeleteSubject;
}): JSX.Element {
  switch (subject.kind) {
    case "checking":
      return (
        <Heading
          title={TEMPLATE_DELETE_WORDS.plainTitle}
          says={TEMPLATE_DELETE_WORDS.checking}
        />
      );
    case "failed":
      return (
        <Heading
          title={TEMPLATE_DELETE_WORDS.plainTitle}
          says={TEMPLATE_DELETE_WORDS.checkFailed}
        />
      );
    case "plain":
      return (
        <Heading
          title={TEMPLATE_DELETE_WORDS.plainTitle}
          says={TEMPLATE_DELETE_WORDS.plainSays}
        />
      );
    case "own-design":
      return <OwnDesignWords answer={subject.answer} title={subject.title} />;
    case "collection-template":
      return <CollectionTemplateWords answer={subject.answer} />;
  }
}

/** Removing an entry's own design, said as its Design section says it. */
function OwnDesignWords({
  answer,
  title,
}: {
  answer: EntryDesignsResponse;
  title: string;
}): JSX.Element {
  const { meta } = answer;
  const template =
    meta.template?.status === "published" ? meta.template.title : null;
  return (
    <Heading
      title={OWN_DESIGN_WORDS.removeTitle(meta.names.singular)}
      says={OWN_DESIGN_WORDS.removeSays(title, template, meta.names.plural)}
    />
  );
}

/** Deleting a collection's template: what stops, and what is kept. */
function CollectionTemplateWords({
  answer,
}: {
  answer: EntryDesignsResponse;
}): JSX.Element {
  const { meta, items } = answer;
  return (
    <>
      <Heading
        title={TEMPLATE_DELETE_WORDS.deleteTitle(meta.template?.title ?? "")}
        says={TEMPLATE_DELETE_WORDS.stopShown(meta.names.plural)}
      />
      {/* Nothing listed is "none kept" only where the list is the whole. */}
      {items.length === 0 && !meta.hasNext ? null : (
        <KeptDesigns answer={answer} />
      )}
    </>
  );
}

/** The own designs a template's delete keeps, each saying if it is shown. */
function KeptDesigns({
  answer,
}: {
  answer: EntryDesignsResponse;
}): JSX.Element {
  const { meta, items } = answer;
  const heading = TEMPLATE_DELETE_WORDS.keptHeading(meta.names.plural);
  return (
    <div className="space-y-2 text-sm">
      {items.length === 0 ? null : (
        <div className="overflow-hidden rounded-md border border-border">
          <p className="flex justify-between gap-3 bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
            <span>{heading}</span>
            <span>{TEMPLATE_DELETE_WORDS.kept(items.length)}</span>
          </p>
          <ul
            className="max-h-48 divide-y divide-border overflow-y-auto"
            aria-label={heading}
          >
            {items.map(item => (
              <KeptDesign key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
      {/* The list may not be the whole: cut at its bound, or read only so
        far. The count above is then a floor, and with none listed the
        dialog still says some may be kept. */}
      {meta.hasNext ? (
        <p className="text-muted-foreground">
          {items.length === 0
            ? TEMPLATE_DELETE_WORDS.keptUnlisted(meta.names.plural)
            : TEMPLATE_DELETE_WORDS.keptMore}
        </p>
      ) : null}
      <p className="text-muted-foreground">{TEMPLATE_DELETE_WORDS.keptSays}</p>
    </div>
  );
}

/** One kept own design: its entry's title, and whether visitors see it. */
function KeptDesign({ item }: { item: EntryDesignItem }): JSX.Element {
  const shown = item.status === "published";
  return (
    // On a phone the status goes under the title rather than beside it, so the
    // title keeps the row's whole width instead of a few letters of it.
    <li className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      {/* Cut to one line in the dialog's narrow list, so the full title is
        offered on hover; the text itself stays whole for a screen reader. */}
      <span
        className="min-w-0 truncate font-medium text-foreground"
        title={item.title}
      >
        {item.title}
      </span>
      <span
        className={[
          "shrink-0 text-xs",
          shown ? "font-semibold text-foreground" : "text-muted-foreground",
        ].join(" ")}
      >
        {shown
          ? TEMPLATE_DELETE_WORDS.stillShown
          : TEMPLATE_DELETE_WORDS.notShown}
      </span>
    </li>
  );
}
