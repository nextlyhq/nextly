/**
 * The site's colour variables listed under a colour box as it is typed in.
 *
 * An author who knows the site has a "Yellow 500" types it, as they would type
 * a colour. The list shows the variables that answer the text, best first
 * (`colourVariablesMatching`), each with its name and its light and dark
 * swatches, and Enter connects the highlighted one, stored as a reference
 * exactly as picking it in the picker stores it.
 *
 * The box stays the control: focus never leaves it, so typing goes on while
 * the list is open, and the box is a combobox naming the highlighted entry by
 * `aria-activedescendant`. The top entry is highlighted while the text is not
 * itself a colour; where it is one ("yellow"), Enter writes that colour and the
 * list stays as suggestions, and the arrow keys still reach them.
 *
 * Drawn in the builder's held popup, so the list stays where it opened while
 * its entries change under the typing.
 *
 * @module inspector/style-inspector/typed-colour-suggestions
 */
import { checkColorValue } from "@nextlyhq/blocks-engine";
import { Popover, PopoverAnchor } from "@nextlyhq/ui";
import * as React from "react";

import { isElement } from "../../canvas/dom-kind";
import { ColourPair } from "../../panels/design/variable-swatch";
import { BuilderPopoverContent } from "../../popups/builder-popover";
import {
  colourVariablesMatching,
  variableLabel,
  type SiteVariable,
  type TypedColourMatch,
} from "../../styles/style-colour";

/** What the list is called for assistive technology. */
const LIST_NAME = "Matching color variables";

/**
 * The highlighted entry for the text as typed: the top one, unless the text is
 * a colour the box would store as it is, which the engine's colour check
 * decides, so "yellow" + Enter writes yellow.
 */
function startingHighlight(draft: string, count: number): number {
  if (count === 0) return -1;
  return checkColorValue(draft.trim()) === null ? -1 : 0;
}

/** The combobox attributes the box carries while the list is open. */
const COMBOBOX_ATTRIBUTES = [
  "role",
  "aria-autocomplete",
  "aria-expanded",
  "aria-controls",
  "aria-activedescendant",
] as const;

/**
 * The box as a combobox while its list is open, naming the list and its
 * highlighted entry, and the plain text box it is otherwise, as every other
 * style field is. Set on the element the shared text field draws, found by
 * its id, rather than threaded through the field every other style control
 * uses for attributes only this one needs.
 */
function useComboboxAttributes(
  fieldId: string,
  listId: string,
  open: boolean,
  active: string | undefined
): void {
  React.useEffect(() => {
    const box = document.getElementById(fieldId);
    if (box === null) return;
    for (const name of COMBOBOX_ATTRIBUTES) box.removeAttribute(name);
    if (!open) return;
    box.setAttribute("role", "combobox");
    box.setAttribute("aria-autocomplete", "list");
    box.setAttribute("aria-expanded", "true");
    box.setAttribute("aria-controls", listId);
    if (active !== undefined) box.setAttribute("aria-activedescendant", active);
  }, [fieldId, listId, open, active]);
  // Taken off again when the box goes: the field may be drawn elsewhere.
  React.useEffect(
    () => () => {
      const box = document.getElementById(fieldId);
      for (const name of COMBOBOX_ATTRIBUTES) box?.removeAttribute(name);
    },
    [fieldId]
  );
}

/**
 * What a key does to the list, decided apart from carrying it out so each
 * branch reads on its own: `move` highlights another entry, `take` connects
 * the highlighted entry's variable, `dismiss` closes the list for this text, `forget` ends
 * the typing a closed list was shown for, and `pass` leaves the key to the box.
 */
type ListKeyAction =
  | { kind: "move"; index: number }
  | { kind: "take"; variable: SiteVariable }
  | { kind: "dismiss" }
  | { kind: "forget" }
  | { kind: "pass" };

/** The entry an arrow lands on: from none, the first or the last; then round. */
function steppedHighlight(index: number, step: 1 | -1, count: number): number {
  if (index >= 0) return (index + step + count) % count;
  return step > 0 ? 0 : count - 1;
}

/**
 * The list's answer to a key. While it is open the arrows move the highlight
 * rather than step the value, Enter takes the highlighted entry, and Escape
 * closes the list before it puts the old text back. While it is closed, the
 * field's own Escape puts the stored text back, which is no typing: the list
 * stays closed until the author types again.
 */
