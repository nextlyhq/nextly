"use client";

/**
 * An Image's empty state on the canvas: what an author sees, and does, where
 * an Image has no picture yet.
 *
 * The Image block draws a box where it has no picture, only where an author
 * is looking, in the block's own classes, so the box takes the size and the
 * proportion the block has: 16:9 and the column's width until it is set.
 * This draws the editor's part over each box, in the editor's own colours:
 * "Add an image" with Upload, Media library and Link, and "or drop a file
 * here". A library file the library no longer has says so, with Replace.
 *
 * - **Upload** and a **dropped file** go through the host's media library
 *   upload (`uploadMedia`), with its checks, the progress drawn on the
 *   block. A file that is not a picture is refused here, before anything is
 *   sent: "That file isn't an image", and nothing changes. A file dropped
 *   on an Image that has a picture replaces it the same way.
 * - **Media library** opens the host's picker (`MediaPicker`).
 * - **Link** takes an address, checked by the rule the block draws by and
 *   then loaded where the page is drawn; only one that loads as a picture is
 *   stored. One that does not says "This link didn't load an image", with
 *   "Try another link", and the Image stays empty.
 *
 * Each choice writes through the editor's one write path, as the inspector's
 * Image fields do, so it is one step to undo, and it is refused where a lock
 * holds the picture. An Image inside a placed component, in the Layout around
 * the page, or bound to a field is not offered: its picture is set elsewhere.
 *
 * Drawn like `EmptyContainerAppenders`, in the overlay over the canvas, at
 * each box's measured rectangle; see that module for why the rectangles are
 * read through `canvasContentRect` and kept current by `watchCanvasFor`.
 *
 * @module canvas/image-states
 */

import {
  INSTANCE_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  type RemotePatternInput,
} from "@nextlyhq/blocks-react";
import { Button } from "@nextlyhq/ui";
import { ImageOff, ImagePlus } from "lucide-react";
import * as React from "react";

import type { ContentServices, PickedMedia } from "../content-services";
import { isElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { Rect } from "../geometry";
import { lockViewOf, propIsWritable } from "../inspector";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeAddressOf, nodeElement } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import { canvasContentRect, overlaySpaceOf } from "./geometry-dom";
import {
  carriesFiles,
  chosenFile,
  emptyImageBoxes,
  IMAGE_STATE_WORDS as WORDS,
  imageNodeOf,
  linkAddress,
  loadsAsImage,
  pictureOp,
  takesPicture,
  type ImageEmptyReason,
} from "./image-states-model";

export interface ImageStatesProps {
  /** The editor the choices write through. */
  readonly editor: EditorState;
  /**
   * The host's media library: its upload and its picker. A choice whose
   * service is absent is not offered.
   */
  readonly services?: Pick<ContentServices, "MediaPicker" | "uploadMedia">;
  /** The hosts this site loads pictures from, as the canvas draws them. */
  readonly remotePatterns?: readonly RemotePatternInput[];
  /**
   * A block is being dragged. The boxes stay drawn, so the page keeps its
   * shape, and take no presses, so the drag reaches the canvas beneath.
   */
  readonly dragging?: boolean;
}

/** What an Image is in the middle of, here. */
type Activity =
  | {
      readonly kind: "link";
      readonly typed: string;
      readonly checking: boolean;
    }
  | { readonly kind: "bad-link"; readonly typed: string }
  | {
      readonly kind: "uploading";
      readonly name: string;
      readonly percent: number;
    }
  /** Stored, and waiting for the canvas to draw the picture. */
  | { readonly kind: "placing" }
  /** A short note: a file refused, or an upload that did not finish. */
  | { readonly kind: "note"; readonly words: string };

/** Where one plate is drawn, and for which Image. */
interface Plate {
  readonly key: string;
  readonly nodeId: string;
  /** `filled`: an Image with a picture, drawn over only while it is busy. */
  readonly reason: ImageEmptyReason | "filled";
  readonly rect: Rect;
}

/** How long a note stays before the Image's choices come back. */
const NOTE_MS = 6000;

/** How long a stored picture is waited for before the box is offered again. */
const PLACING_MS = 10_000;

const NO_ACTIVITY: ReadonlyMap<string, Activity> = new Map();

