"use client";

/**
 * "Text style", at the top of the Style tab's Text section: the site's text
 * styles, each previewed in its own look, and None. Picking one gives the
 * block its whole look (font, size per device, line height, weight, letter
 * spacing and case) by writing or replacing the one text-style entry in the
 * block's class list (`text-style-choice`), so a heading can look like
 * "Display" and a paragraph like "Eyebrow".
 *
 * A page edit, as applying a shared style is: an author who may not change
 * the site's design may still choose one, and a block whose design is held
 * may not. Not drawn while a shared style is the target, since a shared
 * style wears no text style.
 *
 * @module text-style-picker
 */
import { findNode, type NamedClass } from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { EDITOR_WORDS } from "../../editor-words";
import {
  planTextStyle,
  textStyleOptions,
  wornTextStyle,
  type TextStyleOption,
} from "../../text-style-choice";
import { lockViewOf } from "../inspector";

import { SectionHeld } from "./section-held";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";

/**
 * The site's class library, lent to the picker by the Style tab: the text
 * styles are read from it. `undefined` while it is unread, or for a host
 * that lends none, and then no picker is drawn.
 */
export const TextStyleLibrary: React.Context<
  readonly NamedClass[] | undefined
> = React.createContext<readonly NamedClass[] | undefined>(undefined);

/** The sample every text style is previewed with, as Site text's rows are. */
const SAMPLE = "The quick survey";

/** The value the menu gives None, which no class id can be. */
const NONE = "";

/** The picker's label. */
const LABEL = "Text style";

/** Where text styles are made, said while the site has none. */
const NONE_YET = `No text styles yet. Make one in ${EDITOR_WORDS.design} › ${EDITOR_WORDS.type} › ${EDITOR_WORDS.textStyles}.`;

/** What the picker says while a state other than Normal is edited. */
const STATE_HELD = "A text style is the same in every state.";

/** The picker, or a note where the site has no text styles yet. */
export function TextStylePicker({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const library = React.useContext(TextStyleLibrary);
  const target = React.useContext(StyleTargetContext);
  // The section's hold (a locked block, or one inside held content), which
  // the write is refused by as well.
  const sectionHeld = React.useContext(SectionHeld);
  const labelId = React.useId();
  const [refusal, setRefusal] = React.useState<{
    nodeId: string;
    reason: string;
  } | null>(null);
  const { editor, nodeId, state, tokens, prefersDark } = surroundings;
  if (library === undefined || target.kind !== "block") return null;
  const options = textStyleOptions(
    library,
    tokens,
    prefersDark ? "dark" : "light"
  );
  if (options.length === 0) {
    return (
      <p className="nx-inspector__note" data-control="text-style">
        {NONE_YET}
      </p>
    );
  }
  const worn = wornTextStyle(
    library,
    findNode(editor.document.nodes, nodeId)?.classes ?? []
  );
  const inState = state !== "base";
  const held = inState || sectionHeld;
  const choose = (id: string): void => {
    if (held) return;
    const plan = planTextStyle(
      editor.document,
      nodeId,
      library,
      id === NONE ? null : id,
      lockViewOf(editor)
    );
    if (!plan.ok) {
      setRefusal({ nodeId, reason: plan.reason });
      return;
    }
    setRefusal(null);
    if (plan.ops.length === 0) return;
    if (editor.applyAll(plan.ops) === null) {
      setRefusal({
        nodeId,
        reason: "This change could not be applied to the page.",
      });
    }
  };
  const shown = worn === undefined ? "None" : (worn.label ?? worn.slug);
  const said = refusal?.nodeId === nodeId ? refusal.reason : undefined;
  return (
    <fieldset
      className="nx-text-style-picker"
      data-control="text-style"
      disabled={held}
    >
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          {LABEL}
        </span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="nx-fonts__choice nx-text-style-picker__button"
              aria-label={`${LABEL}, ${shown}`}
              title={shown}
            >
              <span className="nx-fonts__choice-value">{shown}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={8}
            className="nx-vars__menu nx-text-style-picker__menu"
          >
            <DropdownMenuRadioGroup
              value={worn?.id ?? NONE}
              onValueChange={choose}
            >
              <DropdownMenuRadioItem value={NONE} data-text-style={NONE}>
                <span className="nx-vars__name">None</span>
              </DropdownMenuRadioItem>
              {options.map(option => (
                <TextStyleItem key={option.id} option={option} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {inState ? <p className="nx-inspector__note">{STATE_HELD}</p> : null}
      {said === undefined ? null : (
        <p className="nx-inspector__note" role="alert">
          {said}
        </p>
      )}
    </fieldset>
  );
}

/** One text style in the list: its name, its sample in its look, its pair. */
function TextStyleItem({
  option,
}: {
  option: TextStyleOption;
}): React.JSX.Element {
  return (
    <DropdownMenuRadioItem
      value={option.id}
      data-text-style={option.id}
      className="nx-text-style-picker__item"
      // Named by the style and its pair; the sample is decoration.
      aria-label={
        option.pair === "" ? option.name : `${option.name}, ${option.pair}`
      }
    >
      <span
        className="nx-vars__name nx-text-style-picker__name"
        title={option.name}
      >
        {option.name}
      </span>
      <span
        className="nx-site-text__preview"
        aria-hidden="true"
        style={option.preview}
      >
        {SAMPLE}
      </span>
      {option.pair === "" ? null : (
        <span className="nx-text-style-picker__pair" aria-hidden="true">
          {option.pair}
        </span>
      )}
    </DropdownMenuRadioItem>
  );
}
