"use client";

/**
 * The text field every typed value is edited in: the draft over the stored
 * value, committing on blur, arrow-key steps, and how a stored value is
 * shown, edited and hinted.
 *
 * @module style-text-field
 */
import {
  isTokenRef,
  trimCssWhitespace,
  type SiteTokenSet,
  type TokenMode,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import * as React from "react";

import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { commitOnEnter } from "./commit-on-enter";
import { useFieldDescription } from "./css-hint";
import { isElement } from "./dom-kind";
import { useUnsetHint } from "./inherited-value";
import { fieldStep, scrubModifiersOf } from "./scrub-gesture";
import { CompactSides, fieldDescribedBy } from "./spacing-box";
import type { StyleControl, StyleControlKind } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { CSS_NUMBER } from "./style-numeric";
import { tokenForTypedName } from "./style-variables";

/**
 * The text a control is editing, over the value the document holds.
 *
 * One implementation for both fields that need it. A draft is not just local
 * state: it has to be REPLACED whenever the stored value moves underneath — an
 * undo, an edit applied from elsewhere — or the control goes on showing a value
 * the document no longer has, and the remount key changes with the SELECTION,
 * which neither of those changes.
 *
 * `edited` is the same comparison every caller was making to decide whether a
 * commit is worth attempting, so it is answered here rather than at each.
 */
export function useDraft(stored: StyleValue | undefined): {
  draft: string;
  setDraft: (value: string) => void;
  edited: boolean;
  reset: () => void;
} {
  const [draft, setDraft] = React.useState(() => storedText(stored));
  React.useEffect(() => {
    setDraft(storedText(stored));
  }, [stored]);
  return {
    draft,
    setDraft,
    edited: draft !== storedText(stored),
    reset: () => setDraft(storedText(stored)),
  };
}

/** A blur's commit, held while focus moves within one control. */
interface HoldBlur {
  /** Whether focus moving to `next` stays within the control. */
  readonly within: (next: EventTarget | null) => boolean;
  /** The commit held meanwhile, if any. */
  readonly held: React.RefObject<(() => void) | null>;
}

/**
 * Holds the number field's commit while focus moves to its own unit menu.
 *
 * Committed on that blur, a number typed and then given a unit was written
 * twice — "20px", then "20rem" — so one Undo left a value nobody asked for.
 * Held, the choice writes the number with its unit as one step; closing the
 * menu without a choice, or moving past it, writes the number as typed.
 */
export function useHeldBlur(
  /** The stored value as text; a held commit is dropped once it moves. */
  storedKey: string
): {
  holdBlur: HoldBlur;
  trigger: React.RefObject<HTMLButtonElement | null>;
  content: React.RefObject<HTMLDivElement | null>;
  choosing: (choose: (choice: string) => void) => (choice: string) => void;
  onOpenChange: (open: boolean) => void;
  onTriggerBlur: (event: React.FocusEvent) => void;
} {
  const held = React.useRef<(() => void) | null>(null);
  const open = React.useRef(false);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const content = React.useRef<HTMLDivElement | null>(null);
  // A value that moved under the held commit — an undo while the menu is
  // open — wins: writing the older typed text over it would reverse it.
  React.useEffect(() => {
    held.current = null;
  }, [storedKey]);
  // A field taken away with its menu open, as selecting another block does,
  // gets no close from the menu: the typed number is written as it goes.
  React.useEffect(
    () => () => {
      const commit = held.current;
      held.current = null;
      commit?.();
    },
    []
  );
  const within = (next: EventTarget | null): boolean =>
    isElement(next) &&
    (trigger.current?.contains(next) === true ||
      content.current?.contains(next) === true);
  const flush = () => {
    const commit = held.current;
    held.current = null;
    commit?.();
  };
  return {
    holdBlur: { within, held },
    trigger,
    content,
    // A choice writes the typed number with its unit, so the commit held on
    // the way to the menu is dropped rather than written first.
    choosing: choose => choice => {
      held.current = null;
      choose(choice);
    },
    onOpenChange: next => {
      open.current = next;
      if (!next) flush();
    },
    // Opening moves focus into the menu, which is not leaving the control.
    onTriggerBlur: event => {
      if (!open.current && !within(event.relatedTarget)) flush();
    },
  };
}

/**
 * A side's tooltip: its whole value, for one the narrow cell cannot show, or
 * none where there is nothing to show or the field is not a side.
 */
function sideTitle(compact: boolean, draft: string): string | undefined {
  return compact && draft !== "" ? draft : undefined;
}

/**
 * A text field's commit: the draft written, a variable's typed name matched
 * in the mode the canvas shows, as the field's variables list offers them.
 */
function useDraftCommit({
  draft,
  stored,
  control,
  tokens,
  onCommit,
  setDraft,
  setTyping,
}: {
  draft: string;
  stored: StyleValue | undefined;
  control: StyleControl;
  tokens: SiteTokenSet | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  setDraft: (value: string) => void;
  setTyping: (typing: boolean) => void;
}): () => void {
  const mode = useCanvasTokenMode();
  return () => {
    // Written or not, the text is no longer mid-edit.
    setTyping(false);
    commitDraft({
      draft,
      stored,
      kind: control.kind,
      leaf: control.leaf,
      tokens,
      mode,
      onCommit,
      setDraft,
    });
  };
}

/** Write a text field's draft, when it differs from what is stored. */
export function commitDraft({
  draft,
  stored,
  kind,
  leaf,
  tokens,
  mode,
  onCommit,
  setDraft,
}: {
  draft: string;
  stored: StyleValue | undefined;
  kind: StyleControlKind | undefined;
  /** The leaf the field edits, whose variables a typed name may pick. */
  leaf: StyleLeaf;
  /** The site's variables, so a variable's name typed here picks it. */
  tokens: SiteTokenSet | undefined;
  /** The mode the canvas shows, so typing matches what the list offers. */
  mode: TokenMode;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  setDraft: (value: string) => void;
}): void {
  if (draft === storedText(stored)) return;
  // CSS whitespace here too, not JavaScript's. `String.prototype.trim` also
  // strips NBSP and the Unicode spaces, so a draft of nothing but a
  // non-breaking space would read as empty and DELETE the declaration —
  // where the engine treats it as a value and refuses it.
  const emptied = trimCssWhitespace(draft) === "";
  // A variable's name typed in, "Display" or "Text", is that variable, asked
  // BEFORE the text is read as a value: read first, the word is refused as
  // "not a length" or stored as a literal no page can use.
  const named = emptied
    ? undefined
    : tokenForTypedName(leaf, tokens, draft, mode);
  const outcome = onCommit(
    emptied
      ? null
      : named === undefined
        ? committedValue(kind, draft)
        : { $token: named }
  );
  // The document did not move because it already holds this value in another
  // spelling: `01`, `+1` and `1e0` all commit as the `1` that is stored. The
  // effect above cannot cover it — `stored` is identical, so it does not fire
  // — and without this the field goes on showing text the document does not
  // contain until something remounts it. A REFUSAL deliberately keeps the
  // draft: the author has to be able to correct what they typed.
  if (outcome === "unchanged") setDraft(storedText(stored));
}

/**
 * What a number field shares with its text field: the commit it holds while
 * focus moves to its unit menu, and whether text was typed since focus, which
 * its unit suffix reads.
 */
interface FieldEditing {
  readonly holdBlur: HoldBlur;
  readonly typing: boolean;
  readonly setTyping: (typing: boolean) => void;
}

/**
 * The field's text and hint as shown: through `display` (which leaves out a
 * unit shown beside the field), except text typed since focus, shown as
 * typed.
 */
function shownText(
  display: ((text: string) => string) | undefined,
  typing: boolean,
  draft: string,
  hint: string
): { value: string; placeholder: string } {
  if (display === undefined) return { value: draft, placeholder: hint };
  return { value: typing ? draft : display(draft), placeholder: display(hint) };
}

/** Whether text was typed since focus: the caller's, else the field's own. */
function useTyping(
  editing: FieldEditing | undefined
): [boolean, (typing: boolean) => void] {
  const [own, setOwn] = React.useState(false);
  return editing === undefined
    ? [own, setOwn]
    : [editing.typing, editing.setTyping];
}

/**
 * The field's focus and blur: back in the field, a commit held for the unit
 * menu is superseded by the one this field's own blur makes; leaving for the
 * menu holds the commit; leaving elsewhere commits.
 */
function focusHandlers(
  holdBlur: HoldBlur | undefined,
  setTyping: (typing: boolean) => void,
  commit: () => void
): {
  onFocus: () => void;
  onBlur: (event: React.FocusEvent) => void;
} {
  return {
    onFocus: () => {
      if (holdBlur !== undefined) holdBlur.held.current = null;
    },
    onBlur: event => {
      if (holdBlur?.within(event.relatedTarget) === true) {
        setTyping(false);
        holdBlur.held.current = commit;
        return;
      }
      commit();
    },
  };
}

/**
 * A text field over one stored value.
 *
 * The draft is local so a half-typed value — `16` on the way to `16px` — is not
 * sent to the validator on every keystroke and refused four times while the
 * author is still typing.
 */
export function TextField({
  id,
  control,
  stored,
  draft,
  setDraft,
  tokens,
  describedBy,
  invalid,
  onCommit,
  onStep,
  display,
  fallbackHint,
  editing,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /**
   * The text being edited, owned by the caller.
   *
   * Lifted because a numeric row has TWO controls over one value — the field
   * and the unit menu — and a draft private to this one leaves the other
   * reading the stored value instead, which is a different and usually older
   * answer to what the author is editing.
   */
  draft: string;
  setDraft: (value: string) => void;
  /** The site's variables, so a variable's name typed here picks it. */
  tokens: SiteTokenSet | undefined;
  /**
   * Everything describing this field: a refusal message, a contrast verdict, or
   * both.
   *
   * Separate from {@link invalid}, and that separation is the point. A
   * description is not a complaint — a passing 21:1 contrast note is
   * supplementary text — so a field that inferred invalidity from having a
   * description would announce a perfectly good colour as invalid.
   */
  describedBy: string | undefined;
  /** Whether the LAST value was refused, which is the only thing that invalidates. */
  invalid: boolean;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /**
   * Applies one arrow-key step to the text currently shown, answering the text
   * that was written or `null` when nothing was.
   *
   * `null` leaves the key to its default behaviour, which is what keeps a value
   * that is not a single measurement — a shorthand, a function, a keyword —
   * behaving like ordinary text under the caret. The DRAFT is passed rather
   * than read from the store, so a step lands on what the author is looking at.
   */
  onStep?: (draft: string, delta: number) => string | null;
  /**
   * How the draft and the hint read in the field, where a unit shown beside
   * it is left out of both ("2" beside "rem"). The draft itself, which is
   * what commits and steps, is unchanged.
   */
  display?: (text: string) => string;
  /** The hint while nothing applies, in place of the leaf's own. */
  fallbackHint?: string;
  /** The number field's part in the edit; see {@link FieldEditing}. */
  editing?: FieldEditing | undefined;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  // Typed since focus: the text is then shown as typed, since a unit on its
  // way in ("2c" for "2ch") would read as a unit to leave out and be cut.
  const [typing, setTyping] = useTyping(editing);
  // A side of the spacing box says "–" while unset: a hint would not fit.
  const compact = React.useContext(CompactSides);
  const hint = useUnsetHint(unsetWords(compact, fallbackHint, control));
  const commit = useDraftCommit({
    draft,
    stored,
    control,
    tokens,
    onCommit,
    setDraft,
    setTyping,
  });

  return (
    <Input
      id={id}
      {...shownText(display, typing, draft, hint)}
      // A side of the spacing box is narrow: its whole value is in its
      // tooltip, for one the cell cannot show.
      title={sideTitle(compact, draft)}
      // A value, not words: no list of earlier entries over the field.
      autoComplete="off"
      aria-describedby={fieldDescribedBy(described, compact, id)}
      aria-invalid={invalid ? true : undefined}
      // Committed on blur and on Enter, matching the content tab: an op per
      // keystroke would make one undo remove one character.
      onChange={event => {
        setTyping(true);
        setDraft(event.target.value);
      }}
      {...focusHandlers(editing?.holdBlur, setTyping, commit)}
      onKeyDown={event => {
        if (commitOnEnter(event, commit)) return;
        // The draft follows the value that was written, so the field shows the
        // step immediately rather than waiting for `stored` to come back.
        stepOnKey(event, onStep, draft, next => {
          setDraft(next);
          setTyping(false);
        });
      }}
    />
  );
}

/**
 * An arrow key's step on the draft, where the field steps and the value can
 * be stepped; `written` receives the text that was written.
 */
function stepOnKey(
  event: React.KeyboardEvent,
  onStep: ((draft: string, delta: number) => string | null) | undefined,
  draft: string,
  written: (next: string) => void
): void {
  if (onStep === undefined) return;
  const delta = arrowStep(event);
  if (delta === null) return;
  // Stepped from the DRAFT rather than from what is stored, so the key works
  // while an author is mid-edit — which is most of when they reach for it.
  // Reading `stored` instead would either discard an uncommitted edit or, if
  // it declined to act, leave the arrow doing nothing in a text input that has
  // no numeric fallback: an affordance that appears broken exactly while it is
  // being used.
  const next = onStep(draft, delta);
  if (next === null) return;
  written(next);
  // Only once the step was applied, so an unsteppable value keeps the caret
  // movement the key would otherwise perform.
  event.preventDefault();
}

/**
 * The step one key press asks for, or `null` when it asks for none.
 *
 * Separated from the handler so that WHICH keys are claimed is one readable
 * answer rather than a run of early returns inside an event callback — and so
 * the two rules it encodes sit together, since they are easy to change apart
 * and wrong apart.
 *
 * Arrow steps by one, Shift by ten and Alt by a tenth, which is what Figma,
 * Framer and Webflow all do: an author arrives already knowing it, and a
 * different scale here would cost them for no gain. The sizes are the label
 * drag's own (`fieldStep`), so a modifier means the same on both.
 *
 * Alt+Up and Alt+Down are claimed only here, inside a number field: the
 * editor's block moves on those keys stay out of fields, where they would be
 * caret movement in a text field and are a step in this one.
 *
 * Control and Meta are refused outright. Those chords are platform, browser
 * and assistive-navigation shortcuts, so claiming one would mutate a style
 * and add an undo entry from a keystroke aimed somewhere else entirely.
 */
export function arrowStep(event: React.KeyboardEvent): number | null {
  // A keystroke arriving mid-composition belongs to the IME, which uses the
  // arrows to move through conversion candidates. Stepping there would edit the
  // style AND suppress the candidate move, so the author loses both. The
  // shortcut manager states the same rule for the same reason, and this is the
  // second reader of a keyboard event in this repository that has to know it.
  if (event.nativeEvent.isComposing) return null;
  if (event.ctrlKey || event.metaKey) return null;
  const direction =
    event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (direction === 0) return null;
  return direction * fieldStep(scrubModifiersOf(event));
}

/** A stored value as a text field shows it. */
export function storedText(value: StyleValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** How much of an unrepresentable value is worth showing before it stops helping. */
const DISPLAY_LIMIT = 80;

/**
 * A stored value as a READ-ONLY surface shows it, including one no field can
 * edit.
 *
 * Separate from {@link storedText}, which answers what a text field's draft
 * starts as and is right to give `""` for a shape it cannot type. Here `""`
 * would be a lie: the surface exists precisely because something IS stored, and
 * a blank one beside a Clear button tells an author to remove they-cannot-see-
 * what.
 */
export function displayText(value: StyleValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isTokenRef(value)) return value.$token;
  // Its own JSON, because there is nothing else honest to show: the value is
  // live on the page and the author is being asked whether to remove it.
  // Truncated because a panel column is not a document viewer, and a value long
  // enough to need this is already one nothing here can repair.
  const json = jsonText(value);
  return json.length > DISPLAY_LIMIT
    ? `${json.slice(0, DISPLAY_LIMIT)}…`
    : json;
}

/**
 * A value's JSON, or a stand-in when it has none.
 *
 * `JSON.stringify` THROWS on a circular reference rather than declining to
 * answer, and a panel that throws while rendering leaves the author with no
 * Clear button at all — which is the exact failure this surface exists to
 * prevent, arrived at from the other direction. Nothing in the document
 * pipeline can produce one today, since a stored document is parsed from JSON;
 * the guard is here because it costs one branch on a path that already decided
 * the value is unrepresentable.
 *
 * The fallback makes no claim about the value beyond being unable to show it,
 * which is what keeps it honest: the Clear beside it still works.
 */
function jsonText(value: StyleValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "(value cannot be shown)";
  }
}

/**
 * A stored value as this control's EDITING surface shows it, or `undefined`
 * when that surface cannot show it at all.
 *
 * Two shapes reach this. An object at a scalar position — `fontSize: {value:
 * "12px"}` from an import or the API — has no text spelling, and a text field
 * given `""` for it reads as UNSET while the value compiles; worse, the one
 * keystroke that would clear it is refused, because an emptied draft already
 * equals that empty projection. And a number stored where the leaf's vocabulary
 * is keywords has no item to be current, so the select renders its "Not set"
 * placeholder over a value that is doing something.
 *
 * Both are the same question — can the author see and change this here — so
 * they get one answer rather than a check in each control.
 */
export function editableText(
  control: StyleControl,
  value: StyleValue | undefined
): string | undefined {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "number") return undefined;
  return control.kind === "select" ? undefined : String(value);
}

