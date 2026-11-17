"use client";

/**
 * The floating format bar: bold, italic and a link for the words selected in
 * a passage being edited on the canvas, drawn just above them.
 *
 * ## One bar, configured per block
 *
 * It draws the actions the passage it serves was opened with
 * ({@link FormatTarget.actions}): a Text is offered "B", "I", "Link" and
 * "Turn into". The verbs are the editor's own — the same ⌘B and ⌘I the keys
 * press — so a button and its shortcut cannot disagree.
 *
 * ## It never takes the caret away by pointer
 *
 * A press on the bar keeps the focus in the passage (`mousedown` is not
 * allowed to move it), so the selection the button acts on is still there.
 * The keyboard reaches it with Alt+F10, as it reaches every toolbar in the
 * builder; Escape goes back to the words. While the focus is in the bar on the
 * passage's behalf, the passage's blur does not finish the edit
 * ({@link FormatBarStore.holdsFocus}); leaving the bar for anywhere else does.
 *
 * ## Drawn in the canvas overlay, kept clear of the block bar
 *
 * Placed in the overlay's coordinates over the selected words, above them,
 * or below them where there is no room above on screen or the block bar is
 * there, so the two bars never cover each other.
 *
 * @module format-bar
 */

import { isLinkableUrl } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { isElement, isHTMLElement } from "../dom-kind";
import type { Rect } from "../geometry";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE } from "./canvas";
import { BLOCK_TOOLBAR_CLASS } from "./canvas-chrome";
import { overlaps } from "./canvas-tab-places";
import {
  formatBar,
  formatBarShown,
  type FormatAction,
  type FormatBarSnapshot,
  type FormatTarget,
} from "./format-bar-state";
import {
  canvasContentRect,
  overlaySpaceOf,
  selectedWordsRect,
} from "./geometry-dom";

/** The bar's class, and the notice's. */
const FORMAT_BAR_CLASS = "nx-format-bar";
const FORMAT_NOTICE_CLASS = "nx-format-notice";

/** The words the bar and its notice say, in one place. */
export const FORMAT_BAR_WORDS = {
  bar: "Text formatting",
  bold: "B",
  boldName: "Bold",
  italic: "I",
  italicName: "Italic",
  link: "Link",
  turnInto: "Turn into",
  address: "Link address",
  addressHint: "Paste or type an address",
  newTab: "Open in a new tab",
  apply: "Apply",
  removeLink: "Remove link",
  badAddress: "This address can't be used for a link.",
  dropped:
    "Text keeps words, bold, italic and links. Use Rich text for headings and lists",
  toRichText: "Turn into Rich text",
  dismiss: "Dismiss",
} as const;

/** How far the bar sits from the words it acts on, in overlay pixels. */
const GAP_PX = 6;

