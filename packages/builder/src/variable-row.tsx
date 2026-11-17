/**
 * One variable's row in the Design panel: a swatch, a type specimen or a
 * kind icon, its name, a value chip for what is not a colour, and a ⋯ menu.
 * The row opens the variable's editor beside it; F2 or the menu's Rename
 * edits the name in place in the row, and Shift+F10 or the menu key opens
 * the menu, as they do in a file list.
 *
 * A colour shows one swatch, split corner to corner, light at the top left
 * and dark at the bottom right, where its dark value differs. How widely a
 * variable is used is said in the row's tooltip and in its name to a screen
 * reader, not drawn on the row.
 *
 * @module variable-row
 */
import {
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import {
  Braces,
  Bold,
  Hash,
  Ruler,
  SquareRoundCorner,
  Timer,
  Type,
} from "lucide-react";
import * as React from "react";

import { colourHexOf } from "./style-colour";
import { lengthInPx, variableValueText } from "./style-variables";
import {
  lengthFamilyOf,
  relabelToken,
  variableLabelIssue,
  type VariableEntry,
} from "./tokens-studio";
import { VariableEditor } from "./variable-editor";
import { RowMenu } from "./variable-row-menu";
import { swatchStyle } from "./variable-swatch";
import { variableCountWords, type VariableReach } from "./variable-usage";
import { CountTip, type VariableUsageHere } from "./variable-usage-view";
import { CloseVariableEditor } from "./variable-value-controls";

export interface VariableRowProps {
  entry: VariableEntry;
  tokens: SiteTokenSet;
  mode: TokenMode;
  suppliedOf: (identity: string) => SiteToken | undefined;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (tokens: SiteTokenSet) => void;
  onRemoved: () => void;
  /** Adds a copy right below, and opens it. */
  onDuplicate: () => void;
  /** How widely it is used, where the host reads it. */
  usage: VariableUsageHere | undefined;
  /** Every variable the row stands for, together, once read. */
  reach: VariableReach | undefined;
}

/**
 * One variable: a button that opens its editor beside the row, and its ⋯.
 *
 * The button's name is the plain name followed by the values in words and
 * how widely it is used, so a screen reader hears what the swatch shows.
 */
export function VariableRow({
  entry,
  tokens,
  mode,
  suppliedOf,
  readOnly,
  open,
  onOpenChange,
  onChange,
  onRemoved,
  onDuplicate,
  usage,
  reach,
}: VariableRowProps): React.JSX.Element {
  const token = tokens.tokens[entry.row.at];
  const [removing, setRemoving] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const opened = (next: boolean): void => {
    if (!next) setRemoving(false);
    onOpenChange(next);
  };
  const handOff = useHandOff(opened);
  const shown = shownName(entry);
  const changing = !readOnly && token !== undefined;
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!changing) return;
    if (event.key === "F2") {
      event.preventDefault();
      setRenaming(true);
    } else if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      setMenuOpen(true);
    }
  };
  return (
    <li className="nx-vars__item" data-open={open ? "" : undefined}>
      <Popover open={open} onOpenChange={opened} modal>
        {/* The editor opens beside the whole row, the ⋯ with it. */}
        <PopoverAnchor asChild>
          <div className="nx-vars__line">
            {renaming && token !== undefined ? (
              <RenameField
                entry={entry}
                token={token}
                tokens={tokens}
                onChange={onChange}
                onDone={() => setRenaming(false)}
                row={button}
              />
            ) : (
              <CountTip reach={reach} quiet={open || menuOpen}>
                <PopoverTrigger asChild>
                  <button
                    ref={button}
                    type="button"
                    className="nx-vars__row"
                    data-variable-key={entry.row.key}
                    // The visible name first, then the values the swatch
                    // shows, so a screen reader hears both and speech input
                    // still matches.
                    aria-label={`${shown}${describe(entry, token, tokens, mode)}${countWords(reach)}`}
                    data-kind={entry.row.kind}
                    // Drawn as chosen while its editor is open. Its own mark:
                    // the row's tooltip sets `data-state` too, over the
                    // popover's.
                    data-open={open ? "" : undefined}
                    onKeyDown={onKeyDown}
                  >
                    <RowLead
                      entry={entry}
                      token={token}
                      tokens={tokens}
                      mode={mode}
                    />
                    <RowName entry={entry} />
                    <RowTail
                      entry={entry}
                      token={token}
                      tokens={tokens}
                      mode={mode}
                    />
                  </button>
                </PopoverTrigger>
              </CountTip>
            )}
            {changing ? (
              <RowMenu
                entry={entry}
                token={token}
                tokens={tokens}
                suppliedOf={suppliedOf}
                usage={usage}
                label={shown}
                open={menuOpen}
                onOpenChange={setMenuOpen}
                onChange={onChange}
                actions={{
                  onRename: () => setRenaming(true),
                  onDuplicate,
                  onEdit: startRemove => {
                    setRemoving(startRemove);
                    onOpenChange(true);
                  },
                }}
              />
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          // Kept inside the window, clear of its edges.
          collisionPadding={8}
          className="nx-vars-editor"
          aria-label={`${readOnly ? "" : "Edit "}${entry.label}`}
          onCloseAutoFocus={handOff.onCloseAutoFocus}
        >
          <CloseVariableEditor.Provider value={handOff.close}>
            <VariableEditor
              entry={entry}
              tokens={tokens}
              suppliedOf={suppliedOf}
              readOnly={readOnly}
              onChange={onChange}
              onRemoved={onRemoved}
              removing={removing}
              {...(usage === undefined ? {} : { usage })}
            />
          </CloseVariableEditor.Provider>
        </PopoverContent>
      </Popover>
    </li>
  );
}

/** The row's name, and its kind where another row shares the name. */
function RowName({ entry }: { entry: VariableEntry }): React.JSX.Element {
  return (
    <span className="nx-vars__name">
      {entry.label}
      {entry.kindWord === undefined ? null : (
        <span className="nx-vars__name-kind">{` · ${entry.kindWord}`}</span>
      )}
    </span>
  );
}

/**
 * The name, edited in place in the row. Enter or leaving the field keeps
 * it, Escape cancels; Enter and Escape hand focus back to the row. A name
 * that cannot be used keeps the field open on Enter, saying why; leaving
 * the field then cancels, so nothing half-typed is kept. The code name
 * stays as it is, so CSS that uses it keeps working.
 */
function RenameField({
  entry,
  token,
  tokens,
  onChange,
  onDone,
  row,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  onDone: () => void;
  row: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const id = React.useId();
  const [name, setName] = React.useState(entry.label);
  const [issue, setIssue] = React.useState<string | undefined>();
  // Once: Enter's own close takes the field away, and the blur that follows
  // must not keep or cancel a second time.
  const done = React.useRef(false);
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (refocus: boolean): void => {
    done.current = true;
    onDone();
    // Back on the row once it is drawn again in the field's place.
    if (refocus) window.setTimeout(() => row.current?.focus(), 0);
  };
  const keep = (refocus: boolean): boolean => {
    if (name.trim() === entry.label) {
      finish(refocus);
      return true;
    }
    const refused = variableLabelIssue(tokens, entry.row.at, name);
    if (refused !== undefined) {
      setIssue(refused);
      return false;
    }
    onChange(relabelToken(tokens, entry.row.at, name));
    finish(refocus);
    return true;
  };
  const said = `${id}-said`;
  return (
    <span className="nx-vars__rename">
      <RowLead entry={entry} token={token} tokens={tokens} mode="light" />
      <Input
        ref={field}
        className="nx-vars__rename-field"
        aria-label={`Name of ${entry.label}`}
        autoComplete="off"
        spellCheck={false}
        value={name}
        aria-invalid={issue === undefined ? undefined : true}
        aria-describedby={issue === undefined ? undefined : said}
        onChange={event => {
          setName(event.currentTarget.value);
          setIssue(undefined);
        }}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            keep(true);
          } else if (event.key === "Escape") {
            // Only the field: the canvas keeps its selection.
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          }
        }}
        onBlur={() => {
          if (done.current) return;
          if (!keep(false)) finish(false);
        }}
      />
      {issue === undefined ? null : (
        <span className="nx-vars__rename-issue" id={said} role="status">
          {issue}
        </span>
      )}
    </span>
  );
}

