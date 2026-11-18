"use client";

/**
 * The full editor for a Rich text: a large editor in a dialog, opened from the
 * panel's "Open the full editor", for longer work than the canvas suits.
 *
 * ## The same editor and the same actions as the canvas
 *
 * The passage is attached to the admin's one rich-text editor, the one the
 * canvas and every rich-text field use, and its toolbar offers exactly what
 * the canvas's floating bar offers a Rich text: "B", "I", "Link", "H2", "H3",
 * bullets, numbers and quote, with the bar's words and faces. Nothing here can
 * make a passage the canvas could not then edit.
 *
 * ## Done keeps, Cancel discards
 *
 * The words reach the page only on Done, as one write and so one undo step.
 * Cancel lets them go. Escape and a click outside cancel too, but only while
 * nothing has changed: with changes, they say how to keep or discard them
 * instead of throwing the work away. Closing, either way, puts the focus back
 * on the button that opened it, beside the block still selected.
 *
 * @module rich-text-full-editor
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  BLOCK_BUTTON_FACES,
  blockIsOn,
  FORMAT_BAR_WORDS,
  linkTo,
} from "./canvas/format-actions";
import {
  isBlockAction,
  RICH_TEXT_FORMAT_ACTIONS,
  type FormatAction,
  type FormatSelection,
} from "./canvas/format-bar-state";
import { richTextChanged } from "./canvas/inline-rich-text";
import type { ContentServices } from "./content-services";
import { useModalKeyboardHold } from "./shell/modal-keyboard-hold";
import { BUILDER_TOKENS_CLASS } from "./shell-state";

/** The words the full editor and the panel line say, in one place. */
export const FULL_EDITOR_WORDS = {
  line: "Edit on the canvas. Select text for bold, links, headings and lists.",
  open: "Open the full editor",
  description: "Bold, italic, links, headings, lists and quotes.",
  done: "Done",
  cancel: "Cancel",
  unsaved: "Press Done to keep your changes, or Cancel to discard them.",
  held: "This passage is being edited on the canvas. Finish there first.",
  unsupported: "This passage can't be edited here.",
  refused:
    "This change could not be saved, perhaps because the page is at its size limit. Shorten it, or press Cancel to discard it.",
} as const;

/**
 * What the full editor offers: the canvas bar's Rich text actions, less
 * "Turn into", which changes the block rather than its words.
 */
const FULL_EDITOR_ACTIONS: readonly FormatAction[] =
  RICH_TEXT_FORMAT_ACTIONS.filter(action => action !== "turnInto");

/** The shared editor, as the services hand it over. */
type LoadedEditor = Awaited<
  ReturnType<NonNullable<ContentServices["loadRichTextEditor"]>>
>;

/** One attachment of it to the full editor's page. */
type Attached = Extract<
  ReturnType<LoadedEditor["attach"]>,
  { status: "attached" }
>["session"];

/** Why the editor could not be used here, or why Done did not close. */
type Note = "held" | "unsupported" | "refused" | "unsaved" | null;

const NOTES: Record<Exclude<Note, null>, string> = {
  held: FULL_EDITOR_WORDS.held,
  unsupported: FULL_EDITOR_WORDS.unsupported,
  refused: FULL_EDITOR_WORDS.refused,
  unsaved: FULL_EDITOR_WORDS.unsaved,
};

export interface RichTextFullEditorProps {
  /** The field's name, the dialog's title. */
  readonly label: string;
  /** The passage stored. */
  readonly value: unknown;
  /**
   * Write the passage; `null` when the write was refused, which keeps the
   * dialog open with the author's words.
   */
  readonly onCommit: (value: unknown) => BlockDocument | null | void;
  readonly services: ContentServices | undefined;
  /** Closed, by Done or Cancel. */
  readonly onClose: () => void;
  /** Where the focus goes back to on closing: the button that opened it. */
  readonly returnFocus: () => HTMLElement | null;
}