/** Where the bar is drawn, in the overlay's coordinates. */
interface Placed {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the block bar is drawn in the same layer, from the place it was
 * given and its size, or `undefined` while it is not drawn.
 */
function blockBarBox(
  bar: HTMLElement,
  sizeOf: (element: HTMLElement) => { width: number; height: number }
): Rect | undefined {
  const blockBar = bar.parentElement?.querySelector(`.${BLOCK_TOOLBAR_CLASS}`);
  if (!isHTMLElement(blockBar)) return undefined;
  const x = Number.parseFloat(blockBar.style.left);
  const y = Number.parseFloat(blockBar.style.top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y, ...sizeOf(blockBar) };
}

/**
 * Where the bar goes for the words in `target`: above them, or below where
 * the space above is off screen or under the block bar. `null` when the
 * passage is not in this overlay's canvas.
 */
function placeBar(bar: HTMLElement, target: FormatTarget): Placed | null {
  const space = overlaySpaceOf(bar, CANVAS_ROOT_CLASS);
  if (space === null || !space.root.contains(target.element)) return null;
  const words = space.place(selectedWordsRect(target.element, space.root));
  const size = space.sizeOf(bar);
  const width = space.place(canvasContentRect(space.root, space.root)).width;
  const x = Math.max(0, Math.min(words.x, width - size.width));
  const above = { x, y: words.y - size.height - GAP_PX };
  const below = { x, y: words.y + words.height + GAP_PX };
  const blockBar = blockBarBox(bar, space.sizeOf);
  const blocked =
    blockBar !== undefined && overlaps({ ...above, ...size }, blockBar);
  return above.y < 0 || blocked ? below : above;
}

/** The bar's buttons, in order, for the passage it serves. */
function drawnActions(target: FormatTarget): readonly FormatAction[] {
  return target.actions.filter(
    action => action !== "turnInto" || target.turnInto !== undefined
  );
}

/** Keep a press on the bar from taking the focus out of the passage. */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/**
 * Give the words back their caret, then let the passage finish on its own
 * blur again: in that order, so the move back is not read as leaving.
 */
function backToWords(target: FormatTarget): void {
  target.session.focus();
  formatBar.setHoldsFocus(false);
}

/**
 * Link the selected words to `address`, answering whether it was taken: an
 * empty address takes a link off (or does nothing), and one this format
 * cannot express — `javascript:`, `data:` — is refused.
 */
function linkTo(
  target: FormatTarget,
  address: string,
  newTab: boolean,
  linked: boolean
): boolean {
  const url = address.trim();
  if (url === "") {
    if (linked) target.session.link(null);
    return true;
  }
  if (!isLinkableUrl(url)) return false;
  target.session.link(url, { newTab });
  return true;
}

/** Escape in the address field closes it, and goes no further. */
function escapeCloses(event: React.KeyboardEvent, close: () => void): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

/** "Remove link", offered while the selected words are a link. */
function RemoveLink({
  shown,
  target,
  close,
}: {
  shown: boolean;
  target: FormatTarget;
  close: () => void;
}): React.JSX.Element | null {
  if (!shown) return null;
  return (
    <button
      type="button"
      className={`${FORMAT_BAR_CLASS}__button`}
      onClick={() => {
        target.session.link(null);
        close();
      }}
    >
      {FORMAT_BAR_WORDS.removeLink}
    </button>
  );
}

/** Why an address was refused, read out as it is said. */
function RefusedAddress({
  id,
  shown,
}: {
  id: string;
  shown: boolean;
}): React.JSX.Element | null {
  if (!shown) return null;
  return (
    <p id={id} className={`${FORMAT_BAR_CLASS}__error`} role="alert">
      {FORMAT_BAR_WORDS.badAddress}
    </p>
  );
}

/** The address field: where a link goes, and whether it opens a new tab. */
function LinkField({
  state,
  target,
}: {
  state: FormatBarSnapshot;
  target: FormatTarget;
}): React.JSX.Element {
  const current = state.selection?.link ?? null;
  const [address, setAddress] = React.useState(current?.url ?? "");
  const [newTab, setNewTab] = React.useState(current?.newTab ?? false);
  const [refused, setRefused] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const errorId = React.useId();
  React.useEffect(() => {
    formatBar.setHoldsFocus(true);
    input.current?.focus();
  }, []);
  const close = (): void => {
    formatBar.setLinking(false);
    backToWords(target);
  };
  const apply = (): void => {
    if (linkTo(target, address, newTab, current !== null)) close();
    else setRefused(true);
  };
  return (
    <form
      className={`${FORMAT_BAR_CLASS}__link`}
      onSubmit={event => {
        event.preventDefault();
        apply();
      }}
      onKeyDown={event => escapeCloses(event, close)}
    >
      <input
        ref={input}
        className={`${FORMAT_BAR_CLASS}__address`}
        type="url"
        inputMode="url"
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
      <label className={`${FORMAT_BAR_CLASS}__new-tab`}>
        <input
          type="checkbox"
          checked={newTab}
          onChange={event => setNewTab(event.target.checked)}
        />
        {FORMAT_BAR_WORDS.newTab}
      </label>
      <button type="submit" className={`${FORMAT_BAR_CLASS}__button`}>
        {FORMAT_BAR_WORDS.apply}
      </button>
      <RemoveLink shown={current !== null} target={target} close={close} />
      <RefusedAddress id={errorId} shown={refused} />
    </form>
  );
}

/** What every button of the bar shares. */
interface ButtonProps {
  readonly action: FormatAction;
  readonly state: FormatBarSnapshot;
  readonly target: FormatTarget;
  readonly tabbable: boolean;
  readonly onFocusHere: () => void;
}

/** The attributes every button of the bar carries. */
function commonOf(props: ButtonProps) {
  return {
    type: "button" as const,
    className: `${FORMAT_BAR_CLASS}__button`,
    tabIndex: props.tabbable ? 0 : -1,
    onMouseDown: keepFocus,
    onFocus: props.onFocusHere,
    "data-format-action": props.action,
  };
}

/** B or I: a mark, said on when the selected words carry it. */
function MarkButton(
  props: ButtonProps & { readonly mark: "bold" | "italic" }
): React.JSX.Element {
  const { mark, state, target } = props;
  const bold = mark === "bold";
  return (
    <button
      {...commonOf(props)}
      aria-label={
        bold ? FORMAT_BAR_WORDS.boldName : FORMAT_BAR_WORDS.italicName
      }
      aria-pressed={state.selection?.[mark] === true}
      aria-keyshortcuts={bold ? "Meta+B Control+B" : "Meta+I Control+I"}
      data-mark={mark}
      onClick={() => target.session.format(mark)}
    >
      {bold ? FORMAT_BAR_WORDS.bold : FORMAT_BAR_WORDS.italic}
    </button>
  );
}

/** Link: opens the address field, said on when the words are a link. */
function LinkButton(props: ButtonProps): React.JSX.Element {
  return (
    <button
      {...commonOf(props)}
      aria-pressed={props.state.selection?.link != null}
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => formatBar.setLinking(true)}
    >
      {FORMAT_BAR_WORDS.link}
    </button>
  );
}

