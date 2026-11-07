"use client";

/**
 * The Design section of an entry's side panel: which design the entry is
 * shown with on the site, and the way to give it a design of its own, edit
 * that design or take it away.
 *
 * Declared as a side panel section at the `collection.edit` place, before
 * Status, and above the form on a phone (`narrow: "above-form"`), where the
 * panel opens only from the document's menu. It is offered on every
 * collection's entries, including a
 * collection the Schema Builder adds later, which no list of slugs could
 * name. It applies to an entry whose collection has a template or may have
 * one, and draws nothing for any other, which leaves no section behind.
 *
 * What it shows, from the one read every own-design surface shares:
 *
 * - **Uses the template**: the template's title, and an offer to give the
 *   entry its own design, a copy of the published template.
 * - **Own design, not published**: visitors still see the template, said
 *   plainly; Edit design, and Remove own design… behind a confirmation.
 * - **Own design, published**: visitors see it; the same two actions.
 * - **No published template yet**: the entry is not a page on the site;
 *   the template to open, or one to create where the author may.
 *
 * Whether the entry has its own design is asked of the entry's own lookup
 * (`?entry=`), answered by its key, never read off the collection's list,
 * which is capped. Nothing is drawn until it has answered once: the section applies to
 * some collections and not others, and a placeholder would put a heading on
 * every entry of the ones it does not. The read is cached by collection, so
 * the next entry opens with it in hand.
 *
 * @module admin/EntryDesignSection
 */
import type { DocumentPanelSectionProps } from "@nextlyhq/plugin-sdk/admin";
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
  toast,
} from "@nextlyhq/ui";
import { Brush, Info, LayoutTemplate, Plus, TriangleAlert } from "lucide-react";
import { useState, type JSX, type ReactNode } from "react";

import {
  builderHref,
  designOf,
  OWN_DESIGN_WORDS as WORDS,
  openInAdmin,
  reasonOf,
  runTemplateAction,
  useEntryDesign,
  type EntryDesignItem,
  type EntryDesignsResponse,
} from "./entry-designs-client";
import { OwnDesignPill } from "./OwnDesignPill";

/** Which of its states the section is in. */
export type EntryDesignState =
  | { readonly kind: "uses-template" }
  | { readonly kind: "own"; readonly design: EntryDesignItem }
  | { readonly kind: "no-published-template" }
  | { readonly kind: "not-drawn" };

/**
 * The section's state for `entryId` from the entry's own lookup, never the
 * collection's capped list. Where the templates were withheld from the
 * reader, it says nothing: "no template" would be a claim about what is
 * stored. An own design stands whatever the template's state; without one,
 * a published template draws the entry, a draft one or none leaves it off
 * the site, and a collection that may not have a template gets no section.
 */
export function entryDesignStateOf(
  answer: EntryDesignsResponse,
  entryId: string
): EntryDesignState {
  if (!answer.meta.templateReadable) return { kind: "not-drawn" };
  const design = designOf(answer, entryId);
  if (design !== undefined) return { kind: "own", design };
  const { template, templateAllowed } = answer.meta;
  if (template?.status === "published") return { kind: "uses-template" };
  if (template !== null || templateAllowed) {
    return { kind: "no-published-template" };
  }
  return { kind: "not-drawn" };
}

/** The template visitors see, by its own title, while it is published. */
function liveTemplate(answer: EntryDesignsResponse): string | null {
  const { template } = answer.meta;
  return template?.status === "published" ? template.title : null;
}

/** The side panel section, as the admin draws it for every entry. */
export function EntryDesignSection({
  collectionSlug,
  entryId,
  documentLock,
}: DocumentPanelSectionProps): JSX.Element | null {
  const read = useEntryDesign(collectionSlug, entryId);
  if (read.error !== null && read.data === undefined) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-muted-foreground">{WORDS.loadFailed}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={read.refetch}
        >
          {WORDS.retry}
        </Button>
      </div>
    );
  }
  if (read.data === undefined) return null;
  const answer = read.data;
  const state = entryDesignStateOf(answer, entryId);
  if (state.kind === "not-drawn") return null;
  // A colleague's claim, a past version on screen or a removed collection
  // holds this section's writes as it holds the editor's own Delete.
  const held = documentLock.actionsDisabled;
  const refresh = read.refetch;
  switch (state.kind) {
    case "uses-template":
      return (
        <UsesTemplate
          answer={answer}
          collection={collectionSlug}
          entryId={entryId}
          held={held}
          onChanged={refresh}
        />
      );
    case "own":
      return (
        <OwnDesign
          answer={answer}
          collection={collectionSlug}
          entryId={entryId}
          design={state.design}
          held={held}
          onChanged={refresh}
        />
      );
    case "no-published-template":
      return (
        <NoPublishedTemplate
          answer={answer}
          collection={collectionSlug}
          held={held}
        />
      );
  }
}