/** The full editor, open. Its parent mounts it while it is wanted. */
export function RichTextFullEditor({
  label,
  value,
  onCommit,
  services,
  onClose,
  returnFocus,
}: RichTextFullEditorProps): React.JSX.Element {
  // The page, as state: the dialog draws its content in a portal a render
  // after it opens, and the editor is attached once the page is there.
  const [page, setPage] = React.useState<HTMLDivElement | null>(null);
  const live = React.useRef<{ session: Attached; baseline: unknown } | null>(
    null
  );
  const release = React.useRef<(() => void) | null>(null);
  const [selection, setSelection] = React.useState<FormatSelection | null>(
    null
  );
  const [ready, setReady] = React.useState<Attached | null>(null);
  const [note, setNote] = React.useState<Note>(null);
  // The passage and the services it opened with, read once by the effect
  // that attaches it: a later stored value does not re-open the editor over
  // the words being typed.
  const opened = React.useRef({ value, services });
  useModalKeyboardHold("rich-text-full-editor", true);

  /** Let the editor go, writing nothing. */
  const letGo = React.useCallback(() => {
    release.current?.();
    release.current = null;
    const held = live.current;
    live.current = null;
    held?.session.detach();
  }, []);

  /**
   * Write the words. Answers the document the write produced, `null` when
   * there was nothing to write, or `false` when the page refused it, which
   * keeps the dialog open.
   */
  const keep = (): BlockDocument | null | false => {
    const held = live.current;
    if (held === null) return null;
    const words = held.session.read();
    if (!richTextChanged(held.baseline, words)) return null;
    const written = onCommit(words);
    if (written === null) {
      // Refused (a size cap, a lock that arrived): the words stay here, held
      // against anything else taking the editor, until shortened or let go.
      held.session.hold();
      setNote("refused");
      return false;
    }
    return written ?? null;
  };

  /**
   * Finish as Done does: write, let the editor go and close, answering the
   * document written, or `null` for none or for a refusal that keeps it open.
   */
  const finish = (): BlockDocument | null => {
    const written = keep();
    if (written === false) return null;
    letGo();
    onClose();
    return written;
  };
  // Read by the open passages' hold, which outlives this render.
  const latestFinish = React.useRef(finish);
  latestFinish.current = finish;

  const done = (): void => {
    finish();
  };
  const cancel = (): void => {
    letGo();
    onClose();
  };

  /** Escape or a click outside: a cancel while nothing has changed. */
  const dismiss = (event: Event): void => {
    const held = live.current;
    if (held !== null && richTextChanged(held.baseline, held.session.read())) {
      event.preventDefault();
      setNote("unsaved");
      return;
    }
    cancel();
  };

  // The passage is handed to the shared editor once the page is drawn, and
  // taken back however the dialog goes.
  React.useEffect(() => {
    const { value: passage, services: host } = opened.current;
    const load = host?.loadRichTextEditor;
    const element = page;
    if (load === undefined || element === null) return;
    let gone = false;
    void load().then(
      editor => {
        if (gone) return;
        const attachment = editor.attach(element, passage, {
          onSelection: setSelection,
        });
        if (attachment.status === "refused") {
          setNote(attachment.reason);
          return;
        }
        const session = attachment.session;
        live.current = { session, baseline: session.read() };
        // Held while open, so a Save finishes it as Done does, and is handed
        // the document the write produced to store, as every open passage's
        // finish hands it.
        release.current =
          host?.openPassages?.hold(() => latestFinish.current()) ?? null;
        setReady(session);
        session.focus();
      },
      () => {
        if (!gone) setNote("unsupported");
      }
    );
    return () => {
      gone = true;
      letGo();
    };
  }, [page, letGo]);

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        className={`${BUILDER_TOKENS_CLASS} nx-rich-text-editor`}
        onEscapeKeyDown={dismiss}
        onInteractOutside={dismiss}
        onCloseAutoFocus={event => {
          const target = returnFocus();
          if (target === null) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{FULL_EDITOR_WORDS.description}</DialogDescription>
        </DialogHeader>
        <FullEditorToolbar session={ready} selection={selection} />
        <div
          ref={setPage}
          className="nx-rich-text-editor__page"
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-busy={ready === null && note === null}
        />
        {note === null ? null : (
          <p className="nx-rich-text-editor__note" role="status">
            {NOTES[note]}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>
            {FULL_EDITOR_WORDS.cancel}
          </Button>
          <Button type="button" onClick={done}>
            {FULL_EDITOR_WORDS.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A press on the toolbar keeps the focus, and the selection, in the page. */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/**
 * Where an arrow, Home or End moves the toolbar's focus from button `at` of
 * `count`, wrapping; `undefined` for any other key.
 */
function movedTo(key: string, at: number, count: number): number | undefined {
  const moves: Record<string, number> = {
    ArrowRight: at + 1,
    ArrowLeft: at - 1,
    Home: 0,
    End: count - 1,
  };
  const to = moves[key];
  return to === undefined ? undefined : (to + count) % count;
}

/**
 * The full editor's toolbar: the canvas bar's Rich text buttons, said on as
 * the bar says them, pressing the same verbs. One tab stop, arrows between.
 */
function FullEditorToolbar({
  session,
  selection,
}: {
  session: Attached | null;
  selection: FormatSelection | null;
}): React.JSX.Element {
  const [linking, setLinking] = React.useState(false);
  // The one button Tab reaches; the arrows move it.
  const [stop, setStop] = React.useState(0);
  const disabled = session === null;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (linking) return;
    const to = movedTo(event.key, stop, FULL_EDITOR_ACTIONS.length);
    if (to === undefined) return;
    event.preventDefault();
    setStop(to);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>(".nx-rich-text-editor__button")
      [to]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={FORMAT_BAR_WORDS.bar}
      className="nx-rich-text-editor__toolbar"
      onKeyDown={onKeyDown}
    >
      {FULL_EDITOR_ACTIONS.map((action, index) => (
        <ToolbarButton
          key={action}
          action={action}
          session={session}
          selection={selection}
          disabled={disabled}
          tabbable={index === stop}
          onFocus={() => setStop(index)}
          onLink={() => setLinking(true)}
        />
      ))}
      {linking && session !== null ? (
        <LinkForm
          session={session}
          current={selection?.link ?? null}
          close={() => {
            setLinking(false);
            session.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** One of the toolbar's buttons. */
function ToolbarButton({
  action,
  session,
  selection,
  disabled,
  tabbable,
  onFocus,
  onLink,
}: {
  action: FormatAction;
  session: Attached | null;
  selection: FormatSelection | null;
  disabled: boolean;
  tabbable: boolean;
  onFocus: () => void;
  onLink: () => void;
}): React.JSX.Element | null {
  const common = {
    type: "button" as const,
    className: "nx-rich-text-editor__button",
    disabled,
    tabIndex: tabbable ? 0 : -1,
    onMouseDown: keepFocus,
    onFocus,
    "data-format-action": action,
  };
  if (action === "bold" || action === "italic") {
    const bold = action === "bold";
    return (
      <button
        {...common}
        aria-label={
          bold ? FORMAT_BAR_WORDS.boldName : FORMAT_BAR_WORDS.italicName
        }
        aria-pressed={selection?.[action] === true}
        aria-keyshortcuts={bold ? "Meta+B Control+B" : "Meta+I Control+I"}
        data-mark={action}
        onClick={() => session?.format?.(action)}
      >
        {bold ? FORMAT_BAR_WORDS.bold : FORMAT_BAR_WORDS.italic}
      </button>
    );
  }
  if (action === "link") {
    return (
      <button
        {...common}
        aria-pressed={selection?.link != null}
        onClick={onLink}
      >
        {FORMAT_BAR_WORDS.link}
      </button>
    );
  }
  if (!isBlockAction(action)) return null;
  const { face, name } = BLOCK_BUTTON_FACES[action];
  return (
    <button
      {...common}
      aria-label={name}
      aria-pressed={blockIsOn(selection, action)}
      onClick={() => session?.block?.(action)}
    >
      {face}
    </button>
  );
}

/** Where a link goes, for the words selected in the full editor. */
function LinkForm({
  session,
  current,
  close,
}: {
  session: Attached;
  current: FormatSelection["link"];
  close: () => void;
}): React.JSX.Element {
  const [address, setAddress] = React.useState(current?.url ?? "");
  const [newTab, setNewTab] = React.useState(current?.newTab ?? false);
  const [refused, setRefused] = React.useState(false);
  const errorId = React.useId();
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => input.current?.focus(), []);
  const link = {
    link: (url: string | null, options?: { readonly newTab?: boolean }) =>
      session.link?.(url, options),
  };
  return (
    <form
      className="nx-rich-text-editor__link"
      onSubmit={event => {
        event.preventDefault();
        if (linkTo(link, address, newTab, current !== null)) close();
        else setRefused(true);
      }}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        // Escape leaves the address, not the dialog.
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <input
        ref={input}
        type="text"
        inputMode="url"
        className="nx-rich-text-editor__address"
        aria-label={FORMAT_BAR_WORDS.address}
        placeholder={FORMAT_BAR_WORDS.addressHint}
        value={address}
        aria-invalid={refused}
        {...(refused ? { "aria-describedby": errorId } : {})}
        onChange={event => {
          setAddress(event.target.value);
          setRefused(false);
        }}
      />
      <label className="nx-rich-text-editor__new-tab">
        <input
          type="checkbox"
          checked={newTab}
          onChange={event => setNewTab(event.target.checked)}
        />
        {FORMAT_BAR_WORDS.newTab}
      </label>
      <Button type="submit" size="sm" variant="outline">
        {FORMAT_BAR_WORDS.apply}
      </Button>
      {current === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            session.link?.(null);
            close();
          }}
        >
          {FORMAT_BAR_WORDS.removeLink}
        </Button>
      )}
      {refused ? (
        <p id={errorId} role="alert" className="nx-rich-text-editor__error">
          {FORMAT_BAR_WORDS.badAddress}
        </p>
      ) : null}
    </form>
  );
}
