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

  const choose = (variable: SiteVariable): void => {
    setDismissedAt(draft);
    onChoose(variable);
  };

  // Caught before the box's own keys: while the list is open the arrows move
  // the highlight rather than step the value, Enter takes the highlighted
  // entry, and Escape closes the list before it puts the old text back.
  const onKeyDownCapture = (event: React.KeyboardEvent): void => {
    // The Enter that confirms an input method's characters is its own: Safari
    // reports it as key 229 rather than marking it composing.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    if (!open) {
      // The field's own Escape puts the stored text back, which is no typing:
      // the list stays closed until the author types again.
      if (event.key === "Escape") setTyped(false);
      return;
    }
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      event.stopPropagation();
      const next =
        index < 0
          ? step > 0
            ? 0
            : matches.length - 1
          : (index + step + matches.length) % matches.length;
      setMoved({ draft, index: next });
      return;
    }
    if (event.key === "Enter" && index >= 0) {
      const match = matches[index];
      if (match === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      choose(match.variable);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(draft);
    }
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
          onChangeCapture={() => setTyped(true)}
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
