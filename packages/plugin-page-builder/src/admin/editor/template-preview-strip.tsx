"use client";

/**
 * The Previewing strip of a template's editor, pinned above the canvas:
 * "Previewing", then a chip naming the entry the template is drawn with and
 * its status, which opens a picker of the entries the author may preview.
 *
 * Above the canvas rather than in the top bar, so the entry's full title is
 * readable at every width the editor opens at; the top bar keeps the
 * template's own title and status.
 *
 * - The picker searches on the server as the author types, lists the
 *   entries newest first with each one's status and when it was updated,
 *   checks the one being previewed, and offers **New** where the author may
 *   create one: the create screen opens in a new tab, and the list is asked
 *   again when this window regains focus, so the new entry can be picked.
 * - Shift+Alt+Down and Shift+Alt+Up preview the next and the previous entry
 *   in the list's order, wrapping, from the canvas or the panels but never
 *   while typing; each switch is said in a quiet toast.
 * - With no entry to preview, the chip says so, and a notice under the strip
 *   says bound text shows its fallback meanwhile. The words are the same
 *   whether the collection is empty or the author may read none of it.
 *
 * @module template-preview-strip
 */
import { keyHint } from "@nextlyhq/builder";
import {
  PREVIEWED_ENTRY_KEYS,
  PreviewedEntryProvider,
  type PreviewedCollection,
  type PreviewedEntry,
} from "@nextlyhq/builder/shell";
import {
  formatWidgetTime,
  useCurrentUserId,
  useDocumentIdentity,
  useDocumentLocale,
  useWidgetClock,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useShortcuts,
} from "@nextlyhq/ui";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  Info,
  Plus,
  RotateCw,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";
import {
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import {
  TEMPLATE_ENTRY_ID_FIELD,
  TEMPLATE_TARGET_FIELDS,
  type PreviewCollectionLabels,
  type PreviewEntryItem,
} from "../../templates/template-preview-contract";
import { StatusPill } from "../status-pill";
import { listPreviewEntries } from "../template-preview-client";

import { entryCreatePath, entryEditPath } from "./builder-address";
import { CanvasEntryProvider, type CanvasEntryRead } from "./canvas-entry";
import {
  followingCanvas,
  useTemplatePreview,
  type TemplatePreview,
} from "./use-template-preview";

/** How long the picker waits after a keystroke before it searches. */
const SEARCH_DELAY_MS = 200;

/** The toast a switch raises, by one id, so a run of switches shows one. */
const SWITCH_TOAST_ID = "template-preview-switch";

/** A template's preview, for the strip the editor draws into the shell. */
const TemplatePreviewState = createContext<TemplatePreview | undefined>(
  undefined
);

/**
 * The preview of the template being edited, or `undefined` for any other
 * document: the editor draws the strip only where there is one.
 */
export function useTemplatePreviewState(): TemplatePreview | undefined {
  return useContext(TemplatePreviewState);
}

/**
 * The collection the template draws, as its form holds it now: a
 * collection's template names it as `collection`, an entry's own design
 * (whose `collection` is empty) as `entryCollection`.
 */
function useTemplateCollection<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>
): string | undefined {
  const values: unknown[] = useWatch({
    control,
    name: [...TEMPLATE_TARGET_FIELDS] as Path<TFieldValues>[],
  });
  const found = values.find(
    value => typeof value === "string" && value.trim() !== ""
  );
  return typeof found === "string" ? found.trim() : undefined;
}

/**
 * The one entry an entry's own design serves, by its stored id, as the form
 * holds it; `undefined` for a collection's template, which names none.
 */
