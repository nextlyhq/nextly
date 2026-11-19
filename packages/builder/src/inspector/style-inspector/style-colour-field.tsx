"use client";

/**
 * The colour field: its picker, trigger, custom colour and colour variables,
 * the contrast note against its partner colour, and the rules for how the
 * picker closes when another control writes the same value.
 *
 * @module style-colour-field
 */
import {
  isRawColour,
  isTokenRef,
  type ContrastResult,
  type NodeStyles,
  type SiteTokenSet,
  type TokenMode,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  ColorPicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { HiddenColours } from "../../built-in-colours";
import { ChoiceList } from "../../choice-list";
import { isElement } from "../../dom-kind";
import { useLiveGesture } from "../../live-gesture";
import {
  RecentColoursStore,
  rememberColour,
  useRecentColours,
} from "../../recent-colours";
import type { PreferenceStore } from "../../shell-state";
import {
  activeTokenMode,
  colourHexOf,
  variableFor,
  variableLabel,
  shownVariables,
  variablesFor,
  contrastAtLeaf,
  contrastPartnerOf,
  contrastRatioText,
  type SiteVariable,
} from "../../style-colour";
import type { StyleControl } from "../../style-controls";
import { readStyleValue, type StyleAddress } from "../../style-values";
import {
  focusAfterUnlink,
  UnlinkButton,
  VariableTipped,
  variableTip,
} from "../../variable-choice";
import { ColourPair, swatchStyle } from "../../variable-swatch";
import { useFieldDescription } from "../css-hint";

import { InheritedValue } from "./inherited-value";
import type { CommitOutcome } from "./style-field-surroundings";
import { useDraft, TextField, useTypesLive } from "./style-text-field";

/**
 * Whether Control held with a primary press means a CONTEXT MENU here.
 *
 * It does on macOS and nowhere else: there the platform opens a menu and no
 * click follows, while on Windows and Linux a Control-click is an ordinary
 * modified click and the button runs exactly as it always does.
 *
 * So this cannot be answered without asking the platform, and the platform is
 * asked by NAME because nothing else decides it. There is no structural probe
 * for "will a click follow this press" that can be run before the click either
 * arrives or does not — which is the same reason the whole supersede is
 * predicted at press time rather than confirmed.
 *
 * `userAgentData` first because `platform` is deprecated, and both because the
 * modern one is Chromium-only. Neither present — a non-browser runtime —
 * answers `false`, which is the ordinary-click reading and the one that keeps
 * the two-write defect closed.
 */
function contextMenuModifier(): boolean {
  const agent: { platform?: string } | undefined = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const name = agent?.platform ?? navigator.platform ?? "";
  return /mac/i.test(name);
}

/**
 * Whether a press can actually RUN the control it landed on.
 *
 * Only a press that will be followed by a click can, and two gestures report a
 * pointer press while invoking nothing: a secondary press anywhere, and a
 * Control-held primary press on macOS.
 *
 * Both directions cost something, which is why the platform is asked rather
 * than the modifier alone. Reading a context menu as an activation discards the
 * colour an author was composing on behalf of a button that never ran. Reading
 * an ordinary Control-click as a context menu does the opposite: the picker
 * commits its draft on dismissal AND the button's click writes, so one gesture
 * becomes two edits and the first undo restores the colour they pressed Reset
 * to be rid of — the defect the supersede exists to prevent, reintroduced.
 *
 * The remainder is stated rather than left to be discovered: a primary press
 * that DRAGS OFF the control and releases elsewhere fires no click either, and
 * is still read here as an activation. Closing that needs the write to confirm
 * the discard instead of the press predicting it — either holding the draft for
 * a later signal, which is the timer this module removed and whose cancellation
 * cost a race, or routing the marked control's write back through this field,
 * which the declaration exists to avoid.
 */
function activates(event: PointerEvent): boolean {
  if (event.button !== 0) return false;
  return !(event.ctrlKey && contextMenuModifier());
}

/**
 * Which field a control writes the value of, when it is not that field.
 *
 * The colour picker commits its gesture when the popover closes, and pressing
 * anything outside it closes the popover first. A control that writes the SAME
 * value the picker is composing therefore has to say so, or one intent produces
 * two edits and the first undo restores the value the author pressed the
 * control to be rid of.
 *
 * Stated as the field's id rather than as a bare flag, because the question is
 * not "does this control write" — every control does — but "does it write what
 * this picker is holding". A bare flag makes Reset on `background-color`
 * supersede an open picker on `color`, discarding a gesture nothing replaced.
 *
 * Declared on the element rather than handed down as a ref, because the
 * controls making the promise live in components with no path to the picker:
 * a breakpoint Reset is drawn beside the control, not inside it.
 */
const COMMITS_FOR = "data-nx-commits-for";

/**
 * How a picker's popover closed: with its gesture written, or superseded.
 *
 * Named rather than left as a boolean, because the two are not "did something
 * happen" — both are outcomes the host must ACT on, and the discard is the one
 * a boolean invites a caller to express by doing nothing.
 */
type PickerClose = "committed" | "superseded";

/**
 * The attributes marking a control as writing `fieldId`'s value itself.
 *
 * Exported with {@link supersedes} so the pair can be checked together.
 */
export function commitsFor(fieldId: string): Record<string, string> {
  return { [COMMITS_FOR]: fieldId };
}

/**
 * Whether an interaction outside the picker writes `fieldId`'s value itself.
 *
 * Asked of the ancestor chain rather than of the target alone: the press lands
 * on whatever the control renders inside its button, and a control that puts a
 * span or an icon in there would otherwise stop making the promise.
 *
 * The target is classified by `dom-kind` rather than by `instanceof Element`,
 * which answers only for elements this window built.
 */
export function supersedes(
  target: EventTarget | null,
  fieldId: string
): boolean {
  if (!isElement(target)) return false;
  return (
    target.closest(`[${COMMITS_FOR}]`)?.getAttribute(COMMITS_FOR) === fieldId
  );
}

/**
 * The other half of a contrast pair, for a leaf that has one.
 *
 * Read from THIS node at the same state and breakpoint the control edits,
 * which is narrower than the cascade and is the honest limit of what this panel
 * can answer today: a background arriving from a named class, a block default
 * or a wider breakpoint is not seen, so the readout reports nothing rather than
 * measuring against a background that is not the one on the page.
 *
 * Answering it properly means asking `styleProvenance`, which has already
 * settled tier order, both breakpoint axes, states and specificity — and which
 * needs a `trace` of compiled declarations that nothing supplies to this panel.
 * Walking the cascade a second time HERE is the thing that must not happen.
 *
 * The address is reused rather than rebuilt so the state and breakpoint cannot
 * drift from the ones the control is reading its own value at — a pair measured
 * across two breakpoints is two colours that are never drawn together.
 */
export function partnerColour(
  leaf: StyleLeaf,
  styles: NodeStyles | undefined,
  address: StyleAddress
): StyleValue | undefined {
  const property = contrastPartnerOf(leaf);
  if (property === undefined) return undefined;
  return readStyleValue(styles, { ...address, property, path: [] });
}

/**
 * Every id describing one control, or `undefined` when nothing does.
 *
 * A refusal message and a contrast verdict are both descriptions and neither
 * replaces the other: a control pointed only at the refusal never announces the
 * verdict, and one pointed only at the verdict drops the reason its last value
 * was refused. Joined here so the two cannot be traded off at a call site.
 *
 * Note what this deliberately does NOT decide: whether the control is INVALID.
 * A passing 21:1 contrast note is supplementary text, and a control inferring
 * invalidity from having a description announced a perfectly good colour as an
 * error.
 */
function describedByAll(
  refusal: string | undefined,
  verdict: string | undefined
): string | undefined {
  return (
    [refusal, verdict].filter(part => part !== undefined).join(" ") || undefined
  );
}

/**
 * Whether opening the picker here would REPLACE something the author has.
 *
 * True when the surface cannot show the stored value and there is a stored
 * value to lose — a reference, or non-empty text. The picker then starts at its
 * fallback rather than at the value, so the first movement writes something
 * unrelated to what was there, and the author is owed a warning first.
 *
 * The reference has to be tested explicitly: `storedText` answers `""` for one,
 * so a predicate reading the draft alone missed every token — including the two
 * that most need the warning, a token the site no longer defines and one whose
 * value this package cannot resolve.
 */
function wouldReplace(
  shown: string | undefined,
  reference: string | null,
  draft: string
): boolean {
  if (shown !== undefined) return false;
  return reference !== null || draft !== "";
}

/**
 * The hex a picker opens on when the stored value cannot be decomposed.
 *
 * Black, and it is never WRITTEN by being shown: the picker reports a colour
 * only when the author moves something. So this is where the surface starts for
 * a value it cannot represent, not a value substituted for one.
 */
const PICKER_FALLBACK = "#000000";

/**
 * A colour: a swatch that opens a picker, beside the field that owns the value.
 *
 * **The text field remains the control**, exactly as it does for a length. A
 * stored colour may be `oklch()`, `color-mix()`, a named colour, `currentcolor`,
 * a CSS-wide keyword or a `var()`, and a control that modelled the value as
 * RGBA would write every one of them away the moment it opened. The picker is
 * an affordance on top, and it reports nothing until the author moves it.
 *
 * **A token reference is EDITABLE here rather than read-only**, which is the
 * other half of what this control adds: it shows the token's CURRENT name on
 * its own trigger, in green with its swatch, and lets the author swap it, or
 * Unlink it to the colour it gives now. Every other field shows a held
 * variable as a green chip, its name the way to choose another, instead.
 *
 * **A token is stored by IDENTITY, never by the name shown.** The two differ
 * after a rename, and `SiteVariable` carries both for that reason — the list
 * hands back the variable it was given, so the identity travels with it and
 * the label never reaches the document.
 *
 * **Literal and token are exclusive**, which is what the two layouts express.
 * The same rule Gutenberg's palette follows: a value is a reference or a
 * colour, and nothing sensible reads as both at once.
 */
export function ColourField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  tokens,
  prefersDark,
  pairedColour,
  obscuredBy,
  describedBy,
  onCommit,
  onType,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "color" }> };
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  pairedColour: StyleValue | undefined;
  /**
   * A property on this node that puts something between the pair, or
   * `undefined` when none does. A verdict is withheld while one is set.
   */
  obscuredBy: string | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /**
   * The write a keystroke or a picker move makes where the panel writes as
   * it is typed, where it is not the field's own: a shadow variable's colour
   * is drawn on the canvas meanwhile and stored once, by the commit, when the
   * edit ends. `onCommit` when omitted.
   */
  onType?: ((value: StyleValue | null) => CommitOutcome) | undefined;
}): React.JSX.Element {
  const noteId = React.useId();
  // Lifted out of the text field because two controls edit one value: a draft
  // private to the field would leave the swatch painting a superseded one.
  const { draft, setDraft, edited, reset, live } = useDraft(stored);
  const commitColour = rememberingCommit(
    onCommit,
    React.useContext(RecentColoursStore)
  );

  const reference = isTokenRef(stored) ? stored.$token : null;
  const mode = activeTokenMode(prefersDark);
  // Without the built-in colours the site hides, as every picker lists them.
  const choices = shownVariables(
    variablesFor(control.leaf, tokens, mode),
    React.useContext(HiddenColours),
    reference
  );
  // A keystroke's and a picker move's write.
  const typed = typedOrCommitted(onType, onCommit);
  const { commitInstead, closed, onColour } = usePickerWrites({
    commitColour,
    onMove: typed,
    reset,
    setDraft,
  });
  // What the surface is currently SHOWING: the draft while a literal is being
  // typed, so the swatch follows the field, and the stored value for a
  // reference, which no field is editing. Named once and resolved once, rather
  // than resolved in each branch — two calls to the same resolver is the shape
  // that drifts.
  // Once the draft has MOVED, it is what the surface shows — including over a
  // stored token. Pinned to `stored` for a reference, the picker was handed the
  // token's own hex again on every render, and its prop-sync effect reset the
  // surface to it: the controls snapped back mid-drag and a token could not be
  // replaced with a literal by using the picker at all.
  const storedLabel = storedTokenLabel(reference, tokens, mode, choices);
  // The variable held, as the canvas shows it, for the trigger's tooltip and
  // for Unlink; `undefined` for a value, none, or a variable the site lacks.
  const held = heldVariable(reference, tokens, mode);
  const showing = reference === null || edited ? draft : stored;
  const shown = colourHexOf(showing, tokens, mode);
  // Measured from what the surface is SHOWING, which is the same value the
  // swatch is painted from. Reading `stored` instead left the verdict describing
  // the old colour for the whole of a picker gesture — stale exactly while an
  // author is choosing, which is when a contrast readout is for — and put the
  // swatch and the figure beside it on two different colours.
  const { contrast, describes } = contrastReading({
    leaf: control.leaf,
    showing,
    pairedColour,
    tokens,
    mode,
    obscuredBy,
    describedBy,
    noteId,
  });

  return (
    <>
      <div
        className="nx-style-inspector__colour"
        // Named as a GROUP only where there is no field to carry the name: with
        // a text input present the label points at it directly, and a group
        // wrapping a named control announces the property twice.
        {...(reference === null
          ? {}
          : { role: "group", "aria-labelledby": labelledBy })}
      >
        <ColourPicker
          shown={shown}
          choices={choices}
          tokensRead={tokens !== undefined}
          reference={reference}
          referenceLabel={storedLabel}
          referenceTip={heldTip(held, storedLabel, tokens)}
          customFirst={writtenAsValue(stored)}
          actionName={actionName}
          describedBy={describes}
          invalid={describedBy !== undefined}
          unrepresented={wouldReplace(shown, reference, draft)}
          // The draft moves with the pointer, and the document follows at most
          // once a frame where the panel writes as it is typed, as ONE step of
          // undo however many moves the gesture makes (`usePickerWrites`).
          onColour={onColour}
          // The gesture ends where the picker closes, whichever way it closed.
          onClosed={closed}
          /*
           * Any control that writes THIS field's value for itself, declared on
           * the element. The Unlink beside a held variable is one; a
           * breakpoint Reset is another, and it lives in a different component
           * that has no way to hand a ref down here.
           */
          supersededBy={target => supersedes(target, id)}
          // A variable, or a recent colour, is one discrete choice rather
          // than a gesture, so it commits immediately, exactly as the select
          // and toggle controls do.
          onChoose={commitInstead}
        />
        {reference === null ? (
          // The SAME field every other text control uses, rather than one
          // written here. Commit on blur, Enter, the empty draft that clears
          // instead of storing `""`, and the `unchanged` case that puts back
          // what the document holds are one contract — and a second copy of it
          // beside the first is what drifts, silently, in the direction of
          // losing an edit.
          <TextField
            id={id}
            control={control}
            stored={stored}
            draft={draft}
            setDraft={setDraft}
            tokens={tokens}
            describedBy={describes}
            // The REFUSAL alone. `describes` also carries the contrast verdict,
            // which is supplementary text and never a complaint.
            invalid={describedBy !== undefined}
            live={live}
            // Remembered among Recent colours once, when the edit ends.
            onType={typed}
            onCommit={commitColour}
          />
        ) : (
          <ColourUnlink
            held={held}
            fieldId={id}
            actionName={actionName}
            onUnlink={value => {
              commitInstead(value);
              // The typed field takes Unlink's place, holding the colour.
              focusAfterUnlink(() => document.getElementById(id));
            }}
          />
        )}
      </div>
      <ContrastNote id={noteId} contrast={contrast} />
      <RawColourNote stored={stored} />
    </>
  );
}