/** One button of the bar. */
function ActionButton(props: ButtonProps): React.JSX.Element {
  const { action, target } = props;
  if (action === "bold" || action === "italic") {
    return <MarkButton {...props} mark={action} />;
  }
  if (action === "link") return <LinkButton {...props} />;
  return (
    <button
      {...commonOf(props)}
      aria-haspopup="menu"
      onClick={() => target.turnInto?.()}
    >
      {FORMAT_BAR_WORDS.turnInto}
    </button>
  );
}

/**
 * The notice a change that lost formatting leaves under the passage: what a
 * Text keeps, and the way to Rich text where the host offers it.
 */
function DroppedNotice({
  target,
}: {
  target: FormatTarget;
}): React.JSX.Element {
  return (
    <div
      className={FORMAT_NOTICE_CLASS}
      role="status"
      {...{ [CHROME_ATTRIBUTE]: "" }}
      onMouseDown={keepFocus}
    >
      <span>{FORMAT_BAR_WORDS.dropped}</span>
      {target.turnInto === undefined ? null : (
        <button
          type="button"
          className={`${FORMAT_NOTICE_CLASS}__action`}
          onClick={() => target.turnInto?.()}
        >
          {FORMAT_BAR_WORDS.toRichText}
        </button>
      )}
      <button
        type="button"
        className={`${FORMAT_NOTICE_CLASS}__action`}
        onClick={() => formatBar.setDropped(false)}
      >
        {FORMAT_BAR_WORDS.dismiss}
      </button>
    </div>
  );
}

/** The notice's place: just under the passage, in the overlay. */
function useNoticePlace(
  notice: React.RefObject<HTMLDivElement | null>,
  target: FormatTarget | null,
  shown: boolean
): Placed | null {
  const [place, setPlace] = React.useState<Placed | null>(null);
  React.useLayoutEffect(() => {
    const element = notice.current;
    if (!shown || element === null || target === null) {
      setPlace(null);
      return;
    }
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null || !space.root.contains(target.element)) {
      setPlace(null);
      return;
    }
    const box = space.place(canvasContentRect(target.element, space.root));
    setPlace({ x: box.x, y: box.y + box.height + GAP_PX });
  }, [notice, target, shown]);
  return place;
}

