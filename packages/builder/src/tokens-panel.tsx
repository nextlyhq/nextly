/**
 * The Variables view of the Design panel: the site's named colours, type
 * sizes, spacing and the rest, each with its light and dark value.
 *
 * A panel over {@link tokens-studio}, which holds every rule this draws: what
 * group a variable is in, what an edit produces and what the engine says
 * about it. This decides only what it looks like.
 *
 * ## Compact rows, edited beside the panel
 *
 * Each variable is one row: a swatch or a specimen, its plain name, and its
 * light and dark values. Choosing a row opens its editor in a popover beside
 * the panel, so the list stays readable at a glance and the editing has room.
 *
 * ## The header is the Design panel's
 *
 * The preview switch and the import-and-export menu belong in the Design
 * panel's own header, beside its title. The host passes that element as
 * `headerActions`, and the controls are drawn into it; with none, they sit at
 * the top of this view.
 *
 * ## Edits are lifted, not saved here
 *
 * Every control reports a NEW set to the host and stores nothing. Saving
 * belongs to whoever owns the site style.
 *
 * @module tokens-panel
 */
import {
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import {
  Braces,
  Bold,
  Hash,
  Plus,
  Ruler,
  Search,
  Timer,
  Type,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { colourHexOf } from "./style-colour";
import {
  addVariable,
  labelNewVariable,
  variableGroups,
  type NewVariable,
  type VariableEntry,
  type VariableGroup,
} from "./tokens-studio";
import { swatchStyle, VariableEditor } from "./variable-editor";
import { useVariablesTransfer } from "./variables-transfer";

export interface TokensPanelProps {
  /**
   * The site's variables, or `undefined` while the host has not read them.
   * A real third state: a site may legitimately have none of its own.
   */
  tokens: SiteTokenSet | undefined;
  /** An edit. The host owns the site style and decides when to persist. */
  onChange: (tokens: SiteTokenSet) => void;
  /**
   * The set the host holds RIGHT NOW, asked at the moment it is needed.
   * Answer it from a ref the host writes as it dispatches: an import reads
   * files asynchronously and must merge into the newest set, not into one this
   * panel rendered with.
   */
  currentTokens: () => SiteTokenSet | undefined;
  /**
   * The variables something else supplies (the site's code and the engine's
   * defaults), which the stored ones layer over. These can be reset and not
   * removed: absence from the stored tier means "no override".
   */
  supplied?: SiteTokenSet;
  /** What the last save said, when it failed. */
  issue?: string;
  /** Whether the device prefers dark, which the preview starts on. */
  prefersDark?: boolean;
  /** Why there are no variables to show: a read in flight, or one that failed. */
  absence?: "pending" | "failed";
  /**
   * Shown, never changed. Fields stay selectable (`readOnly`, not disabled)
   * and every control that would change something is left out.
   */
  readOnly?: boolean;
  /** The Design panel's header element, where the header controls are drawn. */
  headerActions?: HTMLElement | null;
}

/** How many rows of one group mount before the author asks for more. */
const PAGE_SIZE = 50;

export function TokensPanel({
  tokens,
  onChange,
  currentTokens,
  supplied,
  issue,
  absence = "pending",
  prefersDark = false,
  readOnly = false,
  headerActions,
}: TokensPanelProps): React.JSX.Element {
  const [mode, setMode] = React.useState<TokenMode>(
    prefersDark ? "dark" : "light"
  );
  const [query, setQuery] = React.useState("");
  const { root, openKey, toggle, add, forget } = useOpenVariable({
    tokens,
    onChange,
    currentTokens,
    onAdded: () => setQuery(""),
  });
  const search = React.useRef<HTMLInputElement>(null);
  const transfer = useVariablesTransfer({ onChange, currentTokens, readOnly });

  const groups = React.useMemo(
    () => (tokens === undefined ? [] : variableGroups(tokens, mode)),
    [tokens, mode]
  );
  const needle = query.trim().toLowerCase();
  const shown = searched(groups, needle);

  const header = (
    <div className="nx-vars__controls">
      <PreviewSwitch mode={mode} onMode={setMode} />
      {transfer.menu}
    </div>
  );

  if (tokens === undefined) {
    return <Unread absence={absence} />;
  }

  return (
    <div
      className="nx-vars"
      ref={root}
      data-read-only={readOnly ? "" : undefined}
    >
      <HeaderControls slot={headerActions}>{header}</HeaderControls>
      <div className="nx-vars__search">
        <Search aria-hidden="true" size={16} />
        <Input
          ref={search}
          type="search"
          aria-label="Search variables"
          placeholder="Search variables"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      <div className="nx-vars__body">
        <PanelNotes readOnly={readOnly} issue={issue} />
        {transfer.overlays}
        {shown.length === 0 ? (
          <p className="nx-vars__note">No variables match this search.</p>
        ) : (
          shown.map(group => (
            <Group
              key={group.group}
              group={group.group}
              heading={group.heading}
              entries={group.entries}
              searching={needle !== ""}
              readOnly={readOnly}
              openKey={openKey}
              onAdd={add}
            >
              {(entry: VariableEntry) => (
                <VariableRow
                  key={entry.row.key}
                  entry={entry}
                  tokens={tokens}
                  mode={mode}
                  suppliedOf={identity => suppliedFor(supplied, identity)}
                  readOnly={readOnly}
                  open={openKey === entry.row.key}
                  onOpenChange={open => toggle(entry.row.key, open)}
                  onChange={onChange}
                  onRemoved={() => {
                    forget(entry.row.key);
                    search.current?.focus();
                  }}
                />
              )}
            </Group>
          ))
        )}
      </div>
    </div>
  );
}

/** What shows while the variables are being read, or after a read failed. */
function Unread({
  absence,
}: {
  absence: "pending" | "failed";
}): React.JSX.Element {
  const failed = absence === "failed";
  return (
    <div className="nx-vars">
      <p
        className={failed ? "nx-vars__alert" : "nx-vars__note"}
        role={failed ? "alert" : "status"}
      >
        {failed
          ? "This site\u2019s variables could not be read, so none can be shown or changed. Reload to try again."
          : "Reading this site\u2019s variables\u2026"}
      </p>
    </div>
  );
}

/** The header controls, in the Design panel's header when it gives one. */
function HeaderControls({
  slot,
  children,
}: {
  slot: HTMLElement | null | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  if (slot) return <>{createPortal(children, slot)}</>;
  return <div className="nx-vars__head">{children}</div>;
}

/** The read-only line, and a save that failed. */
function PanelNotes({
  readOnly,
  issue,
}: {
  readOnly: boolean;
  issue: string | undefined;
}): React.JSX.Element {
  return (
    <>
      {readOnly ? (
        <p className="nx-vars__note">
          You can view the site&rsquo;s variables but not change them.
        </p>
      ) : null}
      {issue === undefined ? null : (
        <p className="nx-vars__alert" role="alert">
          {issue}
        </p>
      )}
    </>
  );
}

/**
 * Which variable's editor is open, and what opening and closing one does.
 *
 * A variable added from a "+" opens straight away, and is "fresh" until its
 * editor closes: nothing can reference it yet, so its code name may still
 * follow the name it was given, which happens on close. The row is keyed by
 * that code name, so focus is put back on it once it has re-rendered.
 */
function useOpenVariable({
  tokens,
  onChange,
  currentTokens,
  onAdded,
}: {
  tokens: SiteTokenSet | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  onAdded: () => void;
}): {
  /** The panel's element, which rows are found in to be focused. */
  root: React.RefObject<HTMLDivElement | null>;
  openKey: string | null;
  toggle: (key: string, open: boolean) => void;
  add: (what: NewVariable) => void;
  forget: (key: string) => void;
} {
  const root = React.useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const fresh = React.useRef(new Set<string>());
  // Focus a row after its key changed under it (a just-added variable named
  // after its label) or after the editor closed onto a new row.
  React.useEffect(() => {
    if (focusKey === null) return;
    const row = root.current?.querySelector<HTMLElement>(
      `[data-variable-key="${CSS.escape(focusKey)}"]`
    );
    row?.focus();
    setFocusKey(null);
  }, [focusKey, tokens]);

  const add = (what: NewVariable): void => {
    const made = addVariable(currentTokens() ?? tokens, what);
    const added = made.tokens.tokens[made.at];
    if (added === undefined) return;
    onChange(made.tokens);
    onAdded();
    const key = tokenIdentity(added);
    fresh.current.add(key);
    setOpenKey(key);
  };

  const close = (key: string): void => {
    setOpenKey(null);
    if (!fresh.current.delete(key)) return;
    const named = namedAfterLabel(currentTokens(), key);
    if (named === undefined) return;
    onChange(named.tokens);
    setFocusKey(named.key);
  };

  const forget = (key: string): void => {
    fresh.current.delete(key);
    setOpenKey(null);
  };

  const toggle = (key: string, open: boolean): void => {
    if (open) setOpenKey(key);
    else close(key);
  };

  return { root, openKey, toggle, add, forget };
}

/**
 * A just-added variable given a code name made from the name the author gave
 * it, with the row key it now has; nothing when it has no name of its own or
 * the code name would not change.
 */
function namedAfterLabel(
  set: SiteTokenSet | undefined,
  key: string
): { tokens: SiteTokenSet; key: string } | undefined {
  if (set === undefined) return undefined;
  const at = set.tokens.findIndex(token => tokenIdentity(token) === key);
  const token = set.tokens[at];
  if (token?.label === undefined) return undefined;
  const named = labelNewVariable(set, at, token.label);
  const renamed = named.tokens[at];
  if (renamed === undefined || renamed.name === token.name) return undefined;
  return { tokens: named, key: tokenIdentity(renamed) };
}

/** The groups narrowed to a search; Other only when it has rows. */
function searched<
  G extends { group: VariableGroup; entries: readonly VariableEntry[] },
>(groups: readonly G[], needle: string): G[] {
  if (needle === "") {
    return groups.filter(
      group => group.group !== "other" || group.entries.length > 0
    );
  }
  return groups
    .map(group => ({
      ...group,
      entries: group.entries.filter(
        entry =>
          entry.label.toLowerCase().includes(needle) ||
          entry.row.name.toLowerCase().includes(needle)
      ),
    }))
    .filter(group => group.entries.length > 0);
}

/**
 * The preview switch: which mode's values the swatches and specimens show.
 * It changes nothing that is stored; each variable's editor shows both.
 */
function PreviewSwitch({
  mode,
  onMode,
}: {
  mode: TokenMode;
  onMode: (mode: TokenMode) => void;
}): React.JSX.Element {
  return (
    <div className="nx-vars__preview" role="group" aria-label="Preview">
      <span className="nx-vars__preview-label" aria-hidden="true">
        Preview
      </span>
      <div className="nx-vars__seg">
        {(["light", "dark"] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => onMode(candidate)}
          >
            {candidate === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What each group's "+" offers: one variable, or a short menu of kinds. */
const ADDS: Readonly<
  Record<
    VariableGroup,
    { label: string; empty: string; options: readonly [NewVariable, string][] }
  >
> = {
  colours: {
    label: "Add colour",
    empty: "No colours yet.",
    options: [["colour", "Colour"]],
  },
  type: {
    label: "Add type size",
    empty: "No type sizes yet.",
    options: [["type size", "Type size"]],
  },
  spacing: {
    label: "Add spacing, radius or shadow",
    empty: "No spacing, radii or shadows yet.",
    options: [
      ["spacing", "Spacing"],
      ["radius", "Radius"],
      ["shadow", "Shadow"],
    ],
  },
  other: {
    label: "Add another variable",
    empty: "",
    options: [
      ["dimension", "Size"],
      ["fontFamily", "Font"],
      ["fontWeight", "Font weight"],
      ["number", "Number"],
      ["duration", "Duration"],
      ["custom", "Custom value"],
    ],
  },
};

/** One group: its heading, its "+", and its rows, a page at a time. */
function Group({
  group,
  heading,
  entries,
  searching,
  readOnly,
  openKey,
  onAdd,
  children,
}: {
  group: VariableGroup;
  heading: string;
  entries: readonly VariableEntry[];
  searching: boolean;
  readOnly: boolean;
  /** The row whose editor is open, which is drawn even past the page. */
  openKey: string | null;
  onAdd: (what: NewVariable) => void;
  children: (entry: VariableEntry) => React.ReactNode;
}): React.JSX.Element {
  const id = React.useId();
  const [pages, setPages] = React.useState(1);
  const shown = withOpenRow(entries, pages * PAGE_SIZE, openKey);
  const hidden = entries.length - shown.length;
  const adds = ADDS[group];
  return (
    <section className="nx-vars__group" aria-labelledby={id}>
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id={id}>
          {heading}
        </h3>
        {/* The two small swatches on a colour row are its light and dark
            values; this names those columns for sight. Each row's accessible
            name already says which value is which, so it is not read. */}
        {group === "colours" ? (
          <span className="nx-vars__group-hint" aria-hidden="true">
            Light / Dark
          </span>
        ) : null}
        {/* An empty type scale offers its add in the line below instead. */}
        {readOnly || (group === "type" && entries.length === 0) ? null : (
          <AddButton adds={adds} onAdd={onAdd} />
        )}
      </div>
      {entries.length === 0 && !searching ? (
        <EmptyGroup
          group={group}
          text={adds.empty}
          readOnly={readOnly}
          onAdd={onAdd}
        />
      ) : (
        <ul className="nx-vars__list">{shown.map(children)}</ul>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          className="nx-vars__link"
          onClick={() => setPages(count => count + 1)}
        >
          {`Show ${String(Math.min(hidden, PAGE_SIZE))} more`}
        </button>
      ) : null}
    </section>
  );
}

/** An empty group's one line; an empty type scale offers its add here. */
function EmptyGroup({
  group,
  text,
  readOnly,
  onAdd,
}: {
  group: VariableGroup;
  text: string;
  readOnly: boolean;
  onAdd: (what: NewVariable) => void;
}): React.JSX.Element {
  return (
    <p className="nx-vars__empty">
      {text}
      {group === "type" && !readOnly ? (
        <button
          type="button"
          className="nx-vars__link"
          onClick={() => onAdd("type size")}
        >
          Add type size
        </button>
      ) : null}
    </p>
  );
}

/**
 * The rows a page shows, and the open row as well when it lies past them.
 *
 * A variable is added at the end of its group, so in a group longer than a
 * page its row would not mount and the editor opened for it would have
 * nothing to open beside. It is drawn on its own after the page rather than
 * by raising the page, which would mount every row before it.
 */
function withOpenRow(
  entries: readonly VariableEntry[],
  limit: number,
  openKey: string | null
): readonly VariableEntry[] {
  const page = entries.slice(0, limit);
  const at =
    openKey === null
      ? -1
      : entries.findIndex(entry => entry.row.key === openKey);
  const open = at >= limit ? entries[at] : undefined;
  return open === undefined ? page : [...page, open];
}

/** A group's "+": a button for one kind, a menu for several. */
function AddButton({
  adds,
  onAdd,
}: {
  adds: (typeof ADDS)[VariableGroup];
  onAdd: (what: NewVariable) => void;
}): React.JSX.Element {
  const icon = <Plus aria-hidden="true" size={14} />;
  const [only] = adds.options;
  if (adds.options.length === 1 && only !== undefined) {
    return (
      <button
        type="button"
        className="nx-vars__icon-button nx-vars__add"
        aria-label={adds.label}
        title={adds.label}
        onClick={() => onAdd(only[0])}
      >
        {icon}
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-vars__icon-button nx-vars__add"
          aria-label={adds.label}
          title={adds.label}
        >
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nx-vars__menu">
        {adds.options.map(([what, label]) => (
          <DropdownMenuItem key={what} onSelect={() => onAdd(what)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One variable: a button that opens its editor beside the panel.
 *
 * The button's name is the plain name followed by the values in words, so a
 * screen reader hears what the swatches show.
 */
function VariableRow({
  entry,
  tokens,
  mode,
  suppliedOf,
  readOnly,
  open,
  onOpenChange,
  onChange,
  onRemoved,
}: {
  entry: VariableEntry;
  tokens: SiteTokenSet;
  mode: TokenMode;
  suppliedOf: (identity: string) => SiteToken | undefined;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (tokens: SiteTokenSet) => void;
  onRemoved: () => void;
}): React.JSX.Element {
  const token = tokens.tokens[entry.row.at];
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-vars__row"
            data-variable-key={entry.row.key}
            // The visible name first, then the values the swatches show, so
            // a screen reader hears both and speech input still matches.
            aria-label={`${entry.label}${describe(entry, token, tokens)}`}
            data-kind={entry.row.kind}
          >
            <RowLead entry={entry} token={token} tokens={tokens} mode={mode} />
            <span className="nx-vars__name">{entry.label}</span>
            <RowTail entry={entry} token={token} tokens={tokens} mode={mode} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor"
          aria-label={`${readOnly ? "" : "Edit "}${entry.label}`}
        >
          <VariableEditor
            entry={entry}
            tokens={tokens}
            suppliedOf={suppliedOf}
            readOnly={readOnly}
            onChange={onChange}
            onRemoved={onRemoved}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
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
  if (kind === "color") {
    return (
      <span
        className="nx-vars__swatch nx-vars__swatch--main"
        aria-hidden="true"
        data-mode={mode}
        style={swatchStyle(
          entry.row.written
            ? colourHexOf(valueFor(token, mode), undefined)
            : undefined
        )}
      />
    );
  }
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
  const Icon = KIND_ICONS[kind];
  return (
    <span className="nx-vars__kind" aria-hidden="true">
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
  const match = /^(\d*\.?\d+)(px|rem)$/.exec(value.trim());
  const px =
    match === null ? 16 : Number(match[1]) * (match[2] === "rem" ? 16 : 1);
  return Math.min(18, Math.max(11, Math.round(10 + px * 0.2)));
}

/** The site's body font, when it names a family this panel can draw. */
function siteFamily(tokens: SiteTokenSet, mode: TokenMode): string | undefined {
  const body = tokens.tokens.find(token => token.name === "font.body");
  const family = valueFor(body, mode);
  return family === "" || /var\s*\(/i.test(family) ? undefined : family;
}

/** The row's trailing values: the light and dark swatches, or a value chip. */
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
  if (token === undefined) return null;
  if (entry.row.kind === "color") {
    return (
      <span className="nx-vars__pair" aria-hidden="true">
        <span
          className="nx-vars__swatch nx-vars__swatch--mode"
          data-mode="light"
          style={swatchStyle(colourHexOf(token.values.light, undefined))}
        />
        <span
          className="nx-vars__swatch nx-vars__swatch--mode"
          data-mode="dark"
          style={swatchStyle(
            colourHexOf(token.values.dark ?? token.values.light, undefined)
          )}
        />
      </span>
    );
  }
  return (
    <span className="nx-vars__chip" aria-hidden="true">
      {chipText(entry, token, mode)}
    </span>
  );
}

/** "16 / 26" for a type size with its line height, or the value itself. */
function chipText(
  entry: VariableEntry,
  token: SiteToken,
  mode: TokenMode
): string {
  const own = valueFor(token, mode);
  if (entry.lineHeight === undefined) return own;
  return `${bare(own)} / ${bare(entry.lineHeight.value)}`;
}

/** A px value without its unit, as designers write a type scale. */
function bare(value: string): string {
  return value.trim().replace(/^(-?\d*\.?\d+)px$/, "$1");
}

/** The row's values in words, for the button's accessible name. */
function describe(
  entry: VariableEntry,
  token: SiteToken | undefined,
  tokens: SiteTokenSet
): string {
  if (token === undefined) return "";
  if (entry.row.kind === "color") {
    const dark = token.values.dark;
    return `, light ${token.values.light}, dark ${dark ?? "same as light"}`;
  }
  if (entry.lineHeight !== undefined) {
    const line = tokens.tokens[entry.lineHeight.at]?.values.light ?? "";
    return `, size ${token.values.light}, line height ${line}`;
  }
  return `, ${token.values.light}`;
}

/** The supplied version of a variable, matched the way the merge does. */
function suppliedFor(
  supplied: SiteTokenSet | undefined,
  identity: string
): SiteToken | undefined {
  return (supplied?.tokens ?? []).find(
    token => tokenIdentity(token) === identity
  );
}