/**
 * The trigger, and the surface it opens onto: the site's colour variables
 * first, then the author's Recent colours, and a custom colour behind its own
 * button at the end.
 *
 * The variables lead because a variable carries a light and a dark value and a
 * colour written as a value carries one, which the visitor's dark mode cannot
 * change. So the list an author meets first is the one that keeps a page right
 * in both modes, by the names the Variables tab gives them, each with its pair.
 *
 * Its own component because CHOOSING a colour is a different question from
 * showing one: the row owns the stored value and its text, and this owns the
 * list, the raw picker and what the trigger is painted with.
 *
 * The two callbacks stay separate for the reason `ColorPicker` keeps them
 * separate: only the host knows what a choice MEANS. A variable hands back its
 * identity and never the colour it currently resolves to — storing that would
 * turn a reference into a literal and stop the page following the variable.
 */
function ColourPicker({
  shown,
  choices,
  tokensRead,
  reference,
  referenceLabel,
  referenceTip,
  customFirst,
  actionName,
  describedBy,
  invalid,
  unrepresented,
  onColour,
  onClosed,
  supersededBy,
  onChoose,
}: {
  /** The resolved colour, or `undefined` when nothing here can resolve one. */
  shown: string | undefined;
  choices: readonly SiteVariable[];
  /** Whether the site's variables have arrived; until then the list waits. */
  tokensRead: boolean;
  /** The identity the value refers to, or `null` for a value or none. */
  reference: string | null;
  /** What that reference is called, for the trigger. */
  referenceLabel: string;
  /** What the held variable is, for the trigger's tooltip; see `variableTip`. */
  referenceTip: string | undefined;
  /** Whether the custom colour opens already showing. */
  customFirst: boolean;
  actionName: string;
  /** Everything describing the control: a refusal, a contrast verdict, or both. */
  describedBy: string | undefined;
  /** Whether the last value was refused. A contrast verdict is not a refusal. */
  invalid: boolean;
  /** Whether the stored value is one the picker cannot show. */
  unrepresented: boolean;
  /** The picker moved. Fires on every pointer event during a drag. */
  onColour: (hex: string) => void;
  /**
   * The picker closed, and how.
   *
   * The outcome is a value rather than the presence or absence of a call,
   * because "superseded" is an instruction to DISCARD the gesture, not an
   * absence of one — and a host given only the write path has nowhere to drop
   * what it was holding.
   */
  onClosed: (outcome: PickerClose) => void;
  /**
   * Whether the control being PRESSED outside the popover writes THIS field's
   * value itself.
   *
   * Asked before the dismissal is turned into a write, so a control that both
   * closes this picker and commits the same value does not produce two edits
   * for one intent — the author would otherwise undo the reset and get back the
   * colour they pressed it to be rid of.
   *
   * The target is a press rather than any interaction, because Radix dismisses
   * on focus as well and a focused button has not written anything. See where
   * this is bound.
   */
  supersededBy: (target: EventTarget | null) => boolean;
  /**
   * A discrete choice: a variable, as a reference to its identity, or a
   * recent colour, as it is listed.
   */
  onChoose: (value: StyleValue) => void;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  // Whether the dismissal in progress belongs to a control that writes for
  // itself. Read once by the close below and reset there, so it cannot leak
  // into the next open.
  const superseded = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(customFirst);
  // A colour inherited from another tier is painted while none is set here,
  // and marked so the swatch reads as inherited rather than chosen. Through
  // the same projection as a stored colour, so a site variable or
  // `currentcolor`, which resolve against the canvas, leave it unpainted
  // rather than painted with the panel's own colour.
  const inherited = React.useContext(InheritedValue);
  const painted = shown ?? colourHexOf(inherited, undefined);
  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) {
          setCustom(customFirst);
          return;
        }
        const own = superseded.current;
        superseded.current = false;
        onClosed(own ? "superseded" : "committed");
      }}
    >
      <PickerTrigger
        painted={painted}
        inherited={shown === undefined && inherited !== undefined}
        reference={reference}
        referenceLabel={referenceLabel}
        referenceTip={referenceTip}
        actionName={actionName}
        described={described}
        invalid={invalid}
      />
      <PopoverContent
        align="end"
        className="nx-style-inspector__picker"
        // Off here as well as on the tab: the picker is drawn outside the tab,
        // so its hex field does not inherit the tab's setting, and a colour
        // code is no more a word than a length is.
        spellCheck={false}
        // The list takes focus itself, on its search or on its entries; with
        // no list, the first control, Custom colour, takes it as usual.
        onOpenAutoFocus={event => {
          if (choices.length > 0) event.preventDefault();
        }}
        /*
         * A PRESS, not any dismissal whose target happens to be such a control.
         *
         * `onInteractOutside` also fires when focus merely LEAVES the popover —
         * a keyboard author tabbing out lands on the Reset beside this control
         * and dismisses it without activating anything. Read there, the gesture
         * they were composing is discarded by a button they never pressed, and
         * tabbing onward loses it silently.
         *
         * The question is not which cause dismissed the popover but whether a
         * control is about to WRITE, and only a pointer press implies that: the
         * press is followed by the click that runs the handler. Focus is not,
         * so a focus dismissal falls through to the ordinary close and the
         * gesture is committed — which is what leaving a control does
         * everywhere else in this panel, the text fields included.
         */
        onPointerDownOutside={event => {
          // Only a press that can RUN the control supersedes. See `activates`.
          superseded.current =
            activates(event.detail.originalEvent) && supersededBy(event.target);
        }}
      >
        <ColourVariables
          choices={choices}
          read={tokensRead}
          current={reference}
          onPick={identity => {
            // One discrete choice, committed at once; the close that follows
            // has nothing left to write.
            onChoose({ $token: identity });
            setOpen(false);
          }}
        />
        <RecentColourChoices
          onPick={onChoose}
          // One discrete choice, as a variable is: the picker closes.
          onPicked={setOpen}
        />
        <CustomColour
          open={custom}
          onToggle={() => setCustom(was => !was)}
          // What the swatch paints, an inherited colour included, so a small
          // adjustment starts from what the author sees.
          shown={painted}
          unrepresented={unrepresented}
          onColour={onColour}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * After a commit the document did not need, the field goes back to what it
 * holds: a picker gesture or a choice that ends where it began leaves no
 * draft behind for a later blur to write.
 */