/**
 * A colour's one swatch: its light value, split corner to corner with its
 * dark value at the bottom right where the two differ. An unwritten colour,
 * which the page does not carry, draws the empty swatch.
 */
function ColourSwatch({
  entry,
  token,
}: {
  entry: VariableEntry;
  token: SiteToken | undefined;
}): React.JSX.Element {
  const written = entry.row.written && token !== undefined;
  const light = written
    ? colourHexOf(token.values.light, undefined)
    : undefined;
  const dark =
    written && token.values.dark !== undefined
      ? colourHexOf(token.values.dark, undefined)
      : undefined;
  const split =
    light !== undefined &&
    dark !== undefined &&
    light.toLowerCase() !== dark.toLowerCase();
  return (
    <span
      className="nx-vars__swatch nx-vars__swatch--main"
      aria-hidden="true"
      data-split={split ? "" : undefined}
      style={{
        ...swatchStyle(light),
        ...(split ? { "--nx-swatch-dark": dark } : {}),
      }}
    />
  );
}

/**
 * Closing a row's editor for a control that sends the author elsewhere: the
 * editor closes without handing focus back to the row, which would take it
 * from the place the author was sent to.
 */
export function useHandOff(onOpenChange: (open: boolean) => void): {
  close: () => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const handingOff = React.useRef(false);
  const close = React.useCallback(() => {
    handingOff.current = true;
    onOpenChange(false);
  }, [onOpenChange]);
  const onCloseAutoFocus = React.useCallback((event: Event) => {
    if (!handingOff.current) return;
    handingOff.current = false;
    event.preventDefault();
  }, []);
  return { close, onCloseAutoFocus };
}

