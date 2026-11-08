"use client";

/**
 * An image's source and alt text, each drawn as one control over the two
 * props it is made of (see `image-group`).
 *
 * - Source: "Library | URL". Only the chosen side's field shows: the media
 *   chip, or the address. Switching sides writes nothing; what the author
 *   then picks or types does.
 * - Alt text: "From library | Custom | Decorative". From library shows the
 *   library's words, muted and read-only; Custom an alt text field that grows
 *   with its words; Decorative says screen readers skip the image.
 *
 * Each offers binding through the inspector's `bindable` wrapper: the Source
 * row binds the image (`mediaId`, which takes a media field or an image
 * address), the address field binds the address, and the alt row binds the
 * alt text. A bound image draws only what its binding gives, so while it is
 * bound the Source row is its chip and neither side is shown.
 *
 * Every write goes through the group's one edit, so a choice that changes two
 * props is one step to undo. A stored state no option names exactly (an
 * address kept beside a library file, alt text kept on a decorative image,
 * an empty alt) is shown as it is and left as it is until the author acts.
 *
 * @module image-controls
 */

import {
  findNode,
  isAuthoredText,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  contentControlFor,
  MediaField,
  SegmentedChoice,
  useMediaSummary,
  type ContentServices,
} from "./content-controls";
import { HeldByLock } from "./held-by-lock";
import {
  addressChanges,
  ALT_MODE_LABELS,
  ALT_MODES,
  altModeChanges,
  altModeOf,
  mediaPickChanges,
  sourceModeOf,
  storedAlt,
  type AltMode,
  type ImageAltGroup,
  type ImageChanges,
  type ImageSourceGroup,
  type SourceMode,
} from "./image-group";
import { propLabel, type EditableProp } from "./inspector";
import type { BindableWrapper } from "./prop-groups";
import { useStoredDraft } from "./stored-draft";

/** What both image controls are given. */
interface ImageGroupFieldProps {
  /** The block's props, as the inspector reads them. */
  readonly props: readonly EditableProp[];
  /** Whether one prop may be set where the block sits. */
  readonly writable: (name: string) => boolean;
  /** The id of the lock reason a held control points to. */
  readonly reasonId: string;
  readonly services: ContentServices | undefined;
  /** Every set of props the block can be placed with. */
  readonly placedWith: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Write several props as one edit. */
  readonly onCommitMany: (changes: ImageChanges) => unknown;
  /** One prop's binding controls, from the inspector; absent, none are drawn. */
  readonly bindable?: BindableWrapper | undefined;
  /** The document the block is in, whose bindings say which props are bound. */
  readonly document?: BlockDocument | undefined;
  /** The block's id. */
  readonly nodeId?: string | undefined;
}

/** A field drawn as it is, where the inspector offers no binding controls. */
const unwrapped: BindableWrapper = (_name, field) => field;

/**
 * Where the image's picture comes from, as the block reads it: a binding on
 * its media prop first, then a stored library file, else none here (an
 * address, or nothing). The one reading the source and alt controls share.
 */
type PictureSource =
  | { readonly kind: "bound" }
  | { readonly kind: "library"; readonly id: string }
  | { readonly kind: "none" };

function pictureSourceOf(
  media: string | undefined,
  values: Readonly<Record<string, unknown>>,
  bound: ReadonlySet<string>
): PictureSource {
  if (media === undefined) return { kind: "none" };
  if (bound.has(media)) return { kind: "bound" };
  const id = storedString(values[media]);
  return id === undefined ? { kind: "none" } : { kind: "library", id };
}

/** The names of the block's props that hold a binding. */
function boundPropsOf(
  document: BlockDocument | undefined,
  nodeId: string | undefined
): ReadonlySet<string> {
  if (document === undefined || nodeId === undefined) return new Set();
  return new Set(Object.keys(findNode(document.nodes, nodeId)?.bindings ?? {}));
}

/** The props as STORED, by name: a default is not a value the page holds. */
function storedValues(
  props: readonly EditableProp[]
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(props.map(prop => [prop.name, prop.value]));
}