/**
 * What a typed string is stored as.
 *
 * A `number` leaf takes a NUMBER, and accepts a string only as one of the
 * CSS-wide keywords — measured: `opacity: "0.5"` is refused where `opacity: 0.5`
 * is accepted. So a numeric-looking draft is converted and anything else is
 * passed through, which is what lets `inherit` reach a numeric property and
 * lets every other refusal carry the catalog's own message.
 *
 * Every other kind stores its value as written: a `dimension` accepts the
 * string `"0"` as readily as the number, so converting there would change what
 * is stored without changing what is valid.
 */
function committedValue(
  kind: StyleControlKind | undefined,
  draft: string
): StyleValue {
  if (kind !== "number") return draft;
  // The engine's own trim, not `String.prototype.trim`, which also strips NBSP
  // and the Unicode spaces where CSS strips neither. Trimming wider than CSS
  // does turns a spelling the engine REFUSES into a number it accepts: pasting
  // a non-breaking space before a digit would silently store the digit.
  const trimmed = trimCssWhitespace(draft);
  // `Number` reads spellings CSS does not: `0x10` becomes 16, `0b10` becomes 2,
  // `0o10` becomes 8. Converting those would store a number the author never
  // typed and pass validation, so only the grammar CSS calls a <number> is
  // converted and everything else is left for the catalog to judge.
  if (!CSS_NUMBER.test(trimmed)) return draft;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : draft;
}

