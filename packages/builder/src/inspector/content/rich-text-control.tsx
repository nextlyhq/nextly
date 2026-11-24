"use client";

/**
 * The rich text control: the field that edits a passage in place, and the
 * session it keeps while it is open.
 *
 * @module rich-text-control
 */

import {
  isOneParagraphProp,
  isRichTextValue,
  richTextToPlainText,
  toOneParagraph,
  type BlockDocument,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { richTextChanged } from "../../canvas/inline-rich-text";
import { TypingCancel } from "../../live-draft";
import { joinTyping } from "../../typing-run";
import { propLabel } from "../inspector";

import type { ContentControlProps, ContentServices } from "./content-services";
import {
  PropRefusalContext,
  refusalWords,
  type PropRefusal,
} from "./prop-refusal";
import { FULL_EDITOR_WORDS, RichTextFullEditor } from "./rich-text-full-editor";

/** The live attachment of the shared editor to this field, while focused. */
interface RichTextSession {
  focus(at?: number): void;
  read(): unknown;
  detach(): void;
  /** Keep this attachment against anything else asking for the editor. */
  hold(): void;
}

/** Said where the host has no editor for the panel: where it is edited. */
function canvasOnlyNote(oneParagraph: boolean): string {
  return oneParagraph
    ? "Text is edited on the canvas here."
    : "Rich text is edited on the canvas here.";
}

/** What a paste that lost formatting says under a one-paragraph field. */
export const ONE_PARAGRAPH_DROPPED =
  "Text keeps words, bold, italic and links. Use Rich text for headings and lists";

/**
 * A passage as one string, to tell one stored passage from another; empty
 * for one that cannot be written out (a cycle), which no stored one is.
 */
function passageKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** What the field's editor is attached with, for a one-paragraph value. */
type ParagraphMode = Parameters<
  Awaited<
    ReturnType<NonNullable<ContentServices["loadRichTextEditor"]>>
  >["attach"]
>[2];

/**
 * A one-paragraph value's attachment: held to one paragraph by the engine's
 * restriction, a paste that lost formatting said, and every change written as
 * it is typed, in this attachment's one run of typing.
 */
function typedLive(
  oneParagraph: boolean,
  run: object,
  onDropped: (dropped: boolean) => void,
  write: (value: unknown) => unknown
): ParagraphMode | undefined {
  if (!oneParagraph) return undefined;
  return {
    paragraph: {
      restrict: toOneParagraph,
      onDropped: () => onDropped(true),
      onChange: next => {
        joinTyping(run, () => write(next));
      },
    },
  };
}

/** Attach the shared editor, with the one-paragraph mode where there is one. */
function attachField(
  editor: Awaited<
    ReturnType<NonNullable<ContentServices["loadRichTextEditor"]>>
  >,
  element: HTMLElement,
  value: unknown,
  mode: ParagraphMode | undefined
) {
  return mode === undefined
    ? editor.attach(element, value)
    : editor.attach(element, value, mode);
}

/**
 * The passage the field writes when it is left: what the editor read,
 * restricted to one paragraph for a value that is one.
 */
function passageToWrite(
  read: unknown,
  oneParagraph: boolean,
  run: object | null
): unknown {
  if (!oneParagraph || run === null) return read;
  return toOneParagraph(read).value;
}

/**
 * Write the passage the field is left with, joined to the attachment's run
 * of typing for a value that is one paragraph.
 */
function writeLeft(
  next: unknown,
  oneParagraph: boolean,
  run: object | null,
  write: (value: unknown) => BlockDocument | null | void
): BlockDocument | null | void {
  if (!oneParagraph || run === null) return write(next);
  return joinTyping(run, () => write(next));
}

/**
 * The Content tab's rich-text prop: its name, and the passage under it.
 *
 * A whole passage (a Rich text's) also says where it is best edited, on the
 * canvas with the format bar, and offers "Open the full editor" for longer
 * work, where the host has an editor to open.
 */
export function RichTextControl({
  id,
  prop,
  disabled,
  onCommit,
  services,
}: ContentControlProps): React.JSX.Element {
  const oneParagraph = isOneParagraphProp(prop.schema);
  const label = propLabel(prop.name, prop.schema);
  const write = (value: unknown) => onCommit(prop.name, value);
  // Why a write of this prop was refused, where the panel can say.
  const why = React.useContext(PropRefusalContext);
  const refusalOf =
    why === undefined ? undefined : (value: unknown) => why(prop.name, value);
  return (
    <div
      className="nx-inspector__field"
      data-content-control={prop.schema.type}
    >
      <p className="nx-inspector__field-name" id={`${id}-label`}>
        {label}
      </p>
      <RichTextField
        id={id}
        labelledBy={`${id}-label`}
        value={prop.value}
        disabled={disabled}
        onCommit={write}
        refusalOf={refusalOf}
        services={services}
        oneParagraph={oneParagraph}
      />
      {oneParagraph || services?.loadRichTextEditor === undefined ? null : (
        <FullEditorEntry
          label={label}
          value={prop.value}
          disabled={disabled}
          onCommit={write}
          refusalOf={refusalOf}
          services={services}
        />
      )}
    </div>
  );
}

/**
 * The panel's line on where a Rich text is edited, and the button that opens
 * the full editor; closing it puts the focus back on the button, beside the
 * block still selected.
 */
function FullEditorEntry({
  label,
  value,
  disabled,
  onCommit,
  refusalOf,
  services,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  onCommit: (value: unknown) => BlockDocument | null | void;
  refusalOf: ((value: unknown) => PropRefusal) | undefined;
  services: ContentServices;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <p className="nx-inspector__note">{FULL_EDITOR_WORDS.line}</p>
      <Button
        ref={button}
        type="button"
        size="sm"
        variant="outline"
        className="nx-inspector__full-editor"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {FULL_EDITOR_WORDS.open}
      </Button>
      {open ? (
        <RichTextFullEditor
          label={label}
          value={value}
          onCommit={onCommit}
          refusalOf={refusalOf}
          services={services}
          onClose={() => setOpen(false)}
          returnFocus={() => button.current}
        />
      ) : null}
    </>
  );
}

/**
 * A passage's words for the field while no editor is attached: one line per
 * block, and one per item of a list, as the editor will lay them out, so the
 * field is as tall before it is focused as after.
 */
export function passagePreview(passage: RichTextValue): string {
  const lines: string[] = [];
  for (const block of passage.root.children) {
    const items =
      block.type === "list" && Array.isArray(block.children)
        ? block.children
        : [block];
    for (const item of items) {
      lines.push(
        richTextToPlainText({
          root: { ...passage.root, children: [item] },
        }).trim()
      );
    }
  }
  return lines.join("\n");
}

/**
 * A rich-text passage, edited in the inspector with the admin's one rich-text
 * editor. Shared by every surface that edits one: the Content tab's prop and a
 * placement's exposed field, each with its own label and write path.
 *
 * The editor is attached when the field is focused, loaded with the stored
 * passage, and what it reads is committed once when the field is left, so an
 * edit is one entry in the history. There is one editor for the whole admin:
 * while it is held on the canvas the field says so and writes nothing.
 *
 * Read-only is passed to the element itself: a disabled fieldset does not
 * stop typing in a `contenteditable`.
 */
export function RichTextField({
  id,
  labelledBy,
  value,
  disabled,
  onCommit,
  refusalOf,
  services,
  oneParagraph = false,
}: {
  id: string;
  /** The id of the element naming the field. */
  labelledBy: string;
  /**
   * The value is one paragraph of words with bold, italic, links and line
   * breaks (a Text's): edited held to that, and written as it is typed, the
   * typing joined into one step of the history, so the canvas shows the words
   * as they go in.
   */
  oneParagraph?: boolean;
  /** The passage stored, or `undefined` for none. */
  value: unknown;
  disabled: boolean;
  /**
   * Write the passage the editor reads; `null` when the write was refused,
   * which keeps the passage open with the author's words.
   */
  onCommit: (value: unknown) => BlockDocument | null | void;
  /**
   * Why a write was refused, asked once it is, so the field says the real
   * reason; without it the field does not guess one.
   */
  refusalOf?: ((value: unknown) => PropRefusal) | undefined;
  services: ContentServices | undefined;
}): React.JSX.Element {
  const field = React.useRef<HTMLDivElement>(null);
  const session = React.useRef<RichTextSession | null>(null);
  // Whether the field still has focus, so an editor that finishes loading
  // after the author has moved on is not attached to a field nobody is in.
  const focused = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [refused, setRefused] = React.useState<
    "held" | "unsupported" | "unsaved" | null
  >(null);
  // Why the last write was refused, while a refused passage is held open.
  const [reason, setReason] = React.useState<PropRefusal | undefined>(
    undefined
  );
  // What the page holds now, which the passage left is compared with.
  const storedNow = React.useRef(value);
  storedNow.current = value;
  // Takes back what this attachment's typing wrote, on Escape.
  const cancelTyping = React.useContext(TypingCancel);
  const load = services?.loadRichTextEditor;
  const editable = !disabled && load !== undefined;
  // A one-paragraph value is read through its restriction, so an older
  // string opens as its words and line breaks.
  const passage = oneParagraph ? toOneParagraph(value).value : value;
  // The run of typing this attachment's writes join, one per attachment.
  const typing = React.useRef<object | null>(null);
  const [dropped, setDropped] = React.useState(false);

  // Loaded as soon as the field is drawn, so focusing it attaches at once
  // rather than after a fetch the author would type through.
  React.useEffect(() => {
    if (editable) load().catch(() => undefined);
  }, [editable, load]);

  // The host's hold on this passage while it is open; see `OpenPassages`.
  const release = React.useRef<(() => void) | null>(null);

  const attach = async (): Promise<void> => {
    const element = field.current;
    if (!editable || element === null || session.current !== null) return;
    setLoading(true);
    let editor: Awaited<ReturnType<typeof load>>;
    try {
      editor = await load();
    } catch {
      // The editor could not be loaded: the field stays as it is, read-only.
      return;
    } finally {
      setLoading(false);
    }
    if (!focused.current || session.current !== null) return;
    typing.current = {};
    const attachment = attachField(
      editor,
      element,
      passage,
      typedLive(oneParagraph, typing.current, setDropped, next =>
        latestWrite.current(next)
      )
    );
    if (attachment.status === "refused") {
      setRefused(attachment.reason);
      return;
    }
    setRefused(null);
    session.current = attachment.session;
    // Finished through the latest render's `finish`, whose write path is the
    // current one.
    release.current =
      services?.openPassages?.hold(() => latestFinish.current()) ?? null;
    attachment.session.focus();
  };

  const finish = (): BlockDocument | null | void => {
    focused.current = false;
    const live = session.current;
    if (live === null) {
      release.current?.();
      release.current = null;
      return null;
    }
    // Read and written BEFORE letting go: the words exist in the editor alone.
    // A one-paragraph value is written restricted, joining its typing run.
    const next = passageToWrite(live.read(), oneParagraph, typing.current);
    // Nothing left to write: a Text's words were written as they were typed,
    // or the passage was not changed. Written again, the edit changes nothing,
    // which the page refuses, and that refusal is not one: the words are on
    // the page. The canvas's own passages are let go the same way.
    if (!richTextChanged(storedNow.current, next)) {
      letGo(live);
      return undefined;
    }
    const written = writeLeft(next, oneParagraph, typing.current, onCommit);
    if (written === null) {
      // Refused (a size cap, a lock that arrived): the passage stays open with
      // the author's words, held against anything else taking the editor,
      // until they shorten it or press Escape, as on the canvas. Said with
      // the reason the panel gives, not a guess.
      live.hold();
      setRefused("unsaved");
      setReason(refusalOf?.(next));
      return null;
    }
    letGo(live);
    return written;
  };

  /** End the attachment and the host's hold on it. */
  const letGo = (live: RichTextSession): void => {
    release.current?.();
    release.current = null;
    session.current = null;
    typing.current = null;
    live.detach();
    setRefused(null);
    setReason(undefined);
    setDropped(false);
  };

  /**
   * Escape on a refused passage: the words are let go, and so is what its
   * typing wrote, so the page and the canvas go back to what the box shows.
   * Where the typing can no longer be taken back (a save or another edit came
   * after it), the box shows what the page holds instead.
   */
  const discard = (live: RichTextSession): void => {
    const run = typing.current;
    letGo(live);
    const cancelled = run !== null && cancelTyping?.(run) === true;
    if (!cancelled && field.current !== null) {
      field.current.textContent = previewNow.current;
    }
  };

  // A write as the author types, through the latest render's write path.
  const latestWrite = React.useRef(onCommit);
  latestWrite.current = onCommit;

  // While no editor is attached, the field shows the passage's words, set on
  // the element rather than rendered as children: the editor takes the
  // element's contents over once attached, and React must not own them.
  const preview = isRichTextValue(passage) ? passagePreview(passage) : "";
  const previewNow = React.useRef(preview);
  previewNow.current = preview;
  // A stored passage that changes under words the document refused (a Reset,
  // an undo) is what the page now holds: the refused draft is let go and the
  // field shows the stored one, rather than the draft and its notice sitting
  // over a value that has moved on. Keyed on the whole passage, so a change
  // its plain text would not show is still seen.
  const storedKey = passageKey(value);
  const refusedNow = React.useRef(refused);
  refusedNow.current = refused;
  const latestLetGo = React.useRef(letGo);
  latestLetGo.current = letGo;
  React.useEffect(() => {
    const live = session.current;
    if (live !== null && refusedNow.current === "unsaved") {
      latestLetGo.current(live);
    }
    if (session.current === null && field.current !== null) {
      field.current.textContent = preview;
    }
  }, [storedKey, preview]);

  // A passage left open when the block changes or the panel goes is finished,
  // so nothing typed is lost and the shared editor is never left held. Read
  // through a ref so the cleanup commits with this render's write path.
  const latestFinish = React.useRef(finish);
  latestFinish.current = finish;
  React.useEffect(
    () => () => {
      latestFinish.current();
      // A passage the document refused stays open while its field is on
      // screen, where the author can shorten it or press Escape. Once the
      // field is gone it has no one to finish it, so it is let go rather
      // than left holding the shared editor and the unsaved state.
      const refused = session.current;
      if (refused !== null) {
        release.current?.();
        release.current = null;
        session.current = null;
        refused.detach();
      }
    },
    []
  );

  return (
    <>
      <div
        id={id}
        ref={field}
        className="nx-inspector__rich-text"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-readonly={!editable}
        aria-busy={loading}
        // Not editable until the shared editor attaches and makes it so:
        // keys typed into the bare element would be replaced by the stored
        // passage the moment the editor took the element over.
        tabIndex={0}
        onFocus={() => {
          focused.current = true;
          void attach();
        }}
        onBlur={finish}
        onKeyDown={event => {
          // Escape discards a change the document refused, deliberately.
          if (event.key !== "Escape" || refused !== "unsaved") return;
          const live = session.current;
          if (live === null) return;
          event.preventDefault();
          discard(live);
        }}
      />
      {refused === null ? null : (
        <p className="nx-inspector__note" role="status">
          {refused === "held"
            ? "This passage is being edited on the canvas. Finish there first."
            : refused === "unsaved"
              ? refusalWords(reason, "Escape")
              : "This passage can't be edited here."}
        </p>
      )}
      {dropped ? (
        <p className="nx-inspector__note" role="status">
          {ONE_PARAGRAPH_DROPPED}
        </p>
      ) : null}
      {load === undefined ? (
        <p className="nx-inspector__note">{canvasOnlyNote(oneParagraph)}</p>
      ) : null}
    </>
  );
}