/** A stored string, trimmed, or `undefined` for anything else or nothing. */
function storedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Whether every prop a change names may be written. */
function allWritable(
  changes: ImageChanges,
  writable: (name: string) => boolean
): boolean {
  return Object.keys(changes).every(writable);
}

const SOURCE_MODES: readonly SourceMode[] = ["library", "url"];
const SOURCE_LABELS: readonly string[] = ["Library", "URL"];

/** The address field, as the registry's own URL control draws it. */
function AddressField({
  prop,
  disabled,
  onCommit,
}: {
  prop: EditableProp;
  disabled: boolean;
  onCommit: (typed: string) => void;
}): React.JSX.Element | null {
  const id = React.useId();
  const Control = contentControlFor(prop.schema.type);
  if (Control === undefined) return null;
  return (
    <Control
      id={id}
      prop={prop}
      disabled={disabled}
      // The URL control commits the typed text; anything else, or a removal,
      // reads as an emptied field.
      onCommit={(_, value) => onCommit(typeof value === "string" ? value : "")}
    />
  );
}

/** A source side's field, with what it is given to write. */
interface SourceSideProps {
  /** A prop's binding controls around its field. */
  readonly wrap: BindableWrapper;
  readonly group: ImageSourceGroup;
  readonly props: readonly EditableProp[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly writable: (name: string) => boolean;
  readonly reasonId: string;
  /** Write several props as one edit, where every one may be written. */
  readonly write: (changes: ImageChanges) => void;
}

/** The library side: the media chip, and an address stored beside it. */
function LibrarySide({
  group,
  props,
  values,
  writable,
  reasonId,
  write,
  services,
  showLibraryAlt,
  placedWith,
}: SourceSideProps & {
  services: ContentServices | undefined;
  showLibraryAlt: boolean;
  placedWith: ImageGroupFieldProps["placedWith"];
}): React.JSX.Element {
  const id = React.useId();
  const media = props.find(prop => prop.name === group.media);
  const storedMedia = storedString(values[group.media]);
  const storedAddress = storedString(values[group.address]);
  const accept = media?.schema.accept;
  return (
    <HeldByLock reasonId={writable(group.media) ? undefined : reasonId}>
      <MediaField
        id={id}
        label={
          media === undefined ? "Image" : propLabel(media.name, media.schema)
        }
        stored={storedMedia ?? null}
        accept={typeof accept === "string" ? accept : undefined}
        disabled={!writable(group.media)}
        services={services}
        showAlt={showLibraryAlt}
        onChange={next =>
          write(
            next === undefined
              ? { [group.media]: undefined }
              : mediaPickChanges(group, next, values, placedWith)
          )
        }
      />
      {storedMedia === undefined || storedAddress === undefined ? null : (
        <p className="nx-inspector__note">
          An address is also stored, and is drawn if the library file is
          missing: {storedAddress}
        </p>
      )}
    </HeldByLock>
  );
}

/** The address side: the address field, and a library file still chosen. */
function AddressSide({
  group,
  props,
  values,
  writable,
  reasonId,
  write,
  wrap,
}: SourceSideProps): React.JSX.Element {
  const address = props.find(prop => prop.name === group.address);
  const storedMedia = storedString(values[group.media]);
  return (
    <HeldByLock reasonId={writable(group.address) ? undefined : reasonId}>
      {address === undefined
        ? null
        : wrap(
            group.address,
            <AddressField
              prop={address}
              disabled={!writable(group.address)}
              onCommit={typed => write(addressChanges(group, typed, values))}
            />,
            // The block draws a library file before an address, so binding
            // the address empties a stored file in the same edit, as typing
            // one does (`addressChanges`).
            { clearsOnBind: [group.media] }
          )}
      {storedMedia === undefined ? null : (
        <div className="nx-inspector__note-row">
          <p className="nx-inspector__note">
            A library file is chosen, and is drawn instead. An address entered
            here replaces it.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!writable(group.media)}
            onClick={() => write({ [group.media]: undefined })}
          >
            Remove the library file
          </Button>
        </div>
      )}
    </HeldByLock>
  );
}

