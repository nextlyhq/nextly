"use client";

/**
 * An image's source and alt text, each drawn as one control over the two
 * props it is made of (see `image-group`).
 *
 * - Source: "Library | URL". Only the chosen side's field shows: the media
 *   chip, or the address. Switching sides writes nothing; what the author
 *   then picks or types does.
 * - Alt text: one field that grows with its words, holding the words in use:
 *   the page's own, else the library's, marked "From the media library";
 *   and "Decorative, no alt text", which keeps the words for when it is
 *   cleared.
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
  bindingKindOf,
  findNode,
  isAuthoredText,
  type Binding,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { Button, Checkbox, Label, Textarea } from "@nextlyhq/ui";
import * as React from "react";

import { useBoundFieldOf } from "./binding-controls";
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
  altModeOf,
  altTextChanges,
  decorativeChanges,
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
import { useVisitorUnreadable } from "./visitor-unreadable-context";

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
 *
 * Its words follow `value`, with one exception: while the author is typing,
 * a new `value` that only changes what is shown (the library's words
 * arriving for a field that held none yet) leaves their words alone. A move
 * of what the document stores (`stored`: an undo, an edit elsewhere) is
 * followed whatever is being typed, as every inspector field gives way to
 * the document.
 */
function GrowingText({
  id,
  value,
  stored,
  placeholder,
  disabled,
  describedBy,
  onCommit,
}: {
  /** The field's id, which its label names it by. */
  id: string;
  /** The words shown while nothing is being typed. */
  value: string;
  /** What the document stores for the field, which a draft gives way to. */
  stored: string;
  placeholder: string;
  disabled: boolean;
  describedBy: string | undefined;
  onCommit: (text: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  // Whether the author has typed since the words last followed `value`.
  const typing = React.useRef(false);
  const lastStored = React.useRef(stored);
  React.useEffect(() => {
    const documentMoved = lastStored.current !== stored;
    lastStored.current = stored;
    if (!documentMoved && typing.current) return;
    typing.current = false;
    setDraft(value);
  }, [value, stored]);
  const commit = (): void => {
    typing.current = false;
    if (draft !== value) onCommit(draft);
  };
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
      id={id}
      rows={1}
      className="nx-inspector__growing"
      placeholder={placeholder}
      {...(describedBy === undefined
        ? {}
        : { "aria-describedby": describedBy })}
      disabled={disabled}
      value={draft}
      onChange={event => {
        typing.current = true;
        setDraft(event.target.value);
      }}
      onBlur={commit}
      // Enter commits rather than breaking the line: alt text is read out as
      // one run, so a line break in it means nothing, and Enter is what an
      // author presses to say they are done.
      onKeyDown={event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** A picture bound to a field, as the alt note reads which field it is. */
interface BoundPicture {
  /** The media prop the binding fills. */
  readonly prop: string;
  readonly binding: Binding;
  readonly document: BlockDocument;
  readonly nodeId: string;
  readonly services: ContentServices | undefined;
}

/**
 * A bound picture's binding and where it sits, for the alt note to read the
 * field's kind: `undefined` for a picture not bound, or where the block's
 * document or node is not in hand.
 */
function boundPictureOf(
  picture: PictureSource,
  at: {
    readonly document: BlockDocument | undefined;
    readonly nodeId: string | undefined;
    readonly services: ContentServices | undefined;
  },
  media: string | undefined
): BoundPicture | undefined {
  const { document, nodeId, services } = at;
  if (picture.kind !== "bound" || media === undefined) return undefined;
  if (document === undefined || nodeId === undefined) return undefined;
  const binding = findNode(document.nodes, nodeId)?.bindings?.[media];
  return binding === undefined
    ? undefined
    : { prop: media, binding, document, nodeId, services };
}

/**
 * What the alt field says under its words, while the page stores none of its
 * own: whose words they are, or why there are none.
 */
function LibraryAltNote({
  id,
  bound,
  mediaId,
  libraryAlt,
  read,
}: {
  /** The note's id, which the field is described by. */
  id: string;
  /** The picture's binding, whose field is read on the page; none if unbound. */
  bound: BoundPicture | undefined;
  mediaId: string | undefined;
  libraryAlt: string | undefined;
  read: boolean;
}): React.JSX.Element | null {
  // A bound picture is read when the page is drawn, so no file is "not
  // chosen": what applies is the bound field's, said by its kind.
  if (bound !== undefined) return <BoundPictureAltNote id={id} {...bound} />;
  if (mediaId === undefined) {
    return (
      <p className="nx-inspector__note" id={id}>
        No library file is chosen, so screen readers get no alt text. Type some
        to describe the picture.
      </p>
    );
  }
  if (!read) return null;
  if (libraryAlt === undefined) {
    return (
      <p className="nx-inspector__note" id={id}>
        The media library has no alt text for this picture.
      </p>
    );
  }
  // Marked as the library's: the words in the field are in use, and are the
  // library's until the author types their own.
  return (
    <p className="nx-inspector__note nx-image-alt__source" id={id}>
      From the media library
    </p>
  );
}

/**
 * The note for a bound picture, by the kind of field it reads, as the engine
 * types it (`bindingKindOf`): a library file is described by its own alt
 * text, which the page reads with it; an image address has none, so screen
 * readers get none. Until the field is known (the sources still read, or a
 * field they don't list), the note says both, promising neither.
 */
function BoundPictureAltNote({
  id,
  prop,
  binding,
  document,
  nodeId,
  services,
}: BoundPicture & { id: string }): React.JSX.Element {
  const field = useBoundFieldOf(binding, document, nodeId, services);
  // A field visitors can't read never fills the published picture: they see
  // the binding's fallback where it keeps one, else the block's own image, as
  // the note under the group says. Whatever the field's kind, its alt text
  // is not theirs.
  const unreadable = useVisitorUnreadable(nodeId).find(
    each => each.prop === prop
  );
  if (unreadable !== undefined) {
    return (
      <p className="nx-inspector__note" id={id} data-bound-picture="unreadable">
        Visitors can&apos;t read the bound field, so they see{" "}
        {instead(unreadable.fallback !== undefined)}. Type alt text to describe
        the image they see.
      </p>
    );
  }
  const kind = field === undefined ? undefined : bindingKindOf(field);
  if (kind === "media") {
    // The field's type says it holds a file, not that every entry fills it:
    // an empty one shows what the binding falls back to, so the note says so.
    return (
      <p className="nx-inspector__note" id={id} data-bound-picture="media">
        The image comes from a bound library file, so its own alt text is used.
        Where the field is empty, visitors see{" "}
        {instead("fallback" in binding && binding.fallback !== undefined)}. Type
        alt text to describe it here instead.
      </p>
    );
  }
  if (kind === "url" || kind === "text") {
    // An empty field, or an address the page refuses, shows what the binding
    // falls back to instead, which may well be a described library file.
    return (
      <p className="nx-inspector__note" id={id} data-bound-picture="address">
        This image comes from an address, which carries no alt text. Where the
        field holds no usable address, visitors see{" "}
        {instead("fallback" in binding && binding.fallback !== undefined)}. Type
        alt text to describe it for screen readers.
      </p>
    );
  }
  return (
    <p className="nx-inspector__note" id={id}>
      The image comes from a bound field. A library file it holds is described
      by its own alt text; an image address has none, so type alt text to
      describe it.
    </p>
  );
}

/**
 * What visitors see in place of a bound picture the field doesn't fill: the
 * binding's fallback where it keeps one, else the block's own image, as the
 * page resolves it.
 */
function instead(hasFallback: boolean): string {
  return hasFallback ? "its fallback" : "the block's own image";
}

/** What the field says while the image is decorative. */
function DecorativeNote({ id }: { id: string }): React.JSX.Element {
  return (
    <p className="nx-inspector__note" id={id}>
      Screen readers skip this image. Its alt text is kept for if you clear
      this.
    </p>
  );
}

/** The label the block gives one of its props, or `fallback`. */
function labelOf(
  name: string,
  props: readonly EditableProp[],
  fallback: string
): string {
  const prop = props.find(each => each.name === name);
  return prop === undefined ? fallback : propLabel(prop.name, prop.schema);
}

/**
 * The library file the picture is picked from, read for its alt text: none
 * for a bound picture, whose file the page reads, or for no file at all.
 */
function useLibraryAlt(
  services: ContentServices | undefined,
  picture: PictureSource
): {
  readonly mediaId: string | undefined;
  readonly summary: ReturnType<typeof useMediaSummary>;
  readonly libraryAlt: string | undefined;
} {
  const mediaId = picture.kind === "library" ? picture.id : undefined;
  const summary = useMediaSummary(services?.readMedia, mediaId ?? null);
  return { mediaId, summary, libraryAlt: storedString(summary?.alt) };
}

/**
 * What a screen reader is given for an image: one "Alt text" field holding
 * the words in use, and "Decorative, no alt text".
 *
 * While the page stores no words of its own, the field holds the library
 * file's, marked "From the media library", so the author sees what screen
 * readers hear and can change it; what they type is stored as the page's
 * own, and "Use the media library's alt text" puts the library's back.
 * Decorative keeps the words, held, for when it is cleared.
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
  const noteId = React.useId();
  const values = storedValues(props);
  const picture = pictureSourceOf(
    group.media,
    values,
    boundPropsOf(document, nodeId)
  );
  const { mediaId, summary, libraryAlt } = useLibraryAlt(services, picture);
  const mode = altModeOf(group, values);
  const own = storedAlt(group, values);
  const ownStored = isAuthoredText(values[group.alt]);
  const write = (changes: ImageChanges) => {
    if (Object.keys(changes).length === 0) return;
    if (allWritable(changes, writable)) onCommitMany(changes);
  };
  const altHeld = !writable(group.alt);
  const wrap = bindable ?? unwrapped;
  // The alt text's bind button sits on its row; bound, the chip stands for
  // the words and the decorative mark alike.
  return (
    <>
      {wrap(
        group.alt,
        <div className="nx-image-group" data-image-group="alt">
          <HeldByLock reasonId={altHeld ? reasonId : undefined}>
            <div className="nx-inspector__field" data-content-control="alt">
              <Label htmlFor={id}>
                {labelOf(group.alt, props, "Alt text")}
              </Label>
              <GrowingText
                id={id}
                // The words in use: the page's own where it stores some (an
                // empty alt included, which the block draws as none), else
                // the library's.
                value={ownStored ? own : (libraryAlt ?? "")}
                // The page's own words, or none: the library's arriving is
                // not the document moving.
                stored={ownStored ? `own:${own}` : "library"}
                placeholder="Describe the picture"
                disabled={altHeld || mode === "decorative"}
                describedBy={noteId}
                onCommit={typed =>
                  write(altTextChanges(group, typed, values, libraryAlt))
                }
              />
              <AltNote
                id={noteId}
                mode={mode}
                own={ownStored ? own : undefined}
                bound={boundPictureOf(
                  picture,
                  { document, nodeId, services },
                  group.media
                )}
                mediaId={mediaId}
                libraryAlt={libraryAlt}
                read={summary !== undefined}
              />
              <UseLibraryAlt
                offered={
                  ownStored && libraryAlt !== undefined && mode !== "decorative"
                }
                held={altHeld}
                onUse={() => write({ [group.alt]: undefined })}
              />
            </div>
          </HeldByLock>
          <DecorativeBox
            label={labelOf(group.decorative, props, "Decorative, no alt text")}
            checked={mode === "decorative"}
            heldBy={writable(group.decorative) ? undefined : reasonId}
            onChange={on => write(decorativeChanges(group, on, values))}
          />
        </div>,
        // The block reads a decorative image before its alt text, so binding
        // the words lifts the mark in the same edit, or the bound alt would
        // never reach a screen reader.
        { clearsOnBind: [group.decorative] }
      )}
    </>
  );
}

/**
 * What the alt field says under its words: that screen readers skip a
 * decorative image or an empty alt, and otherwise, while the page stores no
 * words of its own, whose words are shown (see {@link LibraryAltNote}).
 */
function AltNote({
  id,
  mode,
  own,
  ...library
}: {
  id: string;
  mode: AltMode;
  /** The page's own words, where it stores some, an empty alt included. */
  own: string | undefined;
} & Omit<
  React.ComponentProps<typeof LibraryAltNote>,
  "id"
>): React.JSX.Element | null {
  if (mode === "decorative") return <DecorativeNote id={id} />;
  if (own === undefined) return <LibraryAltNote id={id} {...library} />;
  if (own.trim() !== "") return null;
  return (
    <p className="nx-inspector__note" id={id}>
      Empty: screen readers skip this image.
    </p>
  );
}

/**
 * "Use the media library's alt text": where the page stores words of its own
 * and the library has some, the way back to the library's, which removes the
 * page's own.
 */
function UseLibraryAlt({
  offered,
  held,
  onUse,
}: {
  offered: boolean;
  held: boolean;
  onUse: () => void;
}): React.JSX.Element | null {
  if (!offered) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="nx-image-alt__reset"
      disabled={held}
      onClick={onUse}
    >
      Use the media library&apos;s alt text
    </Button>
  );
}

/** "Decorative, no alt text": a box beside its words. */
function DecorativeBox({
  label,
  checked,
  heldBy,
  onChange,
}: {
  label: string;
  checked: boolean;
  /** The lock reason's id where a lock holds the mark. */
  heldBy: string | undefined;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <HeldByLock reasonId={heldBy}>
      <div className="nx-image-alt__decorative">
        <Checkbox
          id={id}
          checked={checked}
          disabled={heldBy !== undefined}
          onCheckedChange={next => onChange(next === true)}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
    </HeldByLock>
  );
}