/** The row's count in words, after its name and values, once it is read. */
function countWords(reach: VariableReach | undefined): string {
  return reach === undefined ? "" : `. ${variableCountWords(reach)}`;
}

/**
 * The row's name as it is read: its label, and its kind when another row is
 * shown under the same name.
 */
function shownName(entry: VariableEntry): string {
  return entry.kindWord === undefined
    ? entry.label
    : `${entry.label} · ${entry.kindWord}`;
}

/** The value a variable shows for the preview mode, falling back to light. */
function valueFor(token: SiteToken | undefined, mode: TokenMode): string {
  if (token === undefined) return "";
  return mode === "dark"
    ? (token.values.dark ?? token.values.light)
    : token.values.light;
}

/** The row's leading preview: a swatch, a type specimen, or a kind icon. */
function RowLead({
  entry,
  token,
  tokens,
  mode,
}: {
  entry: VariableEntry;
  token: SiteToken | undefined;
  tokens: SiteTokenSet;
  mode: TokenMode;
}): React.JSX.Element {
  const kind = entry.row.kind;
  if (kind === "color") return <ColourSwatch entry={entry} token={token} />;
  if (entry.row.name.startsWith("font-size.")) {
    return (
      <span
        className="nx-vars__specimen"
        aria-hidden="true"
        style={{
          fontSize: `${String(specimenSize(valueFor(token, mode)))}px`,
          fontFamily: siteFamily(tokens, mode),
        }}
      >
        Aa
      </span>
    );
  }
  // A radius draws a corner, so it is told from a spacing step at a glance.
  const radius = lengthFamilyOf(entry.row) === "radius";
  const Icon = radius ? SquareRoundCorner : KIND_ICONS[kind];
  return (
    <span
      className="nx-vars__kind"
      aria-hidden="true"
      data-variable-icon={lengthFamilyOf(entry.row) ?? kind}
    >
      {kind === "shadow" ? (
        <span
          className="nx-vars__shadow"
          style={{ boxShadow: valueFor(token, mode) }}
        />
      ) : (
        <Icon size={14} />
      )}
    </span>
  );
}

