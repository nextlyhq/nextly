"use client";

/**
 * A bound image's Fallback: what visitors see when the bound field has no
 * picture to give.
 *
 * An image's fallback is either an image address (`https://…`, `http://…` or
 * a path on the site) or a media id, a file chosen from the media library:
 * the two values the engine draws an image fallback from. Read by the
 * engine's own reading of an image value (`imageValueOf`), so the row and a
 * visitor's page agree on which one is stored.
 *
 * - An address is typed into the row's field, and anything that is not one is
 *   held back with the reason, rather than saving a fallback the page would
 *   ignore. A stored address is shown with a small picture of it and the
 *   address itself, cut where the inspector is narrow; the whole of it is on
 *   the field's tooltip and in its accessible name.
 * - A media id is shown by its file's picture and name, read through the
 *   host's `readMedia`, never as the raw id, with a button that removes it.
 *
 * The library button in the row's actions opens a popover anchored on the
 * row: the newest images, a search by name, and "Browse all…" for the host's
 * full media dialog. An image address typed or pasted into its search is
 * offered as "Use this address", which is how an address replaces a file.
 * Every way of filling the row writes through `onFallback` alone: a media id
 * from the grid or the dialog, an address from the field or the search.
 *
 * @module image-binding-fallback
 */
import { imageValueOf, type Binding } from "@nextlyhq/blocks-engine";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { Images, Search, X } from "lucide-react";
import * as React from "react";

import {
  useMediaSummary,
  type ContentServices,
  type FoundMedia,
  type MediaPickerProps,
} from "./content-controls";

/** What an image's Fallback row is given. */
export interface ImageBindingFallbackProps {
  /** The image prop's binding, whose `fallback` the row shows and edits. */
  readonly binding: Binding;
  /** Store a fallback: an image address, a media id, or `""` for none. */
  readonly onFallback: (value: string) => void;
  /**
   * The host's services: the library search and dialog the row's library
   * button opens, and the read that names a chosen file.
   */
  readonly services: ContentServices | undefined;
  readonly disabled?: boolean;
  /** The id of the prop's name, which the row is about. */
  readonly describedBy?: string;
  /**
   * When the fallback is shown, as the library picker's hint says it:
   * "Shown when a post has no cover image." Plain words that fit every
   * binding when absent.
   */
  readonly shownWhen?: string;
}

/** What the row says of a typed value that is not an image address. */
const NOT_AN_ADDRESS =
  "Enter an image address: one starting https:// or http://, or a path on this site such as /media/spring.jpg.";

/** The picker's hint where the binding's own words are not given. */
const SHOWN_WHEN = "Shown when the bound field has no image.";

/** What the library button, its tooltip and the search are called. */
const CHOOSE_FROM_LIBRARY = "Choose from library";
// The search takes an image address as well, so it says so where the author
// types: the picker has no other place to paste one.
const FIND_IN_LIBRARY = "Find an image, or paste an address";

/** How long the search waits after a keystroke before it asks the library. */
const SEARCH_DELAY_MS = 200;

/** The picker's grid columns, which the up and down arrows move by. */
const COLUMNS = 3;

/** How many empty tiles stand in for the images while they are read. */
const LOADING_TILES = 6;

/**
 * Whether a value is an image address, by the engine's own reading of an
 * image value: the same one a visitor's page draws a fallback by.
 */
function isImageAddress(value: string): boolean {
  return imageValueOf(value)?.holds === "address";
}

/** The binding's fallback as text, or `""` for none. */
function storedFallback(binding: Binding): string {
  return "fallback" in binding && typeof binding.fallback === "string"
    ? binding.fallback
    : "";
}

/** A stored fallback's media id, when it holds one rather than an address. */
function storedMediaId(stored: string): string | undefined {
  const read = imageValueOf(stored);
  return read?.holds === "media" ? read.value : undefined;
}

/** A found image as the picker names it: its file, else its alt text. */
function mediaLabel(media: FoundMedia): string {
  return media.name ?? media.alt ?? "Untitled image";
}