/** The Image's choices, and its notes, drawn over its empty box. */
export function ImageStates({
  editor,
  services,
  remotePatterns,
  dragging = false,
}: ImageStatesProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [plates, setPlates] = React.useState<readonly Plate[]>([]);
  const [activity, setActivity] =
    React.useState<ReadonlyMap<string, Activity>>(NO_ACTIVITY);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState<string | null>(null);

  // Read in callbacks that outlive the render that made them: an upload
  // finishes against the document as it is then, not as it was.
  const latest = React.useRef({ editor, activity, dropTarget });
  latest.current = { editor, activity, dropTarget };

  const upload = services?.uploadMedia;
  const Picker = services?.MediaPicker;

  const setFor = React.useCallback(
    (nodeId: string, next: Activity | undefined) => {
      setActivity(current => {
        const map = new Map(current);
        if (next === undefined) map.delete(nodeId);
        else map.set(nodeId, next);
        return map;
      });
    },
    []
  );

  // Notes and stored pictures clear themselves after a while.
  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [nodeId, now] of activity) {
      if (now.kind !== "note" && now.kind !== "placing") continue;
      timers.push(
        setTimeout(
          () =>
            setActivity(current => {
              if (current.get(nodeId) !== now) return current;
              const map = new Map(current);
              map.delete(nodeId);
              return map;
            }),
          now.kind === "note" ? NOTE_MS : PLACING_MS
        )
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [activity]);

  /** Whether the Image takes a picture from here, now. */
  const writable = React.useCallback((nodeId: string): boolean => {
    const { editor: now } = latest.current;
    const node = imageNodeOf(now.document, nodeId);
    if (node === undefined || !takesPicture(node)) return false;
    const view = lockViewOf(now);
    return (
      propIsWritable(now.document, nodeId, "mediaId", view) &&
      propIsWritable(now.document, nodeId, "src", view)
    );
  }, []);

  /** Store a picture on the Image, through the editor's write path. */
  const place = React.useCallback(
    (
      nodeId: string,
      picture: { readonly mediaId: string } | { readonly address: string }
    ): boolean => {
      const { editor: now } = latest.current;
      if (!writable(nodeId)) return false;
      const op = pictureOp(now.document, nodeId, picture);
      return op !== null && now.apply(op) !== null;
    },
    [writable]
  );

  /** Take the first file a drop or the chooser handed over. */
  const take = React.useCallback(
    (nodeId: string, files: FileList | null) => {
      const chosen = chosenFile(files);
      if (chosen === undefined || upload === undefined) return;
      if (!chosen.image) {
        setFor(nodeId, { kind: "note", words: WORDS.notImage });
        return;
      }
      if (!writable(nodeId)) return;
      const { file } = chosen;
      setFor(nodeId, { kind: "uploading", name: file.name, percent: 0 });
      upload(file, percent =>
        setActivity(current => {
          const now = current.get(nodeId);
          if (now?.kind !== "uploading") return current;
          const map = new Map(current);
          map.set(nodeId, {
            ...now,
            percent: Math.max(0, Math.min(100, percent)),
          });
          return map;
        })
      ).then(
        (media: PickedMedia) =>
          setFor(
            nodeId,
            place(nodeId, { mediaId: media.id })
              ? { kind: "placing" }
              : undefined
          ),
        (error: unknown) =>
          setFor(nodeId, {
            kind: "note",
            words: failureWords(error),
          })
      );
    },
    [place, setFor, upload, writable]
  );

  /** Check a typed link, and store it once it loads as a picture. */
  const tryLink = React.useCallback(
    (nodeId: string, typed: string) => {
      const address = linkAddress(typed, remotePatterns);
      const root = canvasRootOf(layer.current);
      if (address === undefined || root === null) {
        setFor(nodeId, { kind: "bad-link", typed });
        return;
      }
      setFor(nodeId, { kind: "link", typed, checking: true });
      void loadsAsImage(address, root.ownerDocument).then(loaded => {
        if (!loaded) {
          setFor(nodeId, { kind: "bad-link", typed });
          return;
        }
        setFor(
          nodeId,
          place(nodeId, { address }) ? { kind: "placing" } : undefined
        );
      });
    },
    [place, remotePatterns, setFor]
  );

  const measure = React.useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      setPlates(current => (current.length === 0 ? current : []));
      return;
    }
    const { editor: now, activity: busy, dropTarget: over } = latest.current;
    const empty = emptyPlates(space, now.document);
    const drawn = new Set(empty.map(plate => plate.nodeId));
    setPlates([...empty, ...busyPlates(space, drawn, busy, over)]);
    // A picture stored from here has been drawn once its box is gone.
    for (const [nodeId, now2] of busy) {
      if (now2.kind === "placing" && !drawn.has(nodeId))
        setFor(nodeId, undefined);
    }
  }, [setFor]);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, activity, dropTarget, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, editor.document, canvasFrame]
  );

  // A file held over an Image that has a picture, inside the page, is taken
  // by the page: listened for there. Over an empty box, the plate drawn over
  // it takes it instead.
  React.useEffect(() => {
    const root = canvasRootOf(layer.current);
    if (root === null || upload === undefined) return;
    const imageUnder = (target: EventTarget | null): string | null => {
      if (!isElement(target)) return null;
      const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
      // A picture inside a placed component is the component's.
      if (owner === null || owner.hasAttribute(INSTANCE_ATTRIBUTE)) return null;
      const nodeId = nodeAddressOf(owner);
      if (nodeId === null) return null;
      return writable(nodeId) ? nodeId : null;
    };
    const over = (event: DragEvent): void => {
      if (!carriesFiles(event.dataTransfer)) return;
      const nodeId = imageUnder(event.target);
      if (latest.current.dropTarget !== nodeId) setDropTarget(nodeId);
      if (nodeId === null) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent): void => {
      const nodeId = carriesFiles(event.dataTransfer)
        ? imageUnder(event.target)
        : null;
      setDropTarget(null);
      if (nodeId === null) return;
      event.preventDefault();
      take(nodeId, event.dataTransfer?.files ?? null);
    };
    const away = (event: DragEvent): void => {
      const next = event.relatedTarget;
      if (isElement(next) && root.contains(next)) return;
      setDropTarget(null);
    };
    const ended = (): void => setDropTarget(null);
    root.addEventListener("dragover", over);
    root.addEventListener("drop", drop);
    root.addEventListener("dragleave", away);
    root.ownerDocument.addEventListener("dragend", ended);
    return () => {
      root.removeEventListener("dragover", over);
      root.removeEventListener("drop", drop);
      root.removeEventListener("dragleave", away);
      root.ownerDocument.removeEventListener("dragend", ended);
    };
  }, [take, upload, writable, canvasFrame, editor.document]);

  const choose = (nodeId: string): void => editor.select(nodeId);

  return (
    <div
      ref={layer}
      className="nx-image-states"
      data-dragging={dragging ? "" : undefined}
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {plates.map(plate => (
        <ImagePlate
          key={plate.key}
          plate={plate}
          activity={activity.get(plate.nodeId)}
          held={dropTarget === plate.nodeId}
          writable={writable(plate.nodeId)}
          dragging={dragging}
          canUpload={upload !== undefined}
          canPick={Picker !== undefined}
          onSelect={() => choose(plate.nodeId)}
          onFiles={files => take(plate.nodeId, files)}
          onHeld={held =>
            setDropTarget(current =>
              held ? plate.nodeId : current === plate.nodeId ? null : current
            )
          }
          onLibrary={() => {
            choose(plate.nodeId);
            setPicking(plate.nodeId);
          }}
          onLink={typed => {
            choose(plate.nodeId);
            setFor(plate.nodeId, { kind: "link", typed, checking: false });
          }}
          onTypeLink={typed =>
            setFor(plate.nodeId, { kind: "link", typed, checking: false })
          }
          onSubmitLink={typed => tryLink(plate.nodeId, typed)}
          onCancel={() => setFor(plate.nodeId, undefined)}
        />
      ))}
      {/*
        Beside the plates, not inside one: the picker's own presses would
        otherwise reach a plate's, which selects the block under it.
      */}
      {Picker === undefined || picking === null ? null : (
        <Picker
          open
          onOpenChange={open => {
            if (!open) setPicking(null);
          }}
          title={WORDS.libraryTitle}
          accept="image/*"
          initialSelectedIds={new Set()}
          onSelect={media => {
            const nodeId = picking;
            setPicking(null);
            const first = media[0];
            if (first !== undefined && place(nodeId, { mediaId: first.id })) {
              setFor(nodeId, { kind: "placing" });
            }
          }}
        />
      )}
    </div>
  );
}