/** The section's card: one frame for every state, an own design's outlined. */
function DesignCard({
  own = false,
  children,
}: {
  own?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={[
        "flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-card-foreground",
        own ? "border-primary/40" : "border-border",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/** A small note under the actions: what an act means. */
function Note({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The neutral mark of the collection's template, beside its title. */
function TemplateMark({ label }: { label: string }): JSX.Element {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
      <LayoutTemplate className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** The reason a held action gives, on its control. */
const HELD_REASON = "This document's changes are on hold.";

function UsesTemplate({
  answer,
  collection,
  entryId,
  held,
  onChanged,
}: {
  answer: EntryDesignsResponse;
  collection: string;
  entryId: string;
  held: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const { meta } = answer;
  const template = meta.template;
  const title = template?.title ?? "";

  const give = (): void => {
    setBusy(true);
    runTemplateAction({ kind: "give-entry-design", collection, entry: entryId })
      .then(
        () => {
          toast.success(WORDS.givenToast(title));
          onChanged();
        },
        (error: unknown) =>
          toast.error(reasonOf(error, "The own design couldn't be created."))
      )
      .finally(() => setBusy(false));
  };

  return (
    <DesignCard>
      <div className="flex min-w-0 items-center gap-2">
        <TemplateMark label="Template" />
        <span className="truncate text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {WORDS.usesTemplate(meta.names.singular, title)}
      </p>
      {meta.mayGiveDesign ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy || held}
            {...(held ? { title: HELD_REASON } : {})}
            onClick={give}
          >
            <Brush className="h-4 w-4" aria-hidden="true" />
            {busy ? WORDS.giving : WORDS.give(meta.names.singular)}
          </Button>
          <Note>{WORDS.givenNote}</Note>
        </>
      ) : null}
      {template === null ? null : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto self-start px-0 text-xs"
          onClick={() =>
            openInAdmin(builderHref(meta.templatesCollection, template.id))
          }
        >
          {WORDS.openTemplate(title)}
        </Button>
      )}
    </DesignCard>
  );
}

function OwnDesign({
  answer,
  collection,
  entryId,
  design,
  held,
  onChanged,
}: {
  answer: EntryDesignsResponse;
  collection: string;
  entryId: string;
  design: EntryDesignItem;
  held: boolean;
  onChanged: () => void;
}): JSX.Element {
  const { meta } = answer;
  const template = liveTemplate(answer);
  const published = design.status === "published";
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = (): void => {
    setRemoving(true);
    runTemplateAction({
      kind: "remove-entry-design",
      collection,
      entry: entryId,
    })
      .then(
        () => {
          toast.success(WORDS.removedToast(template));
          setConfirming(false);
          onChanged();
        },
        (error: unknown) =>
          toast.error(reasonOf(error, "The own design couldn't be removed."))
      )
      .finally(() => setRemoving(false));
  };

  return (
    <DesignCard own>
      <div className="flex min-w-0 items-center">
        <OwnDesignPill published={published} template={template} />
      </div>
      {published ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {WORDS.publishedSays(meta.names.singular, template)}
        </p>
      ) : (
        <Alert variant="warning" className="p-2.5">
          <AlertDescription className="flex items-start gap-2 text-xs leading-relaxed">
            <TriangleAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{WORDS.unpublishedWarning(template)}</span>
          </AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        size="sm"
        className="w-full"
        onClick={() =>
          openInAdmin(builderHref(meta.templatesCollection, design.id))
        }
      >
        <Brush className="h-4 w-4" aria-hidden="true" />
        {WORDS.edit}
      </Button>
      {/* The admin's destructive text pairing: the base red is lighter
        than the 4.5:1 text minimum on a light card, so light mode reads its
        darker shade and dark mode the base, which passes there. */}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto self-start px-0 text-xs text-destructive-700 dark:text-destructive"
        disabled={held}
        {...(held ? { title: HELD_REASON } : {})}
        onClick={() => setConfirming(true)}
      >
        {WORDS.remove}
      </Button>
      <p className="text-xs text-muted-foreground">
        {WORDS.goesWithEntry(meta.names.singular)}
      </p>
      <AlertDialog
        open={confirming}
        onOpenChange={next => {
          if (!removing) setConfirming(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {WORDS.removeTitle(meta.names.singular)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {WORDS.removeSays(design.title, template, meta.names.plural)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {WORDS.keep}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={removing}
              onClick={remove}
            >
              {removing ? WORDS.removing : WORDS.removeConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DesignCard>
  );
}

function NoPublishedTemplate({
  answer,
  collection,
  held,
}: {
  answer: EntryDesignsResponse;
  collection: string;
  held: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const { meta } = answer;
  const template = meta.template;

  const create = (): void => {
    setBusy(true);
    runTemplateAction({ kind: "create-template", collection })
      .then(
        result => {
          const id = result?.template?.id;
          if (id !== undefined) {
            openInAdmin(builderHref(meta.templatesCollection, id));
          }
        },
        (error: unknown) =>
          toast.error(reasonOf(error, "The template couldn't be created."))
      )
      .finally(() => setBusy(false));
  };

  return (
    <DesignCard>
      <div className="flex min-w-0 items-center">
        <TemplateMark label={WORDS.noTemplate} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {WORDS.noPublishedTemplate(meta.names.singular, meta.names.plural)}
      </p>
      {template !== null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            openInAdmin(builderHref(meta.templatesCollection, template.id))
          }
        >
          <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
          {WORDS.openTemplate(template.title)}
        </Button>
      ) : meta.mayCreateTemplate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy || held}
          {...(held ? { title: HELD_REASON } : {})}
          onClick={create}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {busy
            ? WORDS.creatingTemplate
            : WORDS.createTemplate(meta.names.plural)}
        </Button>
      ) : null}
    </DesignCard>
  );
}