/**
 * The bar, and the notice, for the passage being edited, drawn in the canvas
 * overlay it is mounted in. Draws nothing while no passage it serves is open.
 */
export function FormatBar(): React.JSX.Element | null {
  const state = React.useSyncExternalStore(
    formatBar.subscribe,
    formatBar.get,
    formatBar.get
  );
  const bar = React.useRef<HTMLDivElement>(null);
  const notice = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState<Placed | null>(null);
  const [stop, setStop] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const { target } = state;
  const shown = target !== null && (formatBarShown(state) || focused);
  const actions = target === null ? [] : drawnActions(target);

  React.useLayoutEffect(() => {
    const element = bar.current;
    if (!shown || element === null || target === null) {
      setPlaced(null);
      return;
    }
    setPlaced(placeBar(element, target));
  }, [shown, target, state.selection, state.linking]);

  // Alt+F10 from the words: the bar takes the focus, on its tab stop.
  const asked = React.useRef(state.focusRequest);
  React.useEffect(() => {
    if (state.focusRequest === asked.current) return;
    asked.current = state.focusRequest;
    const element = bar.current;
    if (element === null) return;
    formatBar.setHoldsFocus(true);
    element.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [state.focusRequest]);

  const noticePlace = useNoticePlace(notice, target, state.dropped);

  if (target === null) return null;

  const focusAt = (index: number): void => {
    const buttons = bar.current?.querySelectorAll<HTMLElement>(
      `.${FORMAT_BAR_CLASS}__button`
    );
    const count = buttons?.length ?? 0;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    setStop(next);
    buttons?.[next]?.focus();
  };

  return (
    <>
      <div
        ref={bar}
        className={FORMAT_BAR_CLASS}
        {...{ [CHROME_ATTRIBUTE]: "" }}
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={FORMAT_BAR_WORDS.bar}
        hidden={!shown}
        data-linking={state.linking ? "" : undefined}
        style={{
          left: placed?.x ?? 0,
          top: placed?.y ?? 0,
          visibility: placed === null ? "hidden" : undefined,
        }}
        onFocus={() => {
          formatBar.setHoldsFocus(true);
          setFocused(true);
        }}
        onBlur={event => {
          const next = event.relatedTarget;
          if (isElement(next) && bar.current?.contains(next)) return;
          setFocused(false);
          // Read once the focus has landed: back in the words is still
          // editing; anywhere else finishes the edit, as leaving the words
          // does.
          const passage = target.element;
          setTimeout(() => {
            if (bar.current?.contains(bar.current.ownerDocument.activeElement))
              return;
            const inWords =
              passage.ownerDocument.activeElement === passage &&
              passage.ownerDocument.hasFocus();
            formatBar.setHoldsFocus(false);
            if (!inWords) target.finish();
          }, 0);
        }}
        onKeyDown={event => {
          if (state.linking) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            backToWords(target);
            return;
          }
          const moves: Record<string, number> = {
            ArrowRight: stop + 1,
            ArrowLeft: stop - 1,
            Home: 0,
            End: actions.length - 1,
          };
          const to = moves[event.key];
          if (to === undefined) return;
          event.preventDefault();
          focusAt(to);
        }}
      >
        {state.linking ? (
          <LinkField state={state} target={target} />
        ) : (
          actions.map((action, index) => (
            <ActionButton
              key={action}
              action={action}
              state={state}
              target={target}
              tabbable={index === Math.min(stop, actions.length - 1)}
              onFocusHere={() => setStop(index)}
            />
          ))
        )}
      </div>
      {state.dropped ? (
        <div
          ref={notice}
          className={`${FORMAT_NOTICE_CLASS}__place`}
          style={{
            left: noticePlace?.x ?? 0,
            top: noticePlace?.y ?? 0,
            visibility: noticePlace === null ? "hidden" : undefined,
          }}
        >
          <DroppedNotice target={target} />
        </div>
      ) : null}
    </>
  );
}