function settle(outcome: CommitOutcome, reset: () => void): void {
  if (outcome === "unchanged") reset();
}

/**
 * The contrast a colour field reports for what it shows, withheld while
 * another property comes between the pair, and the ids that describe the
 * field: its own, with the contrast note's while there is one.
 */
function contrastReading({
  leaf,
  showing,
  pairedColour,
  tokens,
  mode,
  obscuredBy,
  describedBy,
  noteId,
}: {
  leaf: StyleControl["leaf"];
  showing: StyleValue | undefined;
  pairedColour: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  mode: TokenMode;
  obscuredBy: string | undefined;
  describedBy: string | undefined;
  noteId: string;
}): {
  contrast: ReturnType<typeof contrastAtLeaf> | undefined;
  describes: ReturnType<typeof describedByAll>;
} {
  const contrast =
    obscuredBy === undefined
      ? contrastAtLeaf(leaf, showing, pairedColour, tokens, mode)
      : undefined;
  return {
    contrast,
    describes: describedByAll(
      describedBy,
      contrast === undefined ? undefined : noteId
    ),
  };
}

/** The write a field types live through: its own, or else its commit. */
function typedOrCommitted(
  onType: ((value: StyleValue | null) => CommitOutcome) | undefined,
  onCommit: (value: StyleValue | null) => CommitOutcome
): (value: StyleValue | null) => CommitOutcome {
  return onType ?? onCommit;
}