/** The canvas root the layer is drawn over, or `null` when it is over none. */
function canvasRootOf(layer: HTMLElement | null): HTMLElement | null {
  if (layer === null) return null;
  return overlaySpaceOf(layer, CANVAS_ROOT_CLASS)?.root ?? null;
}

/** The canvas the plates are drawn over, and how a rectangle is placed there. */
type Space = NonNullable<ReturnType<typeof overlaySpaceOf>>;

/** A plate over each Image box this page owns that waits for a picture. */
function emptyPlates(space: Space, document: EditorState["document"]): Plate[] {
  return emptyImageBoxes(space.root, document).map((box, index) => ({
    key: `${box.nodeId}:${String(index)}`,
    nodeId: box.nodeId,
    reason: box.reason,
    rect: space.place(canvasContentRect(box.element, space.root)),
  }));
}

/**
 * A plate over each Image with a picture that something is happening to: a
 * file held over it, an upload, a note. One whose stored picture is drawn now
 * has nothing more to say.
 */
function busyPlates(
  space: Space,
  drawn: ReadonlySet<string>,
  busy: ReadonlyMap<string, Activity>,
  over: string | null
): Plate[] {
  const ids = new Set<string>();
  for (const [nodeId, now] of busy) {
    if (now.kind !== "placing") ids.add(nodeId);
  }
  if (over !== null) ids.add(over);
  const plates: Plate[] = [];
  for (const nodeId of ids) {
    if (drawn.has(nodeId)) continue;
    const element = nodeElement(space.root, nodeId);
    if (element === null) continue;
    plates.push({
      key: `${nodeId}:filled`,
      nodeId,
      reason: "filled",
      rect: space.place(canvasContentRect(element, space.root)),
    });
  }
  return plates;
}