/**
 * The hint for a kind whose form does not vary with the leaf's own fields.
 *
 * Partial on purpose, and the one place in this lane where a fallthrough is the
 * right answer: a placeholder is advisory text, so a leaf kind this build has
 * not learned about gets a generic hint rather than a compile error. Whether
 * the kind can be DRAWN at all is a different question, and `style-controls.ts`
 * already answers it with a mapped type that does fail to compile.
 */
const FIXED_PLACEHOLDER: Partial<Record<StyleLeaf["kind"], string>> = {
  keyword: "Not set",
  cssValue: "Not set",
  // The FORM rather than an example, as the length and number hints are. A
  // literal here would also be a hardcoded colour, which this repository bans
  // outright — the rule reads source, not intent, and it is right to: a hex in
  // a placeholder is one copy away from a hex in a style.
  // Short enough to read inside the field beside its swatch at the default
  // panel width, where "Name, hex or rgb()" was cut off mid-word. rgb() and
  // the other forms stay valid to type.
  color: "Name or hex",
  url: "https://…",
};

/**
 * A length's hint, which depends on what the catalog lets this one hold.
 *
 * The form alone, never the keyword list: a field shows about twenty
 * characters, and a hint cut off mid-word ("16px or 50%, or xx-sm…") says
 * less than a short one. The keywords stay valid to type.
 */