/**
 * What a picker gesture writes, and when: each move shown in the field and,
 * where the panel writes as it is typed, written to the document at most
 * once a frame (`live-gesture.ts`); the colour it ends on written in the same
 * run when the picker closes, and remembered among Recent colours then; and
 * a control writing this field itself putting back what the moves wrote.
 */
function usePickerWrites({
  commitColour,
  onMove,
  reset,
  setDraft,
}: {
  commitColour: (value: StyleValue | null) => CommitOutcome;
  /** A move's write, where the panel writes as it is typed. */
  onMove: (value: StyleValue | null) => CommitOutcome;
  reset: () => void;
  setDraft: (value: string) => void;
}): {
  commitInstead: (value: StyleValue | null) => void;
  closed: (outcome: PickerClose) => void;
  onColour: (value: string) => void;
} {
  // Where the panel writes as it is typed, a picker gesture writes as it
  // moves too, at most once a frame, the whole gesture one undo step.
  const typesLive = useTypesLive();
  const gesture = useLiveGesture();
  // What the picker composed, written once the gesture is over. Compared
  // against the stored text so closing a picker nobody moved writes nothing.
  // What the picker has produced and not yet written. Held in a ref as well as
  // in state because the unmount flush below reads it from a cleanup that runs
  // once, where the closed-over `draft` would be the value at first render.
  const pending = React.useRef<string | null>(null);
  /*
   * A discrete choice, which SUPERSEDES anything the picker was mid-way through.
   *
   * Dropping the pending value is the whole of it. Pressing this control also
   * dismisses the picker, and the close reads `pending.current` to decide what
   * the gesture produced — so clearing it first leaves that close with nothing
   * to write, and the discrete choice is the only edit. One rule expressed
   * once: a second expression of it is what drifts. A recent colour is one
   * such choice, and joins the front of Recent colours again; a variable or
   * a clear is no colour of its own and is not remembered.
   */
  const commitInstead = (value: StyleValue | null): void => {
    pending.current = null;
    // In the gesture's run, so the moves before it and the choice are one
    // step.
    gesture.end(() => settle(commitColour(value), reset));
  };
  /*
   * The picker closed, whichever outcome that close had.
   *
   * ONE handler for both, because the two differ only in whether the gesture is
   * written — the pending value is dropped either way. Expressed as two
   * handlers, the supersede path is the one that silently does nothing: it
   * would leave the draft queued, and the unmount flush below would write it
   * back OVER the edit that superseded it, as a later op with no gesture behind
   * it.
   *
   * Synchronous, because an author can leave the editor entirely in the same
   * interaction that dismisses this popover: the page builder hands the current
   * document to its host form and unmounts, and a write scheduled for after
   * that lands on an editor nobody is reading any more. The gesture is simply
   * gone from the document handed over.
   *
   * Which is why the supersede below is decided by WHERE the interaction went
   * rather than by giving a later handler time to cancel a scheduled write. A
   * timer bought that cancellation and paid for it with this race.
   */
  const closed = (outcome: PickerClose): void => {
    const unwritten = pending.current;
    pending.current = null;
    // A control writing this field itself takes over: what the moves wrote
    // goes back, so its write is the only edit.
    if (outcome === "superseded") {
      gesture.cancel();
      return;
    }
    if (unwritten === null) {
      gesture.end();
      return;
    }
    // Written in the run the moves wrote in, and remembered once, here.
    gesture.end(() => settle(commitColour(unwritten), reset));
  };
  // The current writer, held so the teardown below depends on nothing. A
  // teardown listing `onCommit` would re-run its cleanup on every render that
  // gives the field a new callback — which is every render — and flush a
  // gesture the author is still making.
  const write = React.useRef(commitColour);
  // The gesture as it is now, for the same teardown.
  const finishing = React.useRef(gesture);
  React.useEffect(() => {
    write.current = commitColour;
    finishing.current = gesture;
  });
  /*
   * Write an unfinished gesture when this field goes away, and do it NOW.
   *
   * Two ways to leave without closing the popover: selecting another block in
   * the canvas iframe cannot reach the outside-dismiss handler, and the
   * selection change remounts this field without firing `onOpenChange`. A
   * scheduled write would not survive either, so the timer is cancelled and the
   * value written synchronously rather than left to a callback whose component
   * has gone.
   */
  React.useEffect(
    () => () => {
      const unwritten = pending.current;
      pending.current = null;
      // The outcome is DROPPED, and that is the honest limit rather than an
      // oversight. A refusal here — a document at its byte limit, say — is
      // reported through state belonging to a component that is going away, so
      // there is nobody left to show it to and nowhere to keep the value: the
      // ref does not survive the remount either. Writing when the document
      // accepts strictly improves on not writing at all, and cannot improve the
      // case where it does not.
      //
      // Closing it properly means the pending edit living somewhere that
      // outlives one field, which is the same thing undo and the unsaved-work
      // guard need and is tracked with them.
      // In the gesture's run, as a close writes it, so the moves already
      // written and this last one are one step of undo. The gesture's own
      // teardown, which runs first, drops the frame but keeps the run.
      if (unwritten !== null) {
        const finish = write.current;
        finishing.current.end(() => finish(unwritten));
      }
    },
    []
  );
  const onColour = (value: string): void => {
    pending.current = value;
    setDraft(value);
    // Not remembered among Recent colours until the gesture ends.
    if (typesLive) gesture.move(() => onMove(value));
  };
  return { commitInstead, closed, onColour };
}