/**
 * The side the stored props read as: `sourceModeOf`, except that an address
 * bound with no library file stored is on the URL side, where its chip is
 * drawn.
 */
function storedSide(
  group: ImageSourceGroup,
  values: Readonly<Record<string, unknown>>,
  bound: ReadonlySet<string>
): SourceMode {
  const addressBound = !bound.has(group.media) && bound.has(group.address);
  return addressBound && storedString(values[group.media]) === undefined
    ? "url"
    : sourceModeOf(group, values);
}

/** The chosen side's field: the library chip, or the address. */
function SourceSideShown({
  mode,
  side,
  services,
  showLibraryAlt,
  placedWith,
}: {
  mode: SourceMode;
  side: SourceSideProps;
  services: ContentServices | undefined;
  showLibraryAlt: boolean;
  placedWith: ImageGroupFieldProps["placedWith"];
}): React.JSX.Element {
  return mode === "library" ? (
    <LibrarySide
      {...side}
      services={services}
      showLibraryAlt={showLibraryAlt}
      placedWith={placedWith}
    />
  ) : (
    <AddressSide {...side} />
  );
}

/**
 * Where an image's picture comes from: a library file or an address, one
 * shown at a time.
 */
export function ImageSourceField({
  group,
  props,
  writable,
  reasonId,
  services,
  placedWith,
  onCommitMany,
  showLibraryAlt,
  bindable,
  document,
  nodeId,
}: ImageGroupFieldProps & {
  group: ImageSourceGroup;
  /** Whether the chip shows the library's alt text: not when a row says it. */
  showLibraryAlt: boolean;
}): React.JSX.Element {
  const id = React.useId();
  const values = storedValues(props);
  const wrap = bindable ?? unwrapped;
  const bound = boundPropsOf(document, nodeId);
  const imageBound =
    pictureSourceOf(group.media, values, bound).kind === "bound";
  // The side shown, starting from what is stored. Choosing a side changes
  // only what is shown; the props change when a file is picked or an
  // address typed, so looking at the other side never loses a value.
  const stored = storedSide(group, values, bound);
  const [view, setView] = React.useState<{
    readonly mode: SourceMode;
    readonly from: SourceMode;
  }>({ mode: stored, from: stored });
  // Followed again whenever the stored props come to read as another side:
  // an undo, a redo or a document replaced from outside changes them under
  // a field that stays mounted. A side chosen while they stay as they are
  // is kept. Set during render, as React sets state derived from props, so
  // the wrong side is never drawn first.
  if (view.from !== stored) setView({ mode: stored, from: stored });
  const mode = view.from === stored ? view.mode : stored;
  const setMode = (next: SourceMode) => setView({ mode: next, from: stored });
  const side: SourceSideProps = {
    wrap,
    group,
    props,
    values,
    writable,
    reasonId,
    write: changes => {
      if (allWritable(changes, writable)) onCommitMany(changes);
    },
  };
  return (
    <div className="nx-image-group" data-image-group="source">
      {/* The image's bind button sits on the Source row, which says where
          the picture comes from; bound, the row is the chip, and an unbind's
          note stays under it whichever side the kept value is on. */}
      {wrap(
        group.media,
        <div className="nx-inspector__field" data-content-control="source">
          <p className="nx-inspector__field-name" id={`${id}-label`}>
            Source
          </p>
          <SegmentedChoice
            id={id}
            labelledBy={`${id}-label`}
            options={SOURCE_MODES}
            labels={SOURCE_LABELS}
            value={mode}
            disabled={!writable(group.media) && !writable(group.address)}
            onChoose={next => setMode(next === "url" ? "url" : "library")}
          />
        </div>
      )}
      {imageBound ? null : (
        <SourceSideShown
          mode={mode}
          side={side}
          services={services}
          showLibraryAlt={showLibraryAlt}
          placedWith={placedWith}
        />
      )}
    </div>
  );
}

/**
 * A text field one line tall that grows with its words, committed on blur
 * so an edit is one step to undo.
 */