/** A bound image's Fallback row. */
export function ImageBindingFallback({
  binding,
  onFallback,
  services,
  disabled = false,
  describedBy,
  shownWhen = SHOWN_WHEN,
}: ImageBindingFallbackProps): React.JSX.Element {
  const id = React.useId();
  const errorId = React.useId();
  const stored = storedFallback(binding);
  const mediaId = storedMediaId(stored);
  const [refusal, setRefusal] = React.useState(false);
  // The library popover, and the host's full dialog, each while open.
  const [picking, setPicking] = React.useState(false);
  const [browsing, setBrowsing] = React.useState(false);
  const focusAddress = useFocusAfterRemove(id, mediaId);
  const searchMedia = services?.searchMedia;
  const Picker = services?.MediaPicker;
  // A pick of the value already stored writes nothing, so it adds no edit
  // to the history.
  // A refusal said of a typed address goes with any pick: the row now holds
  // the chosen file or address, which the refusal was not about.
  const choose = (value: string): void => {
    setRefusal(false);
    if (value !== stored) onFallback(value);
  };
  const openDialog = (): void => {
    setPicking(false);
    setBrowsing(true);
  };
  const libraryButton = (
    <LibraryButton
      searchable={searchMedia !== undefined}
      dialog={Picker !== undefined}
      open={picking}
      disabled={disabled}
      onDialog={openDialog}
    />
  );

  return (
    <div className="nx-binding__fallback nx-image-fallback">
      <FallbackLabel id={id} fromLibrary={mediaId !== undefined} />
      <Popover open={picking} onOpenChange={setPicking}>
        {/* The popover opens under the whole row, not the small button. */}
        <PopoverAnchor asChild>
          <div className="nx-image-fallback__value">
            {mediaId === undefined ? (
              <AddressField
                id={id}
                errorId={errorId}
                stored={stored}
                disabled={disabled}
                describedBy={describedBy}
                refusal={refusal}
                onRefusal={setRefusal}
                onFallback={onFallback}
              />
            ) : (
              <LibraryFallback
                mediaId={mediaId}
                read={services?.readMedia}
                disabled={disabled}
                describedBy={describedBy}
                onRemove={() => {
                  focusAddress.current = true;
                  onFallback("");
                }}
                // Inside the file's box, beside Remove: the name gets the
                // width the button would take beside it.
                libraryButton={libraryButton}
              />
            )}
            {/* The row's other way to fill it: the media library. Not drawn
                while empty, nor beside a chosen file, whose box holds it. */}
            <div
              className="nx-image-fallback__actions"
              data-fallback-actions=""
            >
              {mediaId === undefined ? libraryButton : null}
            </div>
          </div>
        </PopoverAnchor>
        {searchMedia === undefined ? null : (
          <PopoverContent
            align="end"
            className="nx-binding-popover nx-library-pick"
          >
            <LibraryPicker
              search={searchMedia}
              current={stored.trim()}
              shownWhen={shownWhen}
              onPick={value => {
                setPicking(false);
                choose(value);
              }}
              onBrowse={Picker === undefined ? undefined : openDialog}
            />
          </PopoverContent>
        )}
      </Popover>
      <BrowseDialog
        Picker={browsing ? Picker : undefined}
        mediaId={mediaId}
        onOpenChange={setBrowsing}
        onChoose={choose}
      />
      {refusal ? (
        <p className="nx-inspector__error" id={errorId} role="alert">
          {NOT_AN_ADDRESS}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A flag Remove sets, so the address field drawn in the file's place takes
 * focus rather than leaving it on a button that is gone.
 */
function useFocusAfterRemove(
  id: string,
  mediaId: string | undefined
): React.MutableRefObject<boolean> {
  const focusAddress = React.useRef(false);
  React.useEffect(() => {
    if (mediaId !== undefined || !focusAddress.current) return;
    focusAddress.current = false;
    document.getElementById(id)?.focus();
  }, [mediaId, id]);
  return focusAddress;
}

/**
 * The row's name: the address field's label, or, beside a library file whose
 * group carries "Fallback" in its own name, a word not read twice.
 */
function FallbackLabel({
  id,
  fromLibrary,
}: {
  id: string;
  fromLibrary: boolean;
}): React.JSX.Element {
  return fromLibrary ? (
    <span className="nx-binding__fallback-label" aria-hidden="true">
      Fallback
    </span>
  ) : (
    <label className="nx-binding__fallback-label" htmlFor={id}>
      Fallback
    </label>
  );
}

/**
 * The address field, with a small picture of a stored address inside its
 * start. A typed value is committed on Enter or on leaving the field, and one
 * that is not an image address is held back, `refusal` said under the row.
 */
function AddressField({
  id,
  errorId,
  stored,
  disabled,
  describedBy,
  refusal,
  onRefusal,
  onFallback,
}: {
  id: string;
  errorId: string;
  stored: string;
  disabled: boolean;
  describedBy: string | undefined;
  refusal: boolean;
  onRefusal: (refused: boolean) => void;
  onFallback: (value: string) => void;
}): React.JSX.Element {
  // The address whose picture would not load, so a broken one draws no
  // empty frame; another address is tried afresh.
  const [broken, setBroken] = React.useState<string>();
  const pictured = isImageAddress(stored) && broken !== stored;
  const commit = (typed: string): void => {
    const next = typed.trim();
    // Held back rather than saved: the field takes an image address only,
    // and a media id is chosen from the library, never typed.
    const refused = next !== stored && next !== "" && !isImageAddress(next);
    onRefusal(refused);
    if (!refused && next !== stored) onFallback(next);
  };
  const described = [describedBy, refusal ? errorId : undefined]
    .filter(Boolean)
    .join(" ");
  const whole = stored === "" ? undefined : `Fallback: ${stored}`;
  return (
    <div
      className="nx-image-fallback__address"
      data-pictured={pictured ? "" : undefined}
    >
      {pictured ? (
        // Decorative: the address beside it says which picture it is.
        <img
          className="nx-image-fallback__thumb"
          src={stored}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(stored)}
        />
      ) : null}
      <Input
        id={id}
        // Remounted for a fallback changed elsewhere (an undo, the library),
        // so the field never shows a stale address.
        key={stored}
        defaultValue={stored}
        placeholder="https://… or /media/…"
        spellCheck={false}
        disabled={disabled}
        // The whole address, which the field cuts where it is narrow.
        title={whole}
        aria-label={whole}
        aria-invalid={refusal ? true : undefined}
        aria-describedby={described === "" ? undefined : described}
        onChange={() => {
          if (refusal) onRefusal(false);
        }}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/**
 * The library button: the popover's trigger where the host can search the
 * library, else straight to its dialog, else none, so nothing is offered
 * that does nothing.
 */
function LibraryButton({
  searchable,
  dialog,
  open,
  disabled,
  onDialog,
}: {
  searchable: boolean;
  dialog: boolean;
  open: boolean;
  disabled: boolean;
  onDialog: () => void;
}): React.JSX.Element | null {
  if (!searchable && !dialog) return null;
  const button = (
    <button
      type="button"
      className="nx-image-fallback__library"
      aria-label={CHOOSE_FROM_LIBRARY}
      title={CHOOSE_FROM_LIBRARY}
      disabled={disabled}
      data-open={open ? "" : undefined}
      onClick={searchable ? undefined : onDialog}
    >
      <Images aria-hidden="true" size={14} />
    </button>
  );
  return searchable ? (
    <PopoverTrigger asChild>{button}</PopoverTrigger>
  ) : (
    button
  );
}

/**
 * The host's full media dialog, images only. Given a `Picker` only while
 * open, so each opening starts from what the row stores now rather than from
 * the dialog's last choice.
 */
function BrowseDialog({
  Picker,
  mediaId,
  onOpenChange,
  onChoose,
}: {
  Picker: React.ComponentType<MediaPickerProps> | undefined;
  mediaId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onChoose: (mediaId: string) => void;
}): React.JSX.Element | null {
  if (Picker === undefined) return null;
  return (
    <Picker
      open
      onOpenChange={onOpenChange}
      title="Choose a fallback image"
      accept="image/*"
      initialSelectedIds={new Set(mediaId === undefined ? [] : [mediaId])}
      onSelect={media => {
        const first = media[0];
        // Closed here: the dialog leaves closing to whoever opened it.
        onOpenChange(false);
        if (first !== undefined) onChoose(first.id);
      }}
    />
  );
}

/**
 * A fallback chosen from the library, in the address field's place: the
 * file's picture and name as the host reads them by its id, never the id. A
 * neutral picture and "Library image" while it is read (or where the host
 * reads none), and a plain sentence for a file the library no longer has.
 */
function LibraryFallback({
  mediaId,
  read,
  disabled,
  describedBy,
  onRemove,
  libraryButton,
}: {
  mediaId: string;
  read: ContentServices["readMedia"];
  disabled: boolean;
  describedBy: string | undefined;
  onRemove: () => void;
  /** The way to choose another file, drawn at the box's end. */
  libraryButton: React.ReactNode;
}): React.JSX.Element {
  const summary = useMediaSummary(read, mediaId);
  const name =
    summary === null
      ? // A read that answers nothing may be a file removed or a read that
        // failed for now: the row says neither, only that it can't be shown.
        "A library image that can't be shown"
      : (summary?.name ?? summary?.alt ?? "Library image");
  const label = `Fallback: ${name}`;
  return (
    <div
      className="nx-image-fallback__media"
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      title={label}
      data-missing={summary === null ? "" : undefined}
    >
      {summary?.thumbnail === undefined ? (
        <span
          className="nx-image-fallback__media-thumb"
          data-neutral=""
          aria-hidden="true"
        />
      ) : (
        // Decorative: the name beside it says which file it is.
        <img
          className="nx-image-fallback__media-thumb"
          src={summary.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <MiddleCut text={name} className="nx-image-fallback__media-name" />
      <button
        type="button"
        className="nx-image-fallback__clear"
        aria-label="Remove fallback"
        title="Remove fallback"
        disabled={disabled}
        onClick={onRemove}
      >
        <X aria-hidden="true" size={12} />
      </button>
      {libraryButton}
    </div>
  );
}

/** How many letters before a file's extension stay whole with it. */
const KEPT_BEFORE_EXTENSION = 3;
/** The longest ending read as an extension (".webp" and its dot is 5). */
const LONGEST_EXTENSION = 6;

/**
 * A file name split into the start that may be cut and the end kept whole:
 * its extension and the few characters before it, or its last few where it
 * has no extension; `undefined` for a name too short to cut, whose start
 * would be all but gone. Counted in code points, never UTF-16 units, so an
 * emoji or another astral character is never split in two.
 */
function splitForCut(
  name: string
): { readonly head: string; readonly tail: string } | undefined {
  const chars = Array.from(name);
  const dot = chars.lastIndexOf(".");
  const at =
    dot > 0 && chars.length - dot <= LONGEST_EXTENSION
      ? Math.max(0, dot - KEPT_BEFORE_EXTENSION)
      : chars.length - LONGEST_EXTENSION;
  if (at <= KEPT_BEFORE_EXTENSION) return undefined;
  return { head: chars.slice(0, at).join(""), tail: chars.slice(at).join("") };
}

/**
 * A file name cut in its middle where it is drawn narrow, its start and its
 * end kept ("spring-ba…ner.jpg"): files are told apart by their start, and
 * the end carries the extension. The start shrinks with an ellipsis; the end
 * is never cut. The whole name is on the tooltip and in the accessible name
 * of what holds it, so this is hidden from assistive technology.
 */
function MiddleCut({
  text,
  className,
}: {
  text: string;
  className: string;
}): React.JSX.Element {
  const split = splitForCut(text);
  return (
    <span className={`${className} nx-middle-cut`} aria-hidden="true">
      <span className="nx-middle-cut__head">{split?.head ?? text}</span>
      {split === undefined ? null : (
        <span className="nx-middle-cut__tail">{split.tail}</span>
      )}
    </span>
  );
}

/** One choice in the picker: an address typed into the search, or a file. */
type PickOption =
  | { readonly kind: "address"; readonly value: string; readonly label: string }
  | {
      readonly kind: "media";
      readonly value: string;
      readonly label: string;
      readonly media: FoundMedia;
    };

/** Where the library's answer to the current search stands. */
type Found =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly items: readonly FoundMedia[] }
  | { readonly state: "failed" };

/**
 * The option an arrow key moves to in a grid of `COLUMNS`, from `at`, with
 * `last` the last option's index; `undefined` for a key that is not a move.
 * Down from the last row's start goes to the last option, so a short last
 * row is still reached.
 */
function movedTo(key: string, at: number, last: number): number | undefined {
  switch (key) {
    case "ArrowRight":
      return Math.min(at + 1, last);
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "ArrowDown":
      return Math.min(at + COLUMNS, last);
    case "ArrowUp":
      return at - COLUMNS < 0 ? at : at - COLUMNS;
    default:
      return undefined;
  }
}

/**
 * Where an arrow key moves the active option, or `undefined` where the key
 * is left to the search: an address being edited keeps its arrows for the
 * caret, and so does a modified arrow, which selects text.
 */
function gridMove(
  event: React.KeyboardEvent,
  at: number,
  count: number,
  editingAddress: boolean
): number | undefined {
  const modified =
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (editingAddress || modified || count === 0) return undefined;
  return movedTo(event.key, at, count - 1);
}

/** The image address the search holds, when it holds one. */
function addressIn(query: string): string | undefined {
  const read = imageValueOf(query);
  return read?.holds === "address" ? read.value : undefined;
}

/**
 * What the picker offers: an address in the search as itself, else the
 * images the library found for it.
 */
function pickOptions(
  address: string | undefined,
  found: Found
): readonly PickOption[] {
  if (address !== undefined) {
    return [{ kind: "address", value: address, label: "Use this address" }];
  }
  if (found.state !== "ready") return [];
  return found.items.map(media => ({
    kind: "media",
    value: media.id,
    label: mediaLabel(media),
    media,
  }));
}

/**
 * What the picker says in place of images: that the library could not be
 * read, or that the search found none, with what was searched.
 */
function pickerMessage(
  address: string | undefined,
  found: Found,
  wanted: string
): { readonly role: "alert" | "status"; readonly text: string } | null {
  if (address !== undefined) return null;
  if (found.state === "failed") {
    return { role: "alert", text: "Couldn't read the media library." };
  }
  if (found.state !== "ready" || found.items.length > 0) return null;
  return {
    role: "status",
    text:
      wanted === ""
        ? "The media library has no images yet."
        : `No images match “${wanted}”.`,
  };
}

/**
 * The library's answer to `query`: the first, the newest images, asked at
 * once, and a later one after a pause in typing, each aborting the one
 * before it so an older answer never lands over a newer one. Nothing is
 * asked while the search holds an image address.
 */
function useLibrarySearch(
  search: NonNullable<ContentServices["searchMedia"]>,
  query: string,
  address: string | undefined
): Found {
  const [found, setFound] = React.useState<Found>({ state: "loading" });
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (address !== undefined) return;
    const controller = new AbortController();
    const settle = (next: Found): void => {
      if (!controller.signal.aborted) setFound(next);
    };
    const timer = window.setTimeout(
      () => {
        setFound({ state: "loading" });
        void search(query.trim(), controller.signal).then(
          items => settle({ state: "ready", items }),
          () => settle({ state: "failed" })
        );
      },
      asked.current ? SEARCH_DELAY_MS : 0
    );
    asked.current = true;
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, query, address]);
  return found;
}

/**
 * The library picker inside the popover: a search, a grid of the images it
 * finds, and a hint with the way to the host's full dialog.
 *
 * Focus stays in the search, and the active option is named by
 * `aria-activedescendant`, so typing keeps working while the arrows move
 * through the grid, as the inspector's other pickers do. The file the row
 * stores is marked selected.
 */
function LibraryPicker({
  search,
  current,
  shownWhen,
  onPick,
  onBrowse,
}: {
  search: NonNullable<ContentServices["searchMedia"]>;
  /** The stored fallback, marked where the grid shows it. */
  current: string;
  shownWhen: string;
  /** A media id or an image address chosen. */
  onPick: (value: string) => void;
  /** Close the popover and open the host's dialog; absent without one. */
  onBrowse: (() => void) | undefined;
}): React.JSX.Element {
  const listId = React.useId();
  const input = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  // Whether the arrows have moved the active option since the search last
  // changed: its ring is drawn only then, so the first tile does not read as
  // the chosen one before the author has moved to it.
  const [keyed, setKeyed] = React.useState(false);
  // An image address in the search is offered as itself; the library is not
  // searched for one, since no file is named like an address.
  const address = addressIn(query);
  const found = useLibrarySearch(search, query, address);
  const options = pickOptions(address, found);
  const at = Math.min(active, options.length - 1);
  const activeOption = options[at];
  const optionId = (index: number): string => `${listId}-option-${index}`;
  const message = pickerMessage(address, found, query.trim());
  const loading = address === undefined && found.state === "loading";

  React.useEffect(() => {
    input.current?.focus();
  }, []);

  // Focus stays in the search, so the browser scrolls nothing as the arrows
  // move: the grid is scrolled to the option they moved to, or a row below
  // the fold could be picked unseen.
  React.useEffect(() => {
    if (!keyed) return;
    document
      .getElementById(`${listId}-option-${at}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [keyed, at, listId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && activeOption !== undefined) {
      event.preventDefault();
      onPick(activeOption.value);
      return;
    }
    const next = gridMove(event, at, options.length, address !== undefined);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    setKeyed(true);
  };

  return (
    <div className="nx-library-pick__body">
      <div className="nx-library-pick__search">
        <Search aria-hidden="true" size={14} />
        <Input
          ref={input}
          type="search"
          role="combobox"
          aria-label={FIND_IN_LIBRARY}
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={
            activeOption === undefined ? undefined : optionId(at)
          }
          placeholder={FIND_IN_LIBRARY}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setActive(0);
            setKeyed(false);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Images in the media library"
        aria-busy={loading}
        className="nx-library-pick__grid"
      >
        {loading ? (
          <LoadingTiles />
        ) : (
          options.map((option, index) => (
            <PickerOption
              key={`${option.kind}:${option.value}`}
              id={optionId(index)}
              option={option}
              selected={option.value === current}
              // An address offered is the one option, which Enter takes
              // whatever the arrows did; a tile is ringed once they move.
              active={index === at && (keyed || option.kind === "address")}
              onActive={() => setActive(index)}
              onPick={() => onPick(option.value)}
            />
          ))
        )}
      </div>
      {message === null ? null : (
        <p className="nx-library-pick__note" role={message.role}>
          {message.text}
        </p>
      )}
      <div className="nx-library-pick__foot">
        <p className="nx-library-pick__hint">{shownWhen}</p>
        {onBrowse === undefined ? null : (
          <button
            type="button"
            className="nx-library-pick__browse"
            onClick={onBrowse}
          >
            Browse all…
          </button>
        )}
      </div>
    </div>
  );
}

/** Empty tiles standing in for the images while they are read. */
function LoadingTiles(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: LOADING_TILES }, (_, index) => (
        <span
          key={index}
          className="nx-library-pick__tile"
          data-loading=""
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * One option of the grid: a file's tile, or the search's address across the
 * grid. Pressed, it is picked; hovered, it is the active one.
 */
function PickerOption({
  id,
  option,
  selected,
  active,
  onActive,
  onPick,
}: {
  id: string;
  option: PickOption;
  selected: boolean;
  active: boolean;
  onActive: () => void;
  onPick: () => void;
}): React.JSX.Element {
  const isAddress = option.kind === "address";
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      // A tile's caption is drawn cut and hidden from assistive technology,
      // so the tile carries its whole name itself.
      aria-label={isAddress ? undefined : option.label}
      data-active={active ? "" : undefined}
      className={
        isAddress ? "nx-library-pick__address" : "nx-library-pick__tile"
      }
      title={isAddress ? `Use this address: ${option.value}` : option.label}
      // Focus stays in the search, where typing goes.
      onMouseDown={event => event.preventDefault()}
      onMouseMove={onActive}
      onClick={onPick}
    >
      {option.kind === "address" ? (
        <AddressOption address={option.value} />
      ) : (
        <TileContent media={option.media} label={option.label} />
      )}
    </div>
  );
}

/** A file's tile: its picture, with its name captioned over the foot. */
function TileContent({
  media,
  label,
}: {
  media: FoundMedia;
  label: string;
}): React.JSX.Element {
  return (
    <>
      {media.thumbnail === undefined ? (
        <span
          className="nx-library-pick__image"
          data-neutral=""
          aria-hidden="true"
        />
      ) : (
        // Decorative: the caption names it, and is the option's name.
        <img
          className="nx-library-pick__image"
          src={media.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <MiddleCut text={label} className="nx-library-pick__caption" />
    </>
  );
}

/**
 * The search's address offered as the fallback: a small picture of it, where
 * it loads, beside "Use this address" and the address itself.
 */
function AddressOption({ address }: { address: string }): React.JSX.Element {
  // The address whose picture would not load, so it draws no broken frame.
  const [broken, setBroken] = React.useState<string>();
  return (
    <>
      {broken === address ? (
        <span
          className="nx-library-pick__address-thumb"
          data-neutral=""
          aria-hidden="true"
        />
      ) : (
        // Decorative: the words beside it say what it is.
        <img
          className="nx-library-pick__address-thumb"
          src={address}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(address)}
        />
      )}
      <span className="nx-library-pick__address-text">
        <span>Use this address</span>
        <small>{address}</small>
      </span>
    </>
  );
}