/**
 * A field's commit that also remembers the raw colour it wrote, or chose
 * again, among the author's Recent colours; a refused value is not one, nor
 * a variable or a clear.
 */
function rememberingCommit(
  onCommit: (value: StyleValue | null) => CommitOutcome,
  store: PreferenceStore | undefined
): (value: StyleValue | null) => CommitOutcome {
  return value => {
    const outcome = onCommit(value);
    if (outcome !== "refused") rememberColour(store, value);
    return outcome;
  };
}

/**
 * Recent colours, between the variables and Custom colour: the last colours
 * this author typed or picked, each a swatch named by its value. Shown while
 * there are none too, saying what will appear, so the place is known.
 */
function RecentColourChoices({
  onPick,
  onPicked,
}: {
  onPick: (colour: string) => void;
  /** Called with `false` once a colour is picked, to close the picker. */
  onPicked: (open: false) => void;
}): React.JSX.Element {
  const headingId = React.useId();
  const [colours] = useRecentColours();
  return (
    <div
      className="nx-style-inspector__recent"
      role="group"
      aria-labelledby={headingId}
    >
      <p className="nx-style-inspector__recent-heading" id={headingId}>
        Recent colours
      </p>
      {colours.length === 0 ? (
        <p className="nx-vars__note nx-style-inspector__recent-none">
          Colours you type or pick show here.
        </p>
      ) : (
        <div className="nx-style-inspector__recent-list">
          {colours.map(colour => (
            <button
              key={colour}
              type="button"
              className="nx-style-inspector__swatch"
              aria-label={colour}
              title={colour}
              // A colour written as a value paints the same anywhere, so it
              // is painted as it is listed; no variable is ever listed here.
              style={{ "--nx-swatch": colour } as React.CSSProperties}
              onClick={() => {
                onPick(colour);
                onPicked(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Whether a stored colour is written as a value rather than as a variable: the
 * picker then opens with the controls that made it showing, under the
 * variables. Nothing stored, or a variable, opens on the variables alone.
 */
function writtenAsValue(stored: StyleValue | undefined): boolean {
  return stored !== undefined && !isTokenRef(stored);
}

/**
 * What opens the picker: for a value or none, the swatch beside the field
 * holding it; for a variable, the variable itself, its swatch and its name, as
 * the control an author opens to choose another.
 *
 * Handed the popover's own trigger props, which it spreads on the button.
 */
function ColourTrigger({
  shown,
  reference,
  referenceLabel,
  actionName,
  ...trigger
}: React.ComponentProps<"button"> & {
  shown: string | undefined;
  reference: string | null;
  referenceLabel: string;
  actionName: string;
}): React.JSX.Element {
  const paint = {
    // Painted through a custom property rather than `background-color`
    // directly, so the chequerboard beneath a translucent colour stays visible
    // through it. `undefined` leaves the class's own "nothing here" appearance
    // rather than a colour this cannot vouch for.
    style:
      shown === undefined
        ? undefined
        : ({ "--nx-swatch": shown } as React.CSSProperties),
    "data-empty": shown === undefined ? "" : undefined,
  };
  if (reference === null) {
    return (
      <button
        {...trigger}
        type="button"
        className="nx-style-inspector__swatch"
        aria-label={`Colour for ${actionName}`}
        {...paint}
      />
    );
  }
  return (
    <button
      {...trigger}
      type="button"
      className="nx-font-pick__trigger nx-style-inspector__colour-pick"
      aria-label={`Colour for ${actionName}: ${referenceLabel}`}
      // Green, as every value that comes from a variable is.
      data-bound=""
      {...paint}
    >
      <span className="nx-vars__swatch" aria-hidden="true" />
      <span className="nx-font-pick__value">{referenceLabel}</span>
      <ChevronDown aria-hidden="true" size={14} />
    </button>
  );
}

/**
 * The picker's trigger, with what a held variable is in its tooltip: see
 * {@link ColourTrigger} for what it draws.
 */
function PickerTrigger({
  painted,
  inherited,
  reference,
  referenceLabel,
  referenceTip,
  actionName,
  described,
  invalid,
}: {
  painted: string | undefined;
  /** Whether the colour painted reaches here from another tier. */
  inherited: boolean;
  reference: string | null;
  referenceLabel: string;
  referenceTip: string | undefined;
  actionName: string;
  described: string | undefined;
  invalid: boolean;
}): React.JSX.Element {
  return (
    <VariableTipped tip={referenceTip}>
      <PopoverTrigger asChild>
        <ColourTrigger
          shown={painted}
          data-inherited={inherited ? "" : undefined}
          reference={reference}
          referenceLabel={referenceLabel}
          actionName={actionName}
          aria-describedby={described}
          aria-invalid={invalid ? true : undefined}
        />
      </PopoverTrigger>
    </VariableTipped>
  );
}

/**
 * Custom colour, at the end of the picker: a button that opens the raw
 * picker in place, for the exception a variable does not cover.
 */
function CustomColour({
  open,
  onToggle,
  shown,
  unrepresented,
  onColour,
}: {
  open: boolean;
  onToggle: () => void;
  /** The resolved colour, or `undefined` when nothing here can resolve one. */
  shown: string | undefined;
  /** Whether the stored value is one the picker cannot show. */
  unrepresented: boolean;
  onColour: (hex: string) => void;
}): React.JSX.Element {
  const regionId = React.useId();
  return (
    <div className="nx-style-inspector__custom">
      <button
        type="button"
        className="nx-style-inspector__custom-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span>Custom colour</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="nx-style-inspector__custom-body" id={regionId}>
          {unrepresented ? (
            <p className="nx-inspector__note">
              This value cannot be shown on the picker. Choosing here replaces
              it.
            </p>
          ) : null}
          <ColorPicker
            // A fallback only where nothing could be resolved, and it is
            // never WRITTEN by being shown: the picker reports a colour only
            // once the author moves something, so opening it over a value it
            // cannot represent changes nothing.
            color={shown ?? PICKER_FALLBACK}
            showAlpha
            onColorChange={onColour}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One colour variable as the picker lists it. */
interface ColourChoice {
  readonly key: string;
  readonly label: string;
  readonly token: SiteVariable;
}

/**
 * The site's colour variables, by name, each with its swatch and its light
 * and dark pair; or, for a site with none, a line saying so.
 */
function ColourVariables({
  choices,
  read,
  current,
  onPick,
}: {
  choices: readonly SiteVariable[];
  /** Whether the site's variables have arrived. */
  read: boolean;
  /** The identity the value refers to, marked in the list. */
  current: string | null;
  onPick: (identity: string) => void;
}): React.JSX.Element {
  if (!read) {
    // Not yet arrived is not the same as none: saying "no variables" while
    // the site's style is still on its way would be wrong for a moment.
    return (
      <p
        className="nx-vars__note nx-style-inspector__no-variables"
        role="status"
      >
        Reading this site&rsquo;s colour variables&hellip;
      </p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className="nx-vars__note nx-style-inspector__no-variables">
        This site has no colour variables yet.
      </p>
    );
  }
  const listed: ColourChoice[] = choices.map(token => ({
    // The IDENTITY as the key, which is what keeps the list stable across a
    // rename: a key built from the label would remount every renamed
    // variable's row, and would collide between a renamed variable and a new
    // one that took its old name.
    key: token.identity,
    // Qualified with the identity only where another listed variable shares
    // this name: two under one name with equal colours are otherwise
    // indistinguishable, and choosing either stores an identity the author
    // could not have predicted.
    label: variableLabel(token, choices),
    token,
  }));
  return (
    <div className="nx-style-inspector__variables">
      <ChoiceList
        choices={listed}
        currentKey={current ?? undefined}
        onPick={choice => onPick(choice.token.identity)}
        label="Colour variables"
        searchLabel="Search colour variables"
        noMatch="No colour variables match this search."
        choiceClassName="nx-style-inspector__variable"
        renderChoice={choice => (
          <>
            <span
              className="nx-vars__swatch nx-vars__swatch--main"
              aria-hidden="true"
              // The RESOLVED colour in the mode the canvas shows, never the
              // raw value: `var(--brand)` or `currentcolor` painted here would
              // resolve against the inspector rather than the canvas.
              style={swatchStyle(choice.token.swatch)}
            />
            <span className="nx-style-inspector__variable-name">
              {choice.label}
            </span>
            <ColourPair {...choice.token.pair} />
          </>
        )}
      />
    </div>
  );
}

/**
 * What a STORED reference is called, for the row that displays it.
 *
 * Three answers to one question, which is why it is asked in one place: a
 * reference the site still defines reads as that token's current name; one
 * whose name another offered token shares is qualified with its identity, so
 * the two rows cannot be confused; and one the site no longer defines at all
 * reads as the raw identity the document holds. That last case is a warning
 * rather than an error — the value goes on compiling — so showing the stored
 * string is more use than showing an empty space.
 *
 * Separate from {@link variableLabel} because that one answers about a token
 * in hand, and this one has to find the token first, or account for there being
 * none.
 */
function storedTokenLabel(
  reference: string | null,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode,
  among: readonly SiteVariable[]
): string {
  if (reference === null) return "";
  const token = variableFor(reference, tokens, mode);
  return token === undefined ? reference : variableLabel(token, among);
}

/** The variable a reference holds, or `undefined` for none or one the site lacks. */
function heldVariable(
  reference: string | null,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): SiteVariable | undefined {
  return reference === null ? undefined : variableFor(reference, tokens, mode);
}

/** What a held colour variable is, for its trigger's tooltip; none for none. */
function heldTip(
  held: SiteVariable | undefined,
  label: string,
  tokens: SiteTokenSet | undefined
): string | undefined {
  return held === undefined ? undefined : variableTip(held, label, tokens);
}

/**
 * Unlink beside a held colour variable: the colour it gives in the mode the
 * canvas shows, kept as a plain value in one commit. Nothing for a variable
 * the site no longer has, which has no colour to keep; the row's Reset
 * removes it.
 */
function ColourUnlink({
  held,
  fieldId,
  actionName,
  onUnlink,
}: {
  held: SiteVariable | undefined;
  /** The field whose value this press writes. See {@link commitsFor}. */
  fieldId: string;
  actionName: string;
  onUnlink: (value: StyleValue) => void;
}): React.JSX.Element | null {
  if (held === undefined) return null;
  return (
    <UnlinkButton
      /*
       * This press writes this field's value: it commits the colour, and the
       * picker must not also write the draft its dismissal would otherwise
       * flush. Declared rather than handed up as a ref, so any control making
       * the same promise says so the same way.
       */
      {...commitsFor(fieldId)}
      label={actionName}
      onUnlink={() => onUnlink(held.value)}
    />
  );
}

/**
 * How a colour pair fares, or nothing at all.
 *
 * `undefined` renders NOTHING rather than a placeholder, an approximation or a
 * last-known figure. That is the engine's own reasoning carried up one level:
 * a ratio computed from a colour that was misread "is worse than no figure,
 * because it is a number somebody will act on", and there is no honest estimate
 * of the contrast against a `var()` whose value the page decides at render.
 *
 * A failing pair is a WARNING and never a refusal — the value is valid, stored
 * and compiling, and the author may have a reason. The same position
 * Gutenberg's contrast checker takes.
 */
/**
 * The note beside a colour written as a value rather than through a variable.
 *
 * Such a colour keeps its one value when the visitor's device prefers dark,
 * where a variable carries both. Read from what is stored, so a picker gesture
 * still in progress does not make it flicker.
 */
function RawColourNote({
  stored,
}: {
  stored: StyleValue | undefined;
}): React.JSX.Element | null {
  if (!isRawColour(stored)) return null;
  return (
    <p className="nx-inspector__note">
      Not adapted to dark mode. Choose a variable to follow light and dark.
    </p>
  );
}

function ContrastNote({
  id,
  contrast,
}: {
  id: string;
  contrast: ContrastResult | undefined;
}): React.JSX.Element {
  return (
    <p
      className="nx-style-inspector__contrast"
      id={id}
      // Announced as it changes, because the verdict moves while focus is
      // INSIDE the picker — on the saturation square, the hue strip, the alpha
      // strip or the hex field — and none of those controls is described by
      // this note. `aria-describedby` is read when a control receives focus, so
      // a figure that changes during the interaction is never spoken. Polite
      // rather than assertive: it coalesces while a drag is moving and speaks
      // once the author pauses, which is when the number is wanted.
      aria-live="polite"
      // Mounted even with nothing to say. A live region announces CHANGES to
      // its contents, so one that arrives with its text already in place is not
      // a change and is silent — the state this note is in every time a colour
      // first becomes measurable. Empty it occupies no space; `:empty` drops
      // the margin rather than the box, because `display: none` would take it
      // out of the accessibility tree and stop it announcing at all.
      {...(contrast === undefined ? {} : { "data-level": contrast.level })}
    >
      {contrast === undefined
        ? ""
        : `Contrast ${contrastRatioText(contrast)} — ${
            contrast.passesBodyText
              ? `passes AA for body text (${contrast.level})`
              : "below AA for body text"
          }`}
    </p>
  );
}