function listKeyAction(
  key: string,
  open: boolean,
  index: number,
  matches: readonly TypedColourMatch[]
): ListKeyAction {
  if (!open) return key === "Escape" ? { kind: "forget" } : { kind: "pass" };
  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    return {
      kind: "move",
      index: steppedHighlight(index, step, matches.length),
    };
  }
  if (key === "Escape") return { kind: "dismiss" };
  // Enter with nothing highlighted is the box's own: it writes the colour.
  const highlighted = key === "Enter" ? matches[index] : undefined;
  return highlighted === undefined
    ? { kind: "pass" }
    : { kind: "take", variable: highlighted.variable };
}

/**
 * Whether a key belongs to an input method composing characters. Its Enter
 * confirms them, and Safari reports it as key 229 rather than marking it
 * composing.
 */
function composing(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

/**
 * The colour box with its suggestions: `children` is the box itself, the
 * shared text field drawn with `fieldId`.
 */
export function TypedColourSuggestions({
  fieldId,
  draft,
  offered,
  onChoose,
  children,
}: {
  fieldId: string;
  /** The text in the box. */
  draft: string;
  /** The variables this box may hold, as its picker lists them. */
  offered: readonly SiteVariable[];
  /** Connects the box to a variable, as picking it in the picker does. */
  onChoose: (variable: SiteVariable) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const listId = React.useId();
  const anchor = React.useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = React.useState(false);
  // Typed in since the box took focus: a box only entered shows its value,
  // and a hex code is written as it is typed, so the stored value is no tell.
  const [typed, setTyped] = React.useState(false);
  // Closed by Escape or a press elsewhere, until the text changes again.
  const [dismissedAt, setDismissedAt] = React.useState<string | null>(null);
  const matches = typed ? colourVariablesMatching(draft, offered) : [];
  // The highlight belongs to the text it was moved on: new text starts over.
  const [moved, setMoved] = React.useState<{ draft: string; index: number }>();
  const index =
    moved?.draft === draft
      ? moved.index
      : startingHighlight(draft, matches.length);
  const open = focused && matches.length > 0 && dismissedAt !== draft;
  const optionId = (at: number): string => `${listId}-option-${String(at)}`;
  const active = open && index >= 0 ? optionId(index) : undefined;
  useComboboxAttributes(fieldId, listId, open, active);
  // The highlighted entry kept in sight as the arrows move it through a list
  // taller than the popup.
  React.useEffect(() => {
    if (active !== undefined) {
      document.getElementById(active)?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const choose = (variable: SiteVariable): void => {
    setDismissedAt(draft);
    onChoose(variable);
  };

  // Caught before the box's own keys, which the list's own keys replace.
  const onKeyDownCapture = (event: React.KeyboardEvent): void => {
    if (composing(event)) return;
    const action = listKeyAction(event.key, open, index, matches);
    if (action.kind === "pass") return;
    if (action.kind === "forget") {
      setTyped(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "move") setMoved({ draft, index: action.index });
    else if (action.kind === "take") choose(action.variable);
    else setDismissedAt(draft);
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (!next) setDismissedAt(draft);
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={anchor}
          className="nx-colour-suggest"
          onFocus={() => {
            if (!focused) setTyped(false);
            setFocused(true);
          }}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setFocused(false);
            }
          }}
          onChangeCapture={() => {
            setTyped(true);
            // Escape closed the list for the text it was pressed on; any edit
            // after it offers the list again, even back to the same text.
            setDismissedAt(null);
          }}
          onKeyDownCapture={onKeyDownCapture}
        >
          {children}
        </div>
      </PopoverAnchor>
      <BuilderPopoverContent
        side="bottom"
        align="start"
        className="nx-builder-tokens nx-colour-suggest__list"
        // The box keeps focus, so typing goes on while the list is open.
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        // A press in the box itself is typing there, not a press elsewhere.
        onInteractOutside={event => {
          const target = event.target;
          if (isElement(target) && anchor.current?.contains(target) === true) {
            event.preventDefault();
          }
        }}
      >
        <div role="listbox" id={listId} aria-label={LIST_NAME}>
          {matches.map((match, at) => (
            <div
              key={match.variable.identity}
              id={optionId(at)}
              role="option"
              aria-selected={at === index}
              // The picker's own row, so a suggestion reads as one of its entries.
              className="nx-font-pick__option nx-colour-suggest__option"
              // Taken without moving focus from the box.
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(match.variable)}
            >
              <ColourPair
                light={match.variable.pair.light}
                dark={match.variable.pair.dark}
              />
              <span className="nx-colour-suggest__name">
                {variableLabel(match.variable, offered)}
              </span>
            </div>
          ))}
        </div>
      </BuilderPopoverContent>
    </Popover>
  );
}