function GrowingText({
  value,
  label,
  disabled,
  describedBy,
  onCommit,
}: {
  value: string;
  label: string;
  disabled: boolean;
  describedBy: string | undefined;
  onCommit: (text: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(value);
  const field = React.useRef<HTMLTextAreaElement>(null);
  // Fitted to its words after each change, up to the six lines the style
  // caps it at, past which it scrolls.
  React.useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft]);
  return (
    <Textarea
      ref={field}
      rows={1}
      className="nx-inspector__growing"
      aria-label={label}
      {...(describedBy === undefined
        ? {}
        : { "aria-describedby": describedBy })}
      disabled={disabled}
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      // Enter commits rather than breaking the line: alt text is read out as
      // one run, so a line break in it means nothing, and Enter is what an
      // author presses to say they are done.
      onKeyDown={event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

/** What From library says under the menu: the library's words, or why none. */
function LibraryAltNote({
  bound,
  mediaId,
  libraryAlt,
  read,
}: {
  /** Whether the picture comes from a binding, whose file is read on the page. */
  bound: boolean;
  mediaId: string | undefined;
  libraryAlt: string | undefined;
  read: boolean;
}): React.JSX.Element | null {
  // A bound picture's file is the field's, read when the page is drawn, so
  // no file is "not chosen": its library alt text applies.
  if (bound) {
    return (
      <p className="nx-inspector__note">
        The image comes from a bound field, so the library alt text of the file
        it holds is used. Choose Custom to describe it here instead.
      </p>
    );
  }
  if (mediaId === undefined) {
    return (
      <p className="nx-inspector__note">
        No library file is chosen, so there is no library alt text and screen
        readers get none. Choose Custom to describe the image.
      </p>
    );
  }
  if (!read) return null;
  if (libraryAlt === undefined) {
    return (
      <p className="nx-inspector__note">
        The library has no alt text for this image. Choose Custom to write one.
      </p>
    );
  }
  return (
    <p className="nx-inspector__note nx-inspector__library-alt">{libraryAlt}</p>
  );
}

/** What Decorative says under the menu, alt text kept beside it included. */
function DecorativeNote({ own }: { own: string }): React.JSX.Element {
  return (
    <p className="nx-inspector__note">
      Screen readers skip this image.
      {own === ""
        ? null
        : ` Its own alt text is kept for if you switch back: ${own}`}
    </p>
  );
}

/** The menu of alt modes: a mode a lock would refuse is offered disabled. */
function AltMenu({
  id,
  mode,
  held,
  pickable,
  onPick,
}: {
  id: string;
  mode: AltMode;
  held: boolean;
  pickable: (mode: AltMode) => boolean;
  onPick: (mode: AltMode) => void;
}): React.JSX.Element {
  return (
    <Select
      disabled={held}
      value={mode}
      onValueChange={next => {
        const chosen = ALT_MODES.find(each => each === next);
        if (chosen !== undefined && chosen !== mode) onPick(chosen);
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALT_MODES.map(each => (
          <SelectItem key={each} value={each} disabled={!pickable(each)}>
            {ALT_MODE_LABELS[each]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Custom's field, and what an empty one means. */
function CustomAlt({
  own,
  libraryAlt,
  disabled,
  onCommit,
}: {
  own: string;
  libraryAlt: string | undefined;
  disabled: boolean;
  onCommit: (text: string) => void;
}): React.JSX.Element {
  const noteId = React.useId();
  const empty = own.trim() === "";
  return (
    <div className="nx-inspector__field">
      <GrowingText
        value={own}
        label="Custom alt text"
        disabled={disabled}
        describedBy={empty ? noteId : undefined}
        onCommit={onCommit}
      />
      {empty ? (
        <p className="nx-inspector__note" id={noteId}>
          Empty: screen readers skip this image.
          {libraryAlt === undefined
            ? null
            : " The library has alt text for it: choose From library to use it."}
        </p>
      ) : null}
    </div>
  );
}

/** The label the block gives its alt prop, or "Alt text". */
function altLabel(
  group: ImageAltGroup,
  props: readonly EditableProp[]
): string {
  const altProp = props.find(prop => prop.name === group.alt);
  return altProp === undefined
    ? "Alt text"
    : propLabel(altProp.name, altProp.schema);
}

/**
 * The library file the picture is picked from, read for its alt text: none
 * for a bound picture, whose file the page reads, or for no file at all.
 * `pending` while the read is still out.
 */
function useLibraryAlt(
  services: ContentServices | undefined,
  picture: PictureSource
): {
  readonly mediaId: string | undefined;
  readonly summary: ReturnType<typeof useMediaSummary>;
  readonly libraryAlt: string | undefined;
  readonly libraryPending: boolean;
} {
  const mediaId = picture.kind === "library" ? picture.id : undefined;
  const summary = useMediaSummary(services?.readMedia, mediaId ?? null);
  return {
    mediaId,
    summary,
    libraryAlt: storedString(summary?.alt),
    libraryPending:
      mediaId !== undefined &&
      services?.readMedia !== undefined &&
      summary === undefined,
  };
}

/**
 * What a screen reader is given for an image: the library's alt text, the
 * page's own, or nothing because the image is decorative.
 */
export function ImageAltField({
  group,
  props,
  writable,
  reasonId,
  services,
  onCommitMany,
  bindable,
  document,
  nodeId,
}: ImageGroupFieldProps & { group: ImageAltGroup }): React.JSX.Element {
  const id = React.useId();
  const values = storedValues(props);
  const picture = pictureSourceOf(
    group.media,
    values,
    boundPropsOf(document, nodeId)
  );
  const { mediaId, summary, libraryAlt, libraryPending } = useLibraryAlt(
    services,
    picture
  );
  const mode = altModeOf(group, values);
  const own = storedAlt(group, values);
  const changesFor = (next: AltMode) =>
    altModeChanges(group, next, values, libraryAlt);
  const allowed = (next: AltMode) =>
    next === mode || allWritable(changesFor(next), writable);
  // Custom starts from the library's words where the page stores none, so it
  // waits for them: chosen before they arrive, it would store an empty alt
  // and silence a description the image was being read with.
  const waiting = (next: AltMode) =>
    next === "custom" && libraryPending && !isAuthoredText(values[group.alt]);
  const pickable = (next: AltMode) =>
    next === mode || (allowed(next) && !waiting(next));
  // Held is a lock's doing alone: a choice only waiting for the library is
  // not one a lock refuses.
  const held = ALT_MODES.every(next => !allowed(next) || next === mode);
  const wrap = bindable ?? unwrapped;
  // The alt text's bind button sits on its menu's row; bound, the chip
  // stands for the menu and the words alike.
  return (
    <>
      {wrap(
        group.alt,
        <div className="nx-image-group" data-image-group="alt">
          <HeldByLock reasonId={held ? reasonId : undefined}>
            <div className="nx-inspector__field" data-content-control="alt">
              <Label htmlFor={id}>{altLabel(group, props)}</Label>
              <AltMenu
                id={id}
                mode={mode}
                held={held}
                pickable={pickable}
                onPick={next => {
                  const changes = changesFor(next);
                  if (allWritable(changes, writable)) onCommitMany(changes);
                }}
              />
              {mode === "library" ? (
                <LibraryAltNote
                  bound={picture.kind === "bound"}
                  mediaId={mediaId}
                  libraryAlt={libraryAlt}
                  read={summary !== undefined}
                />
              ) : null}
              {mode === "decorative" ? <DecorativeNote own={own} /> : null}
            </div>
          </HeldByLock>
          {mode === "custom" ? (
            <HeldByLock reasonId={writable(group.alt) ? undefined : reasonId}>
              <CustomAlt
                own={own}
                libraryAlt={libraryAlt}
                disabled={!writable(group.alt)}
                // An emptied field keeps an empty alt rather than removing it:
                // removed, the library's words would apply, which is From
                // library, not what the author just did.
                onCommit={text => onCommitMany({ [group.alt]: text })}
              />
            </HeldByLock>
          ) : null}
        </div>,
        // The block reads a decorative image before its alt text, so binding
        // the words lifts the mark in the same edit, or the bound alt would
        // never reach a screen reader.
        { clearsOnBind: [group.decorative] }
      )}
    </>
  );
}
