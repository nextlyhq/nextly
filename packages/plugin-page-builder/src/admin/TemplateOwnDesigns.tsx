"use client";

/**
 * A template's own designs: how many of its collection's entries have a
 * design of their own, and which, each row opening that entry.
 *
 * Drawn in two places on the template's own screens:
 *
 * - **Its document panel**, as the "Own designs" section the plugin adds to
 *   the templates collection's panel (`TemplateOwnDesigns`): the count, what
 *   it means, and the list, or that no entry has one.
 * - **The builder's top bar**, as a chip saying the count beside the
 *   document's status (`OwnDesignsChip`), which opens the same list. The
 *   builder takes the window and its panels are the editor's own, so the
 *   list sits under the chip rather than in a side panel of its own.
 *
 * Both draw nothing on an entry's own design, which is a template too: the
 * read answers for the collection whose entry it serves, and its template is
 * another document.
 *
 * @module admin/TemplateOwnDesigns
 */
import {
  useDocumentIdentity,
  usePluginRoute,
  type DocumentPanelSectionProps,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@nextlyhq/ui";
import { Brush, ExternalLink } from "lucide-react";
import { useState, type JSX } from "react";

import {
  PAGE_COLLECTION_ROUTE_PATH,
  type PageCollectionResponse,
} from "../layout-choices-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import {
  editedWhen,
  entryHref,
  OWN_DESIGN_WORDS as WORDS,
  openInAdmin,
  useTemplateDesigns,
  type EntryDesignItem,
  type EntryDesignsResponse,
} from "./entry-designs-client";
import { navigateWithin } from "./plain-click";

/** Whether `answer` is about template `id` as its collection's template. */
function isCollectionTemplate(
  answer: EntryDesignsResponse | undefined,
  id: string
): answer is EntryDesignsResponse {
  return answer !== undefined && answer.meta.template?.id === id;
}

/**
 * Whether there is anything to say beyond "none": own designs listed, or a
 * list the read says may not be the whole, where none listed is not none.
 */
function hasAnyToSay(answer: EntryDesignsResponse): boolean {
  return answer.items.length > 0 || answer.meta.hasNext;
}

/** The count, said as a heading would say it. */
function ownDesignsSummary(answer: EntryDesignsResponse): string {
  const { names } = answer.meta;
  // A list that may not be the whole gives a floor, never an exact count.
  if (answer.meta.hasNext) {
    return WORDS.someHaveOrMore(answer.items.length, names.plural);
  }
  return answer.items.length === 0
    ? WORDS.noneHave(names.singular)
    : WORDS.someHave(answer.items.length, names.singular, names.plural);
}

/** One row: the entry, how its design stands, and the way to it. */
function OwnDesignRow({
  collection,
  item,
  templatePublished,
  now,
}: {
  collection: string;
  item: EntryDesignItem;
  /** Whether the collection's template is published, so visitors see it. */
  templatePublished: boolean;
  now: Date;
}): JSX.Element {
  const href = entryHref(collection, item.entryId);
  // A draft own design's entry is shown with the template while that is
  // published, and not shown as a page at all while it is not.
  const says =
    item.status === "published"
      ? WORDS.rowPublished(editedWhen(item.updatedAt, now))
      : templatePublished
        ? WORDS.rowUnpublished
        : WORDS.rowUnpublishedNoTemplate;
  return (
    <li>
      <a
        href={href}
        {...navigateWithin(href, openInAdmin)}
        className="flex items-center gap-2.5 rounded-md px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/30 dark:bg-primary/20"
        >
          <Brush className="h-3.5 w-3.5" />
        </span>
        {/* Each line is cut to the panel's width, so its full text is
          offered on hover; the link's name is still the whole text. */}
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-semibold text-foreground"
            title={item.title}
          >
            {item.title}
          </span>
          <span
            className="block truncate text-xs text-muted-foreground"
            title={says}
          >
            {says}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {WORDS.open}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </span>
      </a>
    </li>
  );
}

/** The list of own designs, or what it means that there are none. */
function OwnDesignsList({
  answer,
  now = new Date(),
}: {
  answer: EntryDesignsResponse;
  now?: Date;
}): JSX.Element {
  const { meta, items } = answer;
  const templatePublished = meta.template?.status === "published";
  // Said only where the list is the whole: with more possibly unlisted, an
  // empty list does not mean no entry has one.
  const more = meta.hasNext ? (
    <p className="px-2 text-xs text-muted-foreground">{WORDS.notAllListed}</p>
  ) : null;
  if (items.length === 0 && more !== null) return more;
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-2 py-5 text-center text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 place-items-center rounded-lg bg-muted"
        >
          <Brush className="h-4 w-4" />
        </span>
        <p className="font-medium text-foreground">
          {WORDS.noneHave(meta.names.singular)}
        </p>
        <p>
          {templatePublished
            ? WORDS.noneHaveMore(meta.names.singular)
            : WORDS.noneHaveUnpublished(meta.names.plural)}
        </p>
      </div>
    );
  }
  return (
    <>
      <ul
        className="-mx-2 flex flex-col"
        aria-label={ownDesignsSummary(answer)}
      >
        {items.map(item => (
          <OwnDesignRow
            key={item.id}
            collection={meta.collection}
            item={item}
            templatePublished={templatePublished}
            now={now}
          />
        ))}
      </ul>
      {more}
    </>
  );
}

/**
 * The "Own designs" section of a template's document panel. Draws nothing on
 * an entry's own design, or for a reader who may not read the collection.
 */
export function TemplateOwnDesigns({
  entryId,
}: DocumentPanelSectionProps): JSX.Element | null {
  const read = useTemplateDesigns(entryId);
  if (read.data === undefined) {
    if (read.error !== null) {
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
    // The panel's own loading look, a line the size of the summary.
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading own designs</span>
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (!isCollectionTemplate(read.data, entryId)) return null;
  const answer = read.data;
  // With none, the list's empty state says so; with some, the count and
  // what it means come first.
  return (
    <div className="space-y-2">
      {!hasAnyToSay(answer) ? null : (
        <>
          <p className="text-sm font-semibold text-foreground">
            {ownDesignsSummary(answer)}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {WORDS.copiedSays}
          </p>
        </>
      )}
      <OwnDesignsList answer={answer} />
    </div>
  );
}

/**
 * The builder top bar's chip on a collection's template with own designs:
 * the count, opening the list. Nothing on any other document, and nothing
 * while no entry has one.
 */
export function OwnDesignsChip(): JSX.Element | null {
  const identity = useDocumentIdentity();
  const resolved = usePluginRoute<PageCollectionResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PAGE_COLLECTION_ROUTE_PATH,
    enabled: identity?.kind === "collection",
  });
  const templates = resolved.data?.templatesCollection;
  const id =
    identity?.kind === "collection" && identity.slug === templates
      ? identity.documentId
      : undefined;
  const read = useTemplateDesigns(id);
  const [open, setOpen] = useState(false);
  if (id === undefined || !isCollectionTemplate(read.data, id)) return null;
  const answer = read.data;
  if (!hasAnyToSay(answer)) return null;
  const summary = ownDesignsSummary(answer);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[color:var(--nx-builder-border)] px-2.5 text-xs font-semibold text-[color:var(--nx-builder-text)] outline-none hover:bg-[color:var(--nx-builder-surface-raised)] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Brush className="h-3.5 w-3.5" aria-hidden="true" />
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <p className="text-sm font-semibold text-foreground">{summary}</p>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          {WORDS.copiedSays}
        </p>
        <OwnDesignsList answer={answer} />
      </PopoverContent>
    </Popover>
  );
}