function dimensionHint(
  leaf: Extract<StyleLeaf, { kind: "dimension" }>
): string {
  // A line's width as a line is usually drawn: "16px" read as a heavy frame.
  if (/^(border|outline)(-.+)?-width$/.test(leaf.cssProperty)) return "1px";
  return leaf.allowPercentage === true ? "16px or 50%" : "16px";
}

/** A number's hint, which names its bounds when the catalog gives it both. */
function numberHint(leaf: Extract<StyleLeaf, { kind: "number" }>): string {
  if (leaf.min === undefined || leaf.max === undefined) return "a number";
  return `${leaf.min} to ${leaf.max}`;
}

/** A hint at the form this leaf takes, from the catalog rather than a list here. */
export function placeholderFor(control: StyleControl): string {
  const { leaf } = control;
  if (leaf.kind === "dimension") return dimensionHint(leaf);
  if (leaf.kind === "number") return numberHint(leaf);
  return FIXED_PLACEHOLDER[leaf.kind] ?? "Not set";
}

/**
 * What a field says while nothing is set: "–" on a side of the spacing box,
 * where a hint would not fit, else its own hint or the control's.
 */
function unsetWords(
  compact: boolean,
  fallbackHint: string | undefined,
  control: StyleControl
): string {
  return compact ? "–" : (fallbackHint ?? placeholderFor(control));
}