function useOwnDesignEntry<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>
): string | undefined {
  const value: unknown = useWatch({
    control,
    name: TEMPLATE_ENTRY_ID_FIELD as Path<TFieldValues>,
  });
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * Around a template's editor: reads which entry the template is previewed
 * with, and hands it to the canvas (as the entry it is drawn as), to the
 * builder (as the previewed entry) and to the strip.
 */
export function TemplatePreviewScope<TFieldValues extends FieldValues>({
  control,
  children,
}: {
  readonly control: Control<TFieldValues>;
  readonly children: ReactNode;
}): JSX.Element {
  const collection = useTemplateCollection(control);
  // An entry's own design serves one entry, which it always previews.
  const entry = useOwnDesignEntry(control);
  const identity = useDocumentIdentity();
  const userId = useCurrentUserId();
  // The language the editor edits, as the editor's own reads take it.
  const locale = useDocumentLocale()?.code ?? undefined;
  const read = useTemplatePreview({
    collection,
    templateId:
      identity?.kind === "collection" ? identity.documentId : undefined,
    userId,
    locale,
    entry,
  });
  // The canvas's own read of the entry, heard here and asked again with a
  // retry, so the strip and the seam name an entry only once both the entry
  // and the canvas's read of it have answered.
  const [canvasRead, setCanvasRead] = useState<CanvasEntryRead | undefined>(
    undefined
  );
  const [retry, setRetry] = useState(0);
  const preview = useMemo(
    () => followingCanvas(read, canvasRead, () => setRetry(count => count + 1)),
    [read, canvasRead]
  );
  // The entry the strip names, read by the canvas from the moment it is
  // chosen, so the two never name different entries; none where its own
  // read failed, so bound text draws its fallback as the strip says. Taken
  // from the entry's read alone: the canvas's read follows from it.
  const chip = read.chip;
  const previewedId =
    chip === undefined || chip.unavailable ? undefined : chip.id;
  const canvasIdentity = useMemo(
    (): DocumentIdentity | null =>
      collection === undefined
        ? null
        : {
            kind: "collection",
            slug: collection,
            ...(previewedId === undefined ? {} : { documentId: previewedId }),
          },
    [collection, previewedId]
  );
  // The collection as the builder reads it, for an Entry content block's
  // mark, inspector and canvas notes.
  const previewedCollection = usePreviewedCollectionOf(collection, preview);
  return (
    <TemplatePreviewState.Provider value={preview}>
      <CanvasEntryProvider
        identity={canvasIdentity}
        retry={retry}
        onRead={setCanvasRead}
      >
        <PreviewedEntryProvider
          value={preview.previewed}
          collection={previewedCollection}
        >
          {children}
        </PreviewedEntryProvider>
      </CanvasEntryProvider>
    </TemplatePreviewState.Provider>
  );
}

/**
 * The template's collection as the builder reads it: its names, its
 * top-level blocks fields, and where one of its entries is edited; nothing
 * while the template names no collection.
 */
function usePreviewedCollectionOf(
  collection: string | undefined,
  preview: TemplatePreview
): PreviewedCollection | undefined {
  const { labels, blocksFields } = preview;
  return useMemo(
    (): PreviewedCollection | undefined =>
      collection === undefined
        ? undefined
        : {
            slug: collection,
            singular: inSentence(labels.singular),
            plural: labels.plural,
            blocksFields,
            entryHref: id => entryEditPath(collection, id),
          },
    [collection, labels.singular, labels.plural, blocksFields]
  );
}

/** A label in the words a sentence reads it in: "posts", "post". */
function inSentence(label: string): string {
  return label.toLowerCase();
}

/** "No posts to preview", the same for an empty and an unreadable collection. */
function nothingToPreview(labels: PreviewCollectionLabels): string {
  return `No ${inSentence(labels.plural)} to preview`;
}

/** Open the create screen for the template's collection in a new tab. */
function openNewEntry(collection: string): void {
  // A new tab, so the template stays open; `noopener`, so the new tab holds
  // no handle on this one.
  window.open(entryCreatePath(collection), "_blank", "noopener");
}

/** Whether the strip has nothing to preview, as opposed to not knowing yet. */
function hasNothing(previewed: PreviewedEntry): boolean {
  return previewed.kind === "none" && previewed.reason === "empty";
}

/** The keys that step through the entries, while a list can be stepped. */
function SwitchKeys({ preview }: { readonly preview: TemplatePreview }): null {
  useSwitchKeys(preview);
  return null;
}

/**
 * The keys that step through the entries, registered while the strip is
 * drawn: never while typing in a field or in the page's text, and listed in
 * the editor's shortcuts help.
 */
function useSwitchKeys(preview: TemplatePreview): void {
  const singular = inSentence(preview.labels.singular);
  const switchBy = (by: 1 | -1) => {
    const next = preview.step(by);
    if (next === undefined) return;
    // The admin's own toast, its quiet kind, announced in its live region.
    toast(
      <span>
        Previewing <b className="font-medium">{next.title}</b>
      </span>,
      {
        id: SWITCH_TOAST_ID,
        icon: <Eye aria-hidden="true" className="size-4" />,
      }
    );
  };
  useShortcuts(
    [
      {
        keys: PREVIEWED_ENTRY_KEYS.next,
        description: `Preview the next ${singular}`,
        whenTyping: false,
        run: () => switchBy(1),
      },
      {
        keys: PREVIEWED_ENTRY_KEYS.previous,
        description: `Preview the previous ${singular}`,
        whenTyping: false,
        run: () => switchBy(-1),
      },
    ],
    { name: "Template preview" }
  );
}

/** The strip, as the editor hands it to the shell's canvas strip slot. */
export function TemplatePreviewStrip({
  preview,
}: {
  readonly preview: TemplatePreview;
}): JSX.Element {
  return (
    <div data-template-preview="">
      {/* An own design's one entry is not chosen, so no keys step through. */}
      {preview.fixed ? null : <SwitchKeys preview={preview} />}
      <div className="nx-preview-strip">
        {/* Never dropped: it keeps the template's status and the entry's apart. */}
        <span>Previewing</span>
        {preview.fixed ? (
          <FixedEntry preview={preview} />
        ) : (
          <EntryPicker preview={preview} />
        )}
      </div>
      <PreviewNotice preview={preview} />
    </div>
  );
}

/**
 * The strip's second row, where the canvas draws no entry: there is none to
 * preview (with New where the author may create one), or the one named could
 * not be read (with Try again). Nothing while an entry is previewed.
 */
function PreviewNotice({
  preview,
}: {
  readonly preview: TemplatePreview;
}): JSX.Element | null {
  const { collection, labels, list, chip } = preview;
  const unreadable = chip?.unavailable === true ? chip : undefined;
  if (unreadable === undefined && !hasNothing(preview.previewed)) return null;
  const create =
    unreadable === undefined && list.mayCreate && collection !== undefined
      ? () => openNewEntry(collection)
      : undefined;
  return (
    <div className="nx-preview-notice" role="status">
      <Info aria-hidden="true" size={14} />
      <p>
        {unreadable === undefined
          ? `${nothingToPreview(labels)}. Bound text shows its fallback until there is one.`
          : `${unreadable.title} couldn’t be read. Bound text shows its fallback meanwhile.`}
      </p>
      {unreadable === undefined ? null : (
        <button
          type="button"
          className="nx-preview-notice__action"
          onClick={preview.refresh}
        >
          <RotateCw aria-hidden="true" size={12} />
          Try again
        </button>
      )}
      {create === undefined ? null : (
        <button
          type="button"
          className="nx-preview-notice__action"
          onClick={create}
        >
          <Plus aria-hidden="true" size={12} />
          New {inSentence(labels.singular)}
        </button>
      )}
    </div>
  );
}

/**
 * What the chip says, shown and to a screen reader: the entry previewed and
 * its status, else that the list is on its way, else that there is nothing.
 */
function chipWords(preview: TemplatePreview): {
  readonly name: string;
  readonly shown: string;
} {
  const { chip, labels, previewed } = preview;
  if (chip !== undefined) {
    return {
      name: chip.unavailable
        ? `Previewing ${chip.title}, couldn’t be read`
        : chip.loading
          ? `Previewing ${chip.title}, loading`
          : `Previewing ${chip.title}, ${chip.status}`,
      shown: chip.title,
    };
  }
  if (previewed.kind === "none" && previewed.reason === "loading") {
    return {
      name: `Previewing: loading ${inSentence(labels.plural)}`,
      shown: "Loading…",
    };
  }
  const nothing = nothingToPreview(labels);
  return { name: nothing, shown: nothing };
}

/**
 * An own design's one entry, named as the chip names an entry but not a
 * control: there is nothing to choose, so no chevron and no menu.
 */
function FixedEntry({
  preview,
}: {
  readonly preview: TemplatePreview;
}): JSX.Element {
  const words = chipWords(preview);
  return (
    // Plain words rather than a labelled control: read as they stand, with
    // the full title on hover where the strip cuts it.
    <span className="nx-preview-strip__chip" data-fixed="" title={words.shown}>
      <span className="nx-preview-strip__title">{words.shown}</span>
      <ChipMark preview={preview} />
    </span>
  );
}

/** What follows the chip's title: its status, or that it is loading or unreadable. */
function ChipMark({
  preview,
}: {
  readonly preview: TemplatePreview;
}): JSX.Element | null {
  const { chip } = preview;
  if (chip === undefined) return null;
  if (chip.unavailable) {
    return (
      <span className="nx-preview-strip__unavailable">
        <AlertTriangle aria-hidden="true" size={12} />
        Couldn’t be read
      </span>
    );
  }
  // Not drawn yet: no status is claimed for it.
  if (chip.loading) {
    return <span className="nx-preview-strip__none">Loading…</span>;
  }
  return <StatusPill state={chip.status} size="sm" />;
}

/**
 * The chip and the picker it opens. The chip's title is cut only past the
 * strip's width, with the full title in a tooltip and in its accessible name.
 */
function EntryPicker({
  preview,
}: {
  readonly preview: TemplatePreview;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { chip } = preview;
  const tip = useTitleTip();
  const words = chipWords(preview);
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        tip.hide();
        setOpen(next);
      }}
    >
      <Tooltip
        open={tip.shown && !open}
        onOpenChange={next => {
          if (!next) tip.hide();
        }}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-preview-strip__chip"
              aria-haspopup="listbox"
              aria-label={words.name}
              {...tip.triggerHandlers}
            >
              {chip === undefined ? (
                <span className="nx-preview-strip__none">{words.shown}</span>
              ) : (
                <>
                  <span ref={tip.title} className="nx-preview-strip__title">
                    {chip.title}
                  </span>
                  <ChipMark preview={preview} />
                </>
              )}
              <ChevronDown
                aria-hidden="true"
                size={12}
                className="nx-preview-strip__chevron"
              />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {chip === undefined ? null : (
          <TooltipContent>{chip.title}</TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        align="start"
        className="nx-preview-picker w-[26.25rem] max-w-[calc(100vw-2rem)] p-0"
        // Focus returned to the chip as the picker closes is not the author
        // arriving on it, so it opens no tooltip.
        onCloseAutoFocus={tip.focusReturning}
      >
        {open ? (
          <PickerBody preview={preview} onDone={() => setOpen(false)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chip's full-title tooltip, offered only while the title is cut (one
 * repeating the chip's own words says nothing): on hover, and on a focus the
 * keyboard brings, never on a focus a click brings or the focus handed back
 * as the picker closes.
 */
function useTitleTip(): {
  readonly title: RefObject<HTMLSpanElement | null>;
  readonly shown: boolean;
  readonly hide: () => void;
  readonly focusReturning: () => void;
  readonly triggerHandlers: {
    readonly onPointerEnter: () => void;
    readonly onPointerLeave: () => void;
    readonly onPointerDown: () => void;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
  };
} {
  const title = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(false);
  // Whether the next focus comes from a pointer, or is handed back.
  const byPointer = useRef(false);
  const handedBack = useRef(false);
  const cut = () => {
    const element = title.current;
    return element !== null && element.scrollWidth > element.clientWidth;
  };
  const hide = () => setShown(false);
  return {
    title,
    shown,
    hide,
    focusReturning: () => {
      handedBack.current = true;
    },
    triggerHandlers: {
      onPointerEnter: () => setShown(cut()),
      onPointerLeave: hide,
      onPointerDown: () => {
        byPointer.current = true;
      },
      onFocus: () => {
        const quiet = byPointer.current || handedBack.current;
        byPointer.current = false;
        handedBack.current = false;
        if (!quiet && cut()) setShown(true);
      },
      onBlur: hide,
    },
  };
}

/**
 * The rows a search finds, asked of the server once typing pauses; the list
 * already read while there is no search. Asked again whenever that list is,
 * so a focus that refreshed it refreshes a search too.
 */
function useSearchedRows(
  preview: TemplatePreview,
  search: string
): { readonly rows: readonly PreviewEntryItem[]; readonly searching: boolean } {
  const query = search.trim();
  const [found, setFound] = useState<{
    readonly query: string;
    readonly rows: readonly PreviewEntryItem[];
  } | null>(null);
  const { collection, language } = preview;
  const listed = preview.list.items;
  useEffect(() => {
    if (query === "" || collection === undefined) return;
    let current = true;
    const wait = setTimeout(() => {
      listPreviewEntries({
        collection,
        search: query,
        ...(language === undefined ? {} : { locale: language }),
      }).then(
        answer => {
          if (current) setFound({ query, rows: answer.items });
        },
        () => {
          if (current) setFound({ query, rows: [] });
        }
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [query, collection, language, listed]);
  if (query === "") return { rows: listed, searching: false };
  return found?.query === query
    ? { rows: found.rows, searching: false }
    : { rows: found?.rows ?? [], searching: true };
}

/** The picker's search, its rows and its foot. */
function PickerBody({
  preview,
  onDone,
}: {
  readonly preview: TemplatePreview;
  readonly onDone: () => void;
}): JSX.Element {
  const [search, setSearch] = useState("");
  const { rows, searching } = useSearchedRows(preview, search);
  const now = useWidgetClock();
  const { labels, collection } = preview;
  const current = preview.chip?.id;
  const plural = inSentence(labels.plural);
  return (
    // The server searches, so the list is shown as it answers.
    <Command
      shouldFilter={false}
      label={`Choose a ${inSentence(labels.singular)} to preview`}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={`Search ${plural}`}
        className="h-10"
      />
      <CommandList
        className="nx-preview-picker__list"
        aria-label={labels.plural}
      >
        {rows.length === 0 ? (
          <div className="nx-preview-picker__empty">
            {emptyWords(preview, search, searching)}
          </div>
        ) : (
          rows.map(row => (
            <PickerRow
              key={row.id}
              row={row}
              current={row.id === current}
              now={now}
              onChoose={() => {
                preview.choose(row);
                onDone();
              }}
            />
          ))
        )}
      </CommandList>
      <PickerFooter
        labels={labels}
        create={
          preview.list.mayCreate && collection !== undefined
            ? () => openNewEntry(collection)
            : undefined
        }
      />
    </Command>
  );
}

/** What the picker says with no row to show: loading, nothing, or no match. */
function emptyWords(
  preview: TemplatePreview,
  search: string,
  searching: boolean
): string {
  const plural = inSentence(preview.labels.plural);
  if (search.trim() !== "") {
    return searching ? "Searching…" : `No ${plural} match`;
  }
  return preview.list.state === "loading"
    ? `Loading ${plural}…`
    : nothingToPreview(preview.labels);
}

/** One entry in the picker: the check, the title, the status, the time. */
function PickerRow({
  row,
  current,
  now,
  onChoose,
}: {
  readonly row: PreviewEntryItem;
  readonly current: boolean;
  readonly now: number;
  readonly onChoose: () => void;
}): JSX.Element {
  return (
    <CommandItem
      value={row.id}
      onSelect={onChoose}
      className="nx-preview-picker__row"
      {...(current ? { "data-current": "" } : {})}
    >
      <span aria-hidden="true">
        {current ? <Check className="size-4" /> : null}
      </span>
      <span className="nx-preview-picker__row-title" title={row.title}>
        {row.title}
        {/* The check said in words, since a check alone is not read out. */}
        {current ? <span className="sr-only">, previewing</span> : null}
      </span>
      <StatusPill state={row.status} size="sm" />
      {/* Relative while recent, then the date, as the admin's lists word it. */}
      <span className="nx-preview-picker__when">
        {row.updatedAt === null ? "" : formatWidgetTime(row.updatedAt, now)}
      </span>
    </CommandItem>
  );
}

/** The picker's foot: the switching keys, and New where the author may create. */
function PickerFooter({
  labels,
  create,
}: {
  readonly labels: PreviewCollectionLabels;
  readonly create: (() => void) | undefined;
}): JSX.Element {
  // As this keyboard spells them: ⌥⇧↓ on a Mac, Alt+Shift+↓ elsewhere.
  const next = keyHint(PREVIEWED_ENTRY_KEYS.next);
  const previous = keyHint(PREVIEWED_ENTRY_KEYS.previous);
  return (
    <div className="nx-preview-picker__footer">
      {next === null || previous === null ? null : (
        <>
          <span className="nx-preview-picker__keys">
            <kbd>{previous}</kbd>
            <kbd>{next}</kbd>
          </span>
          <span>to switch</span>
        </>
      )}
      {create === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-preview-picker__new"
          onClick={create}
        >
          <Plus aria-hidden="true" className="size-4" />
          New {inSentence(labels.singular)}
        </Button>
      )}
    </div>
  );
}