const KIND_ICONS: Readonly<
  Record<TokenKind, React.ComponentType<{ size?: number }>>
> = {
  color: Hash,
  dimension: Ruler,
  fontFamily: Type,
  fontWeight: Bold,
  number: Hash,
  shadow: Hash,
  duration: Timer,
  custom: Braces,
};

/**
 * The specimen's drawn size: the type size scaled into the row, so a heading
 * still reads larger than body text without growing the row.
 */
function specimenSize(value: string): number {
  // Read through the inspector's own reading of a length, so a type size is
  // measured the same way in both places; a value it cannot measure is drawn
  // at body size, as before.
  const px = lengthInPx(value) ?? 16;
  return Math.min(18, Math.max(11, Math.round(10 + px * 0.2)));
}

/** The site's body font, when it names a family this panel can draw. */
function siteFamily(tokens: SiteTokenSet, mode: TokenMode): string | undefined {
  // By identity, the one a rename leaves alone: the body font keeps drawing
  // after an author renames it.
  const body = tokens.tokens.find(
    token => tokenIdentity(token) === "font.body"
  );
  const family = valueFor(body, mode);
  return family === "" || /var\s*\(/i.test(family) ? undefined : family;
}

/** The row's trailing value chip; none on a colour row. */
function RowTail({
  entry,
  token,
  mode,
}: {
  entry: VariableEntry;
  token: SiteToken | undefined;
  tokens: SiteTokenSet;
  mode: TokenMode;
}): React.JSX.Element | null {
  // A colour's one swatch says its values; nothing follows its name.
  if (token === undefined || entry.row.kind === "color") return null;
  const own = valueFor(token, mode);
  const words = chipText(entry, own);
  return (
    <span
      className="nx-vars__chip"
      aria-hidden="true"
      // The whole value on hover when the chip says it in fewer words, as
      // "Fluid" does; the row's name says it to a screen reader already.
      title={words === chipText(entry, own, "raw") ? undefined : own}
    >
      {words}
    </span>
  );
}

/**
 * "16 / 26" for a type size with its line height, or the value itself, in
 * the picker's words: "Fluid" for a length that changes with the page, whose
 * whole `clamp()` crowded the name out of the row. `raw` keeps the value as
 * written, to tell whether the words shortened it.
 */
function chipText(
  entry: VariableEntry,
  own: string,
  form: "words" | "raw" = "words"
): string {
  const text =
    form === "raw"
      ? own
      : variableValueText({ kind: entry.row.kind, value: own });
  if (entry.lineHeight === undefined) return text;
  return `${bare(text)} / ${bare(entry.lineHeight.value)}`;
}

/** A px value without its unit, as designers write a type scale. */
function bare(value: string): string {
  return value.trim().replace(/^(-?\d*\.?\d+)px$/, "$1");
}

/** The row's values in words, for the button's accessible name. */
function describe(
  entry: VariableEntry,
  token: SiteToken | undefined,
  tokens: SiteTokenSet,
  mode: TokenMode
): string {
  if (token === undefined) return "";
  // A colour row shows both its swatches, so both values are said whatever
  // the preview; every other row shows the preview mode's value, so that is
  // the one said, read through the same projection the row draws with.
  if (entry.row.kind === "color") {
    const dark = token.values.dark;
    return `, light ${token.values.light}, dark ${dark ?? "same as light"}`;
  }
  if (entry.lineHeight !== undefined) {
    const line = valueFor(tokens.tokens[entry.lineHeight.at], mode);
    return `, size ${valueFor(token, mode)}, line height ${line}`;
  }
  return `, ${valueFor(token, mode)}`;
}
