"use client";

/**
 * The top of Design → Type: "Body font" and "Headings font", the fonts every
 * page's text and headings are set in, on the canvas and the live site.
 *
 * Each is a row naming its font, drawn in it, that opens a list of what the
 * site can draw: the site's own fonts, the system's, and "Your site's own
 * font" (for Headings, "Same as body"), which writes nothing. A pick is one
 * new token set handed to the host, as a variable edit is, so it saves,
 * merges and undoes the same way (`site-font-roles-model`). What a row writes
 * is said on hover and, while "Show CSS names" is on, under the row.
 *
 * Under them, when headings are drawn in one of the site's fonts that has no
 * bold, a line says so, with "Add Bold" for a font from the catalogue.
 *
 * @module site-font-roles
 */
import type {
  FontFaceDef,
  SiteTextMap,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { ChoiceList } from "./choice-list";
import { FONT_ROLE_WORDS, noBoldWords } from "./editor-words";
import type { CatalogueAddRequest } from "./font-catalogue-view";
import { CssHint, CssNamesLine } from "./inspector/css-hint";
import { Refusal, useRefusableWrite } from "./panel-actions";
import {
  firstFamily,
  fontRoleSetting,
  fontRoleWrites,
  missingBold,
  roleFamilies,
  withFontRole,
  type FontRole,
  type MissingBold,
  type RoleFamily,
} from "./site-font-roles-model";

export interface SiteFontRolesProps {
  readonly tokens: SiteTokenSet;
  readonly onChange: (tokens: SiteTokenSet) => void;
  readonly readOnly: boolean;
  /** The Site text rows the site's code supplies. */
  readonly supplied?: SiteTextMap | undefined;
  /** The faces the page loads, or `undefined` while they are being read. */
  readonly faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies. */
  readonly fromCode: readonly FontFaceDef[];
  /** Open the site's fonts, where fonts are added. Absent, no link shows. */
  readonly onManageFonts?: (() => void) | undefined;
  /**
   * Add cuts of a catalogue family to the site, resolving to a message when
   * refused. Absent, "Add Bold" is not offered.
   */
  readonly onAddCut?:
    | ((request: CatalogueAddRequest) => Promise<string | undefined>)
    | undefined;
}

/** One entry of a role's list. */
interface RoleChoice {
  readonly key: string;
  readonly group: "start" | "site" | "system";
  readonly label: string;
  /** What picking it stores, or `undefined` for the entry writing nothing. */
  readonly stack: string | undefined;
}

/** The system's own fonts, each with the fallback of its kind. */
const SYSTEM_STACKS: ReadonlyArray<readonly [string, string]> = [
  ["System UI", "system-ui, sans-serif"],
  ["Sans serif", "sans-serif"],
  ["Serif", "serif"],
  ["Monospace", "monospace"],
  ["System serif", "ui-serif, serif"],
  ["System monospace", "ui-monospace, monospace"],
  ["System rounded", "ui-rounded, sans-serif"],
];

const GROUPS: ReadonlyArray<{ group: RoleChoice["group"]; heading: string }> = [
  { group: "start", heading: "" },
  { group: "site", heading: "On this site" },
  { group: "system", heading: "System" },
];

/** What a role says while it writes nothing. */
function unsetWords(role: FontRole): string {
  return role === "body" ? FONT_ROLE_WORDS.ownFont : FONT_ROLE_WORDS.sameAsBody;
}

/** Every entry a role's list offers, in the order it lists them. */
function choicesFor(
  role: FontRole,
  families: readonly RoleFamily[]
): RoleChoice[] {
  return [
    { key: "start", group: "start", label: unsetWords(role), stack: undefined },
    ...families.map(
      (family): RoleChoice => ({
        key: `site:${family.family.toLowerCase()}`,
        group: "site",
        label: family.family,
        stack: family.stack,
      })
    ),
    ...SYSTEM_STACKS.map(
      ([label, stack]): RoleChoice => ({
        key: `system:${stack}`,
        group: "system",
        label,
        stack,
      })
    ),
  ];
}

/** A stack as two equal stacks compare: no spacing, no case. */
function normalised(stack: string): string {
  return stack
    .replace(/\s*,\s*/g, ",")
    .trim()
    .toLowerCase();
}

/**
 * The entry a stack is: the one storing it, else the one naming the same
 * first family, since the first family in a stack is the author's choice.
 */
function choiceOf(
  stack: string,
  choices: readonly RoleChoice[]
): RoleChoice | undefined {
  const exact = choices.find(
    choice =>
      choice.stack !== undefined &&
      normalised(choice.stack) === normalised(stack)
  );
  if (exact !== undefined) return exact;
  const first = firstFamily(stack);
  return choices.find(
    choice => choice.stack !== undefined && firstFamily(choice.stack) === first
  );
}

/** What a role's row shows: its entry, and its words. */
interface RoleShown {
  readonly current: RoleChoice | undefined;
  readonly words: string;
  /** The stack the row's specimen is drawn in, when one can be drawn. */
  readonly drawn: string | undefined;
}

/** A role as its row shows it. */
function shownOf(
  tokens: SiteTokenSet,
  role: FontRole,
  choices: readonly RoleChoice[]
): RoleShown {
  const setting = fontRoleSetting(tokens, role);
  if (setting.kind === "unset") {
    return { current: choices[0], words: unsetWords(role), drawn: undefined };
  }
  if (setting.kind === "mixed") {
    return { current: undefined, words: "Set per heading", drawn: undefined };
  }
  const current = choiceOf(setting.stack, choices);
  return {
    current,
    words: current?.label ?? `${setting.stack} · not on this site`,
    drawn: /var\s*\(/i.test(setting.stack) ? undefined : setting.stack,
  };
}

/** The two rows, and the missing-Bold line under them. */
export function SiteFontRoles({
  tokens,
  onChange,
  readOnly,
  supplied,
  faces,
  fromCode,
  onManageFonts,
  onAddCut,
}: SiteFontRolesProps): React.JSX.Element {
  const families = React.useMemo(
    () => roleFamilies(faces ?? [], fromCode),
    [faces, fromCode]
  );
  const missing = missingBold(tokens, families);
  const pick = (role: FontRole, stack: string | undefined): void =>
    onChange(withFontRole(tokens, role, stack, supplied));
  return (
    <section className="nx-font-roles" aria-label="Body and headings fonts">
      {(["body", "heading"] as const).map(role => (
        <FontRoleRow
          key={role}
          role={role}
          tokens={tokens}
          choices={choicesFor(role, families)}
          readOnly={readOnly}
          onPick={stack => pick(role, stack)}
          onManageFonts={onManageFonts}
        />
      ))}
      {missing === undefined ? null : (
        <MissingBoldLine
          missing={missing}
          onAddCut={readOnly ? undefined : onAddCut}
        />
      )}
    </section>
  );
}

/** One role's row and its list. */
function FontRoleRow({
  role,
  tokens,
  choices,
  readOnly,
  onPick,
  onManageFonts,
}: {
  role: FontRole;
  tokens: SiteTokenSet;
  choices: readonly RoleChoice[];
  readOnly: boolean;
  onPick: (stack: string | undefined) => void;
  onManageFonts: (() => void) | undefined;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const namesId = React.useId();
  const label = FONT_ROLE_WORDS[role];
  const shown = shownOf(tokens, role, choices);
  const face = (
    <>
      <span
        className="nx-font-roles__specimen"
        aria-hidden="true"
        style={
          shown.drawn === undefined ? undefined : { fontFamily: shown.drawn }
        }
      >
        Aa
      </span>
      <span className="nx-font-roles__text" aria-hidden="true">
        <span className="nx-font-roles__name">{label}</span>
        <span className="nx-font-roles__value" title={shown.words}>
          {shown.words}
        </span>
      </span>
      {/* The row's name, in one element: the role, then the font it shows.
          Text rather than an aria-label, which would have to hold every drawn
          word, the "Aa" included; one element, so no browser puts a space
          before its comma. */}
      <span className="nx-sr-only">{`${label}, ${shown.words}`}</span>
    </>
  );
  if (readOnly) {
    return (
      <div className="nx-font-roles__row" data-font-role={role}>
        {face}
      </div>
    );
  }
  return (
    <div className="nx-font-roles__item">
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <CssHint writes={fontRoleWrites(tokens, role)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-font-roles__row"
              data-font-role={role}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              {face}
              <ChevronDown aria-hidden="true" size={14} />
            </button>
          </PopoverTrigger>
        </CssHint>
        <CssNamesLine id={namesId} names={["font-family"]} />
        <PopoverContent
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="nx-font-pick__popover nx-font-roles__popover"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <div className="nx-font-pick__body">
            <ChoiceList
              choices={choices}
              currentKey={shown.current?.key}
              onPick={choice => {
                setOpen(false);
                onPick(choice.stack);
              }}
              label={label}
              searchLabel="Search fonts"
              noMatch="No fonts match this search."
              groups={GROUPS}
              // Each font is drawn in itself.
              choiceStyle={choice =>
                choice.stack === undefined
                  ? undefined
                  : { fontFamily: choice.stack }
              }
            />
            {onManageFonts === undefined ? null : (
              <div className="nx-font-pick__footer">
                <button
                  type="button"
                  className="nx-vars__link"
                  onClick={() => {
                    setOpen(false);
                    onManageFonts();
                  }}
                >
                  Manage fonts…
                </button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** "<font> has no Bold…", with "Add Bold" where the catalogue can add it. */
function MissingBoldLine({
  missing,
  onAddCut,
}: {
  missing: MissingBold;
  onAddCut:
    | ((request: CatalogueAddRequest) => Promise<string | undefined>)
    | undefined;
}): React.JSX.Element {
  const { busy, refusal, run } = useRefusableWrite();
  const { add } = missing;
  return (
    <div className="nx-font-roles__note" role="status">
      <p className="nx-font-roles__note-text">{noBoldWords(missing.family)}</p>
      {add === undefined || onAddCut === undefined ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-font-roles__add"
          disabled={busy}
          onClick={() => void run(() => onAddCut(add))}
        >
          {FONT_ROLE_WORDS.addBold}
        </Button>
      )}
      <Refusal refusal={refusal} />
    </div>
  );
}
