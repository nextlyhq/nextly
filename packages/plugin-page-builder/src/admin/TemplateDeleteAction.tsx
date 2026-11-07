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
 *   template again, or, while the template is a draft, stay unshown as they
 *   already are. The entries with an own design are listed as kept, each
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
import { useMemo, useState, type JSX } from "react";

import type { TemplateAction } from "../templates/template-actions-contract";

import { DryRunVerdictWords, useDryRunVerdict } from "./dry-run-verdict";
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
  /** The same delete of a draft template, which shows no entry today. */
  stayUnshown: (plural: string): string =>
    `${plural} without their own design aren't shown as pages now, since this template isn't published. They stay that way until ${plural} have a published template.`,
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
  // Kept as one value while the document is the same, so the dry run is
  // asked once for it and again only on a retry.
  const deletion = useMemo<TemplateAction>(
    () => ({ kind: "delete-template", id: entryId }),
    [entryId]
  );
  const verdict = useDryRunVerdict(
    deletion,
    attempt,
    TEMPLATE_DELETE_WORDS.judgeFailed
  );
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
    runTemplateAction(deletion).then(
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
        {known ? (
          <DryRunVerdictWords verdict={verdict} words={TEMPLATE_DELETE_WORDS} />
        ) : null}
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
  // Only a published template shows entries, so only its delete stops
  // anything: a draft's leaves its entries as unshown as they already are.
  const says =
    meta.template?.status === "published"
      ? TEMPLATE_DELETE_WORDS.stopShown(meta.names.plural)
      : TEMPLATE_DELETE_WORDS.stayUnshown(meta.names.plural);
  return (
    <>
      <Heading
        title={TEMPLATE_DELETE_WORDS.deleteTitle(meta.template?.title ?? "")}
        says={says}
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