/** Why an upload did not finish, in the library's own words when it gave any. */
function failureWords(error: unknown): string {
  const reason =
    error instanceof Error && error.message.trim() !== ""
      ? error.message.trim()
      : undefined;
  return reason === undefined
    ? `${WORDS.uploadFailed}.`
    : `${WORDS.uploadFailed}: ${reason}`;
}

interface ImagePlateProps {
  readonly plate: Plate;
  readonly activity: Activity | undefined;
  /** A file is held over it. */
  readonly held: boolean;
  readonly writable: boolean;
  readonly dragging: boolean;
  readonly canUpload: boolean;
  readonly canPick: boolean;
  readonly onSelect: () => void;
  readonly onFiles: (files: FileList | null) => void;
  readonly onHeld: (held: boolean) => void;
  readonly onLibrary: () => void;
  readonly onLink: (typed: string) => void;
  readonly onTypeLink: (typed: string) => void;
  readonly onSubmitLink: (typed: string) => void;
  readonly onCancel: () => void;
}

/** One Image's plate: its box, in the editor's colours, and what it offers. */
function ImagePlate(props: ImagePlateProps): React.JSX.Element {
  const { plate, activity, held, writable, dragging, canUpload, onSelect } =
    props;
  const takesFiles = canUpload && writable && !dragging;
  const { x, y, width, height } = plate.rect;
  return (
    <div
      className="nx-image-state"
      data-image-state={plate.reason}
      data-image-activity={activity?.kind}
      data-held={held ? "" : undefined}
      role="group"
      aria-label={plate.reason === "missing" ? WORDS.missing : "Image"}
      style={{ left: x, top: y, width, height }}
      onClick={event => {
        if (event.target === event.currentTarget) onSelect();
      }}
      onContextMenu={event => event.stopPropagation()}
      onDragOver={event => {
        if (!takesFiles || !carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!held) props.onHeld(true);
      }}
      onDragLeave={event => {
        const next = event.relatedTarget;
        if (isElement(next) && event.currentTarget.contains(next)) return;
        props.onHeld(false);
      }}
      onDrop={event => {
        props.onHeld(false);
        if (!takesFiles || !carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        props.onFiles(event.dataTransfer.files);
      }}
    >
      <PlateBody {...props} takesFiles={takesFiles} />
    </div>
  );
}

/** What the plate says and offers, for what its Image is doing. */
function PlateBody(
  props: ImagePlateProps & { readonly takesFiles: boolean }
): React.JSX.Element | null {
  const { plate, activity } = props;
  switch (activity?.kind) {
    case "uploading":
      return <Progress percent={activity.percent} name={activity.name} />;
    case "placing":
      return <Progress percent={100} name="" />;
    case "link":
      return <LinkForm {...props} activity={activity} />;
    case "bad-link":
      return <BadLink {...props} typed={activity.typed} />;
    default:
      break;
  }
  const note = activity?.kind === "note" ? activity.words : undefined;
  if (plate.reason === "filled") {
    return <OverPicture note={note} held={props.held} />;
  }
  return (
    <Choices {...props} note={note} missing={plate.reason === "missing"} />
  );
}

/** An upload's progress, drawn on the block. */
function Progress({
  percent,
  name,
}: {
  readonly percent: number;
  readonly name: string;
}): React.JSX.Element {
  return (
    <div className="nx-image-state__progress" role="status">
      <span className="nx-image-state__words">
        {WORDS.uploading}
        {name === "" ? "" : ` ${name}`}
      </span>
      <span
        className="nx-image-state__bar"
        role="progressbar"
        aria-label={WORDS.uploading}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${String(percent)}%` }} />
      </span>
    </div>
  );
}

/** A link that did not load: say so, and offer another try. */
function BadLink({
  typed,
  onLink,
  onCancel,
}: ImagePlateProps & { readonly typed: string }): React.JSX.Element {
  return (
    <div className="nx-image-state__stack">
      <p className="nx-image-state__problem" role="alert">
        {WORDS.badLink}
      </p>
      <div className="nx-image-state__actions">
        <Button type="button" size="sm" onClick={() => onLink(typed)}>
          {WORDS.tryAnotherLink}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {WORDS.cancel}
        </Button>
      </div>
    </div>
  );
}

/** Over a picture: only what is happening to it. */
function OverPicture({
  note,
  held,
}: {
  readonly note: string | undefined;
  readonly held: boolean;
}): React.JSX.Element | null {
  if (note !== undefined) {
    return (
      <p className="nx-image-state__problem" role="alert">
        {note}
      </p>
    );
  }
  return held ? (
    <p className="nx-image-state__words">{WORDS.dropToReplace}</p>
  ) : null;
}

/** The Image's choices: an empty one's three, or a missing file's Replace. */
function Choices(
  props: ImagePlateProps & {
    readonly missing: boolean;
    readonly note: string | undefined;
    readonly takesFiles: boolean;
  }
): React.JSX.Element {
  const { missing, note, writable, canUpload, takesFiles, onFiles } = props;
  const chooser = React.useRef<HTMLInputElement | null>(null);
  const Icon = missing ? ImageOff : ImagePlus;
  const hint = takesFiles && !missing;
  return (
    <div className="nx-image-state__stack">
      <Icon className="nx-image-state__icon" size={28} aria-hidden="true" />
      <p className="nx-image-state__title">
        {missing ? WORDS.missing : WORDS.title}
      </p>
      {writable ? (
        <ChoiceButtons {...props} upload={() => chooser.current?.click()} />
      ) : null}
      {note === undefined ? null : (
        <p className="nx-image-state__problem" role="alert">
          {note}
        </p>
      )}
      {note === undefined && hint ? (
        <p className="nx-image-state__hint">{WORDS.drop}</p>
      ) : null}
      {canUpload ? (
        <input
          ref={chooser}
          type="file"
          accept="image/*"
          className="nx-image-state__chooser"
          tabIndex={-1}
          aria-hidden="true"
          onChange={event => {
            onFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      ) : null}
    </div>
  );
}

/** The buttons: Upload, Media library and Link, or a missing file's Replace. */
function ChoiceButtons({
  missing,
  canUpload,
  canPick,
  upload,
  onLibrary,
  onLink,
}: ImagePlateProps & {
  readonly missing: boolean;
  readonly upload: () => void;
}): React.JSX.Element {
  if (missing) {
    return (
      <div className="nx-image-state__actions">
        {canPick ? (
          <Button type="button" size="sm" onClick={onLibrary}>
            {WORDS.replace}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="nx-image-state__actions">
      {canUpload ? (
        <Button type="button" size="sm" onClick={upload}>
          {WORDS.upload}
        </Button>
      ) : null}
      {canPick ? (
        <Button type="button" size="sm" variant="outline" onClick={onLibrary}>
          {WORDS.library}
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onLink("")}
      >
        {WORDS.link}
      </Button>
    </div>
  );
}

/** The Link choice: an address, checked before it is stored. */
function LinkForm({
  plate,
  activity,
  onTypeLink,
  onSubmitLink,
  onCancel,
}: ImagePlateProps & {
  readonly activity: Extract<Activity, { kind: "link" }>;
}): React.JSX.Element {
  const id = React.useId();
  const field = React.useRef<HTMLInputElement | null>(null);
  // Focused when the choice opens, as a dialog's first field is, and again
  // when "Try another link" brings it back.
  React.useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <form
      className="nx-image-state__link"
      onSubmit={event => {
        event.preventDefault();
        if (!activity.checking) onSubmitLink(activity.typed);
      }}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <label
        className="nx-image-state__words"
        htmlFor={`${id}-${plate.nodeId}`}
      >
        {WORDS.linkLabel}
      </label>
      <input
        id={`${id}-${plate.nodeId}`}
        className="nx-image-state__address"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://"
        ref={field}
        value={activity.typed}
        disabled={activity.checking}
        onChange={event => onTypeLink(event.currentTarget.value)}
      />
      <div className="nx-image-state__actions">
        <Button
          type="submit"
          size="sm"
          disabled={activity.checking || activity.typed.trim() === ""}
        >
          {activity.checking ? `${WORDS.checking}…` : WORDS.addLink}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {WORDS.cancel}
        </Button>
      </div>
    </form>
  );
}
