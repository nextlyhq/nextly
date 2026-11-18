/**
 * The inspector's Font control: choose from what the site can draw.
 *
 * Choose-only, with no box to type a family into. A typed name is a guess the
 * page may not be able to keep: a family the site has no file for renders in
 * whatever the reader's device has, and nothing says so. The list offers three
 * kinds of choice, each of which the published page can draw:
 *
 * - the site's font variables, stored as a reference so a change to the
 *   variable reaches every block using it;
 * - the families the site has files for, stored as the family followed by the
 *   generic family of its category, so a reader still gets a sensible face
 *   while the file loads;
 * - the system families, which every browser resolves.
 *
 * Every choice is drawn in itself. A value stored before, or written by the
 * API, that is none of these is shown as it is and can be cleared.
 *
 * A font variable chosen shows in green, as every value from a variable does,
 * with what it is in its tooltip and "Unlink" beside it, which keeps its
 * family as a plain one.
 *
 * @module font-family-field
 */
import {
  GENERIC_FONT_FAMILIES,
  isTokenRef,
  readFamilyList,
  resolveSiteTokens,
  tokenDisplayLabel,
  tokenIdentity,
  type FontFaceDef,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { ChoiceList } from "./choice-list";
import { familyStack, siteFamilies } from "./font-library";
import { InheritedValue } from "./inherited-value";
import { variableFor, type SiteVariable } from "./style-colour";
import {
  focusAfterUnlink,
  UnlinkButton,
  VariableTipped,
  variableTip,
} from "./variable-choice";

export interface FontFamilyFieldProps {
  /** The control's id, so its label can point at it. */
  id?: string;
  /** The id of the element naming the property. */
  labelledBy?: string;
  /** What the block stores now. */
  stored: StyleValue | undefined;
  /** The site's variables, whose font variables are offered first. */
  tokens: SiteTokenSet | undefined;
  /**
   * The faces the page loads, or `undefined` while the site's style is being
   * read. Families with files are offered from them.
   */
  faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies, which the editor cannot remove. */
  fromCode: readonly FontFaceDef[];
  /** Store a choice, or `null` to clear the property. */
  onCommit: (value: StyleValue | null) => void;
  /** Open Design's fonts, where fonts are added. Absent, no link shows. */
  onManageFonts?: () => void;
}

/**
 * What the inspector's host knows about the site's fonts: the faces the page
 * loads, the ones the site's code supplies, and a way to Design's fonts.
 */
export interface FontChoices {
  /** The faces the page loads, or `undefined` while they are being read. */
  readonly faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies. */
  readonly fromCode: readonly FontFaceDef[];
  /** Open Design's fonts. */
  readonly onManageFonts?: () => void;
}

/**
 * The site's fonts, for the Font control wherever the inspector draws it.
 *
 * A context rather than a prop threaded through each section and field: only
 * one control reads it, and every layer between the panel and that control
 * would otherwise carry a value it never uses.
 */
export const FontChoicesContext: React.Context<FontChoices | undefined> =
  React.createContext<FontChoices | undefined>(undefined);

/** Whether a stored value is one this control can show: none, a stack, a reference. */
export function fontFamilyShowable(stored: StyleValue | undefined): boolean {
  return (
    stored === undefined || typeof stored === "string" || isTokenRef(stored)
  );
}

/** One entry in the list. */
interface FontChoice {
  readonly key: string;
  readonly group: ChoiceGroup;
  readonly label: string;
  /** The stack the entry is drawn in, when one can be drawn. */
  readonly drawn: string | undefined;
  /** What picking it stores. */
  readonly value: StyleValue;
}

type ChoiceGroup = "variables" | "site" | "system";

const GROUPS: ReadonlyArray<{ group: ChoiceGroup; heading: string }> = [
  { group: "variables", heading: "Font variables" },
  { group: "site", heading: "On this site" },
  { group: "system", heading: "System" },
];

/** The generic families in an author's words, the common ones first. */
const GENERIC_LABELS: Readonly<Record<string, string>> = {
  "system-ui": "System UI",
  "sans-serif": "Sans serif",
  serif: "Serif",
  monospace: "Monospace",
  cursive: "Cursive",
  fantasy: "Fantasy",
  "ui-sans-serif": "System sans serif",
  "ui-serif": "System serif",
  "ui-monospace": "System monospace",
  "ui-rounded": "System rounded",
  math: "Math",
  emoji: "Emoji",
  fangsong: "Fangsong",
};

/**
 * The families every browser resolves: exactly the generic keywords the
 * engine accepts, so no value it stores reads as unknown here. One without
 * words of its own is shown as written.
 */
const SYSTEM: ReadonlyArray<{ label: string; value: string }> = [
  ...Object.keys(GENERIC_LABELS).filter(value =>
    GENERIC_FONT_FAMILIES.includes(value)
  ),
  ...GENERIC_FONT_FAMILIES.filter(value => !(value in GENERIC_LABELS)),
].map(value => ({ label: GENERIC_LABELS[value] ?? value, value }));

/** A stack that draws, or nothing for one that only resolves on the page. */
function drawable(stack: string): string | undefined {
  return /var\s*\(/i.test(stack) ? undefined : stack;
}

/** Every entry the control offers, in the order it lists them. */
function choicesFor(
  tokens: SiteTokenSet | undefined,
  faces: readonly FontFaceDef[] | undefined,
  fromCode: readonly FontFaceDef[]
): FontChoice[] {
  const variables: FontChoice[] =
    tokens === undefined
      ? []
      : resolveSiteTokens(tokens)
          .tokens.filter(token => token.kind === "fontFamily")
          .map(token => {
            const identity = tokenIdentity(token);
            return {
              key: `variable:${identity}`,
              group: "variables",
              label: tokenDisplayLabel(token),
              drawn: drawable(token.values.light),
              value: { $token: identity },
            };
          });
  const site: FontChoice[] = siteFamilies(faces ?? [], fromCode).map(family => {
    const stack = familyStack(family.family, family.category);
    return {
      key: `site:${family.key}`,
      group: "site",
      label: family.family,
      drawn: stack,
      value: stack,
    };
  });
  const system: FontChoice[] = SYSTEM.map(entry => ({
    key: `system:${entry.value}`,
    group: "system",
    label: entry.label,
    drawn: entry.value,
    value: entry.value,
  }));
  return [...variables, ...site, ...system];
}

/** A stack written the way two equal stacks compare: no spacing, no case. */
function normalised(stack: string): string {
  return stack
    .replace(/\s*,\s*/g, ",")
    .trim()
    .toLowerCase();
}

/**
 * The entry a stored value is, or nothing when it is none of them.
 *
 * A family stored without its generic, or with another one, is still that
 * family: the first name in a stack is the author's choice.
 */
/**
 * The family reaching this block from another tier, shown greyed while none
 * is chosen here: named as the list names it where the site offers it, and
 * as written where it does not.
 */
function useInheritedFamily(
  choices: readonly FontChoice[]
): string | undefined {
  const inherited = React.useContext(InheritedValue);
  if (inherited === undefined) return undefined;
  return currentChoice(inherited, choices)?.label ?? inherited;
}

function currentChoice(
  stored: StyleValue | undefined,
  choices: readonly FontChoice[]
): FontChoice | undefined {
  if (stored === undefined) return undefined;
  if (isTokenRef(stored)) {
    return choices.find(
      choice =>
        isTokenRef(choice.value) && choice.value.$token === stored.$token
    );
  }
  if (typeof stored !== "string") return undefined;
  const exact = choices.find(
    choice =>
      typeof choice.value === "string" &&
      normalised(choice.value) === normalised(stored)
  );
  if (exact !== undefined) return exact;
  const reading = readFamilyList(stored);
  if (reading.kind !== "families") return undefined;
  const first = reading.parts[0]?.part.name.toLowerCase();
  return choices.find(
    choice => choice.group === "site" && choice.key === `site:${first ?? ""}`
  );
}

/** The stored value in words, for one the list does not hold. */
function storedText(stored: StyleValue): string {
  if (isTokenRef(stored)) return stored.$token;
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

export function FontFamilyField({
  id,
  labelledBy,
  stored,
  tokens,
  faces,
  fromCode,
  onCommit,
  onManageFonts,
}: FontFamilyFieldProps): React.JSX.Element {
  const choices = React.useMemo(
    () => choicesFor(tokens, faces, fromCode),
    [tokens, faces, fromCode]
  );
  const current = currentChoice(stored, choices);
  const unknown = stored !== undefined && current === undefined;
  const [open, setOpen] = React.useState(false);
  // The trigger, which stays when Unlink makes the family plain: focus
  // returns to it from the Unlink that goes.
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inheritedFamily = useInheritedFamily(choices);
  const shownValue = unknown
    ? `${storedText(stored)} · not on this site`
    : (current?.label ?? inheritedFamily ?? "Default");
  const held = useHeldFont(stored, tokens);

  return (
    <div
      className="nx-font-pick"
      data-unknown={unknown ? "" : undefined}
      data-bound={held === undefined ? undefined : ""}
    >
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        {/* What a held font variable is, in the trigger's tooltip. */}
        <VariableTipped
          tip={
            held === undefined
              ? undefined
              : variableTip(held, shownValue, tokens)
          }
        >
          <PopoverTrigger asChild>
            <FontTrigger
              ref={triggerRef}
              id={id}
              labelledBy={labelledBy}
              open={open}
              shownValue={shownValue}
              placeholder={current === undefined && !unknown}
              drawn={current?.drawn}
            />
          </PopoverTrigger>
        </VariableTipped>
        {/* Aligned to the control's right edge: the list may be wider than
            the control, and the inspector sits at the window's right edge. */}
        <PopoverContent
          align="end"
          sideOffset={4}
          className="nx-font-pick__popover"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <FontList
            choices={choices}
            current={current}
            onPick={choice => {
              setOpen(false);
              onCommit(choice.value);
            }}
            onManageFonts={
              onManageFonts === undefined
                ? undefined
                : () => {
                    setOpen(false);
                    onManageFonts();
                  }
            }
          />
        </PopoverContent>
      </Popover>
      {held === undefined ? null : (
        <UnlinkButton
          label="Font"
          // The family the variable gives in the mode the canvas shows, kept
          // as a plain one in one commit.
          onUnlink={() => {
            onCommit(held.value);
            focusAfterUnlink(() => triggerRef.current);
          }}
        />
      )}
    </div>
  );
}

/** Ids that describe an element, joined, or `undefined` for none. */
function describedBy(
  ...ids: readonly (string | undefined)[]
): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}

/**
 * What opens the list: the choice in force, drawn in itself, or the inherited
 * family greyed as a placeholder. Handed the popover's trigger props.
 */
function FontTrigger({
  id,
  labelledBy,
  open,
  shownValue,
  placeholder,
  drawn,
  ...trigger
}: React.ComponentProps<"button"> & {
  labelledBy: string | undefined;
  open: boolean;
  shownValue: string;
  placeholder: boolean;
  drawn: string | undefined;
}): React.JSX.Element {
  return (
    <button
      {...trigger}
      type="button"
      id={id}
      className="nx-font-pick__trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={`Font, ${shownValue}`}
      // The label's words, and the tooltip's while it shows: the tooltip
      // hands its id in through the trigger props, and the label's alone
      // would replace it.
      aria-describedby={describedBy(trigger["aria-describedby"], labelledBy)}
    >
      <span
        className="nx-font-pick__value"
        data-placeholder={placeholder ? "" : undefined}
        style={drawn === undefined ? undefined : { fontFamily: drawn }}
      >
        {shownValue}
      </span>
      <ChevronDown aria-hidden="true" size={14} />
    </button>
  );
}

/**
 * The font variable a field holds, as the canvas shows it, or `undefined` for
 * a family, none, or a variable the site no longer has.
 */
function useHeldFont(
  stored: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): SiteVariable | undefined {
  const mode = useCanvasTokenMode();
  return isTokenRef(stored)
    ? variableFor(stored.$token, tokens, mode)
    : undefined;
}

/**
 * The open list: the three groups, searchable once long, and the link to
 * Design's fonts.
 */
function FontList({
  choices,
  current,
  onPick,
  onManageFonts,
}: {
  choices: readonly FontChoice[];
  current: FontChoice | undefined;
  onPick: (choice: FontChoice) => void;
  onManageFonts: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <div className="nx-font-pick__body">
      <ChoiceList
        choices={choices}
        currentKey={current?.key}
        onPick={onPick}
        label="Fonts"
        searchLabel="Search fonts"
        noMatch="No fonts match this search."
        groups={GROUPS}
        // Each entry is drawn in itself.
        choiceStyle={choice =>
          choice.drawn === undefined ? undefined : { fontFamily: choice.drawn }
        }
      />
      {onManageFonts === undefined ? null : (
        <div className="nx-font-pick__footer">
          <button
            type="button"
            className="nx-vars__link"
            onClick={onManageFonts}
          >
            Manage fonts…
          </button>
        </div>
      )}
    </div>
  );
}
