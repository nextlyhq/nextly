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
 * panel's own header, beside its title, and stay there whichever of its tabs
 * is open. A host that draws that header holds them with
 * {@link useVariablesHeader} and hands the result in as `header`; this view
 * then takes its preview mode from it and draws no controls of its own.
 * Without one, the view holds them itself: drawn into `headerActions` when
 * the host gives that element, else at the top of this view.
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
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
  type SpacingMode,
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
  SquareRoundCorner,
  Timer,
  Type,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { ShowMore, withOpenRow } from "./panel-actions";
import { useCanvasTokenModeAt } from "./prefers-dark";
import { SpacingModeChoice } from "./spacing-mode-choice";
import { colourHexOf, colourPairOf } from "./style-colour";
import { lengthInPx, variableValueText } from "./style-variables";
import {
  addVariable,
  labelNewVariable,
  lengthFamilyOf,
  variableGroups,
  type NewVariable,
  type VariableEntry,
  type VariableGroup,
} from "./tokens-studio";
import { VariableEditor } from "./variable-editor";
import { ColourPair, swatchStyle } from "./variable-swatch";
import {
  combinedReach,
  variableCount,
  type VariableReach,
  type VariablesAccess,
} from "./variable-usage";
import {
  CountTip,
  useVariableUsage,
  VariableRowCount,
  type VariableUsageHere,
} from "./variable-usage-view";
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
   * The author is still at work here: typing in a field before it commits.
   * For a host that waits for a pause before persisting, so a save is not
   * made between one field's edit and the next.
   */
  onActivity?: () => void;
  /**
   * The author is done for now: a variable's editor closed, or this panel
   * went away. A host waiting for a pause persists what it holds at once.
   */
  onSettle?: () => void;
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
  /**
   * Which mode the preview opens on.
   *
   * - `true`: Dark, whatever the device prefers.
   * - `false`: Light, whatever the device prefers.
   * - omitted: the mode the canvas draws, followed live: the page's own
   *   theme marker where it states one, else the device's scheme.
   *
   * Either way the author can switch it afterwards.
   */
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
  /**
   * The header a host draws for the whole Design panel, from
   * {@link useVariablesHeader}. Given, the view previews its mode and leaves
   * the controls, and what an import or export reports, to the host.
   */
  header?: VariablesHeader;
  /**
   * The site's spacing model, shown as "Space between blocks" above the
   * spacing variables. Absent, the choice is not drawn.
   */
  spacing?: SpacingModeControl;
  /**
   * How widely each variable is used, read through the host: a count at the
   * end of each row, and Remove refusing in place while a variable is used.
   * Absent: no counts, and Remove confirms as it always has.
   *
   * @experimental Settles with the Variables tab's usage.
   */
  usage?: VariablesAccess;
  /**
   * The site's shared styles, so a shared style using a variable says what
   * it sets with it ("sets text colour"). Absent: it says it uses it.
   *
   * @experimental Settles with the Variables tab's usage.
   */
  classes?: readonly NamedClass[];
}

/** The site's spacing model as the Variables view offers it. */
export interface SpacingModeControl {
  /** The model as it is now. */
  readonly mode: SpacingMode;
  /** A new model. The host saves it, as it saves an edit. */
  readonly onChange: (mode: SpacingMode) => void;
}

/** The Design panel's header controls, and the preview mode they choose. */
export interface VariablesHeader {
  /** Which mode's values the swatches and specimens show. */
  readonly mode: TokenMode;
  /** The preview switch and the import-and-export menu. */
  readonly controls: React.JSX.Element;
  /** What an import or an export reports, and the import's preview. */
  readonly overlays: React.JSX.Element;
}

/**
 * The preview mode held by a host rather than by the header, for a host that
 * draws its canvas in the mode the author picks too, so the switch and the
 * canvas cannot disagree.
 */
export interface VariablesPreview {
  /**
   * The mode the author picked, or `null` while nothing is picked and the
   * switch shows the mode the canvas draws by itself.
   */
  readonly picked: TokenMode | null;
  /** The author picked a mode on the switch. */
  readonly onPick: (mode: TokenMode) => void;
}

/**
 * The header controls and their state, for a host that keeps them while the
 * Design panel's tabs change under them: the preview mode, the switch that
 * chooses it, and the import-and-export menu with what it reports.
 *
 * `prefersDark` is as {@link TokensPanelProps.prefersDark} reads it. Given
 * `preview`, the host holds the picked mode and `prefersDark` is not read;
 * without it, the header holds the mode itself.
 */
export function useVariablesHeader({
  onChange,
  currentTokens,
  readOnly,
  prefersDark,
  preview,
}: {
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  readOnly: boolean;
  prefersDark?: boolean;
  preview?: VariablesPreview;
}): VariablesHeader {
  /*
   * Until a mode is picked, the one the canvas actually draws: the marker on
   * the page it shows, which a site's own page may state, else the device's
   * scheme. The bare device setting would name the wrong mode on a page that
   * states its own.
   */
  const drawn = useCanvasTokenModeAt(null);
  const [own, setOwn] = React.useState<TokenMode | null>(() =>
    statedPreview(prefersDark)
  );
  const picked = preview === undefined ? own : preview.picked;
  const mode: TokenMode = picked ?? drawn;
  const transfer = useVariablesTransfer({ onChange, currentTokens, readOnly });
  return {
    mode,
    controls: (
      <div className="nx-vars__controls">
        <PreviewSwitch
          mode={mode}
          onMode={preview === undefined ? setOwn : preview.onPick}
        />
        {transfer.menu}
      </div>
    ),
    overlays: transfer.overlays,
  };
}

/** How many rows of one group mount before the author asks for more. */
const PAGE_SIZE = 50;

export function TokensPanel(props: TokensPanelProps): React.JSX.Element {
  const { header } = props;
  if (header !== undefined) {
    return <VariablesView {...props} header={header} placed={false} />;
  }
  return <OwnHeader {...props} />;
}

/** The view holding its header itself, where no host draws one. */
function OwnHeader(props: TokensPanelProps): React.JSX.Element {
  const header = useVariablesHeader({
    onChange: props.onChange,
    currentTokens: props.currentTokens,
    readOnly: props.readOnly ?? false,
    ...(props.prefersDark === undefined
      ? {}
      : { prefersDark: props.prefersDark }),
  });
  return <VariablesView {...props} header={header} placed />;
}

function VariablesView({
  tokens,
  onChange,
  onActivity,
  onSettle,
  currentTokens,
  supplied,
  issue,
  absence = "pending",
  readOnly = false,
  headerActions,
  header,
  placed,
  spacing,
  ...hosted
}: TokensPanelProps & {
  header: VariablesHeader;
  /** Whether this view draws the header's controls and reports itself. */
  placed: boolean;
}): React.JSX.Element {
  const { mode } = header;
  const [query, setQuery] = React.useState("");
  const { root, openKey, toggle, add, forget, commitFrom } = useOpenVariable({
    tokens,
    onChange,
    currentTokens,
    onAdded: () => setQuery(""),
    onSettle,
  });
  const search = React.useRef<HTMLInputElement>(null);

  const groups = React.useMemo(
    () => (tokens === undefined ? [] : variableGroups(tokens, mode)),
    [tokens, mode]
  );
  const needle = query.trim().toLowerCase();
  const shown = searched(groups, needle);
  const usage = useUsageOfRows(hosted, groups, issue);

  if (tokens === undefined) {
    return <Unread absence={absence} />;
  }

  return (
    // Typing anywhere in the panel, the editors beside the rows included
    // (React carries their events here through the portal), is activity.
    <div
      className="nx-vars"
      ref={root}
      data-read-only={readOnly ? "" : undefined}
      onInput={onActivity}
    >
      {placed ? (
        <HeaderControls slot={headerActions}>{header.controls}</HeaderControls>
      ) : null}
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
        {placed ? header.overlays : null}
        <VariableGroups
          shown={shown}
          searching={needle !== ""}
          spacing={spacing}
          onAdd={add}
          rows={{
            tokens,
            mode,
            readOnly,
            openKey,
            suppliedOf: identity => suppliedFor(supplied, identity),
            toggle,
            commitFrom,
            usage,
            onRemoved: key => {
              forget(key);
              search.current?.focus();
            },
          }}
        />
      </div>
    </div>
  );
}

/** What every row of the view is drawn from, and what its editor reports to. */
interface RowsHost {
  readonly tokens: SiteTokenSet;
  readonly mode: TokenMode;
  readonly readOnly: boolean;
  /** The row whose editor is open. */
  readonly openKey: string | null;
  readonly suppliedOf: (identity: string) => SiteToken | undefined;
  readonly toggle: (key: string, open: boolean) => void;
  readonly commitFrom: (key: string) => (next: SiteTokenSet) => void;
  /** Usage, where the host reads it. */
  readonly usage: VariableUsageHere | undefined;
  /** The variable whose row this is was removed. */
  readonly onRemoved: (key: string) => void;
}

/** The groups a search leaves, each under its spacing choice, or that none match. */
function VariableGroups({
  shown,
  searching,
  spacing,
  onAdd,
  rows,
}: {
  shown: readonly {
    readonly group: VariableGroup;
    readonly heading: string;
    readonly entries: readonly VariableEntry[];
  }[];
  searching: boolean;
  spacing: SpacingModeControl | undefined;
  onAdd: (what: NewVariable) => void;
  rows: RowsHost;
}): React.JSX.Element {
  if (shown.length === 0) {
    return <p className="nx-vars__note">No variables match this search.</p>;
  }
  return (
    <>
      {shown.map(group => (
        <React.Fragment key={group.group}>
          <SpacingModeAbove
            group={group.group}
            spacing={spacing}
            readOnly={rows.readOnly}
          />
          <Group
            group={group.group}
            heading={group.heading}
            entries={group.entries}
            searching={searching}
            readOnly={rows.readOnly}
            openKey={rows.openKey}
            onAdd={onAdd}
          >
            {(entry: VariableEntry) => (
              <VariableRow
                key={entry.row.key}
                entry={entry}
                tokens={rows.tokens}
                mode={rows.mode}
                suppliedOf={rows.suppliedOf}
                readOnly={rows.readOnly}
                open={rows.openKey === entry.row.key}
                onOpenChange={open => rows.toggle(entry.row.key, open)}
                onChange={rows.commitFrom(entry.row.key)}
                usage={rows.usage}
                onRemoved={() => rows.onRemoved(entry.row.key)}
              />
            )}
          </Group>
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * Each editor's commit, settling where the author's work has already ended,
 * and a settle when the view goes away.
 *
 * Going away ends the author's work here as closing an editor does: a tab
 * change or the panel closing. An edit committed by an editor that is
 * already closed, such as a colour picker writing what it held as it
 * unmounts, comes after the settle its closing made, so it settles again
 * rather than wait for a pause the author has already ended.
 */
function useCommitsSettled(
  onChange: (tokens: SiteTokenSet) => void,
  onSettle: (() => void) | undefined,
  openKey: string | null
): (key: string) => (next: SiteTokenSet) => void {
  // The latest callback, so the effect runs only on unmount rather than on
  // every render that hands a new one.
  const settle = React.useRef(onSettle);
  settle.current = onSettle;
  // Which editor is open as of the latest render, and whether the panel is
  // still mounted: read when an editor commits, which it may do as it goes
  // away, after the close or the unmount has already settled.
  const openNow = React.useRef(openKey);
  openNow.current = openKey;
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      settle.current?.();
    };
  }, []);
  return key => next => {
    onChange(next);
    if (!mounted.current || openNow.current !== key) settle.current?.();
  };
}

/**
 * How widely every variable listed is used, read once for all the groups:
 * each row's variable and, for a type size, its line height, which has no
 * row of its own and is removed from here or nowhere; and what the rows and
 * their editors are handed of it. Nothing without the host's access.
 *
 * A save refused (`issue` coming to say why) is read as a sign the counts
 * are behind: a removal the server refused because the variable is in use,
 * which these counts called unused. Every listed variable is read again,
 * since the panel cannot tell which ones the refused save dropped, so the
 * next Remove says why it waits rather than confirming again.
 */
function useUsageOfRows(
  {
    usage: access,
    classes,
  }: {
    readonly usage?: VariablesAccess | undefined;
    readonly classes?: readonly NamedClass[] | undefined;
  },
  groups: readonly { readonly entries: readonly VariableEntry[] }[],
  issue: string | undefined
): VariableUsageHere | undefined {
  const identities = React.useMemo(
    () => groups.flatMap(group => group.entries.flatMap(rowIdentities)),
    [groups]
  );
  const reads = useVariableUsage(access, identities);
  const { values, counter, reread, readAgain } = reads;
  // The identities as of the latest render, read when a refusal arrives
  // rather than closed over, so the effect follows the issue alone.
  const listed = React.useRef(identities);
  listed.current = identities;
  React.useEffect(() => {
    // A fresh list each time: the same list again would be no new state,
    // and a second refusal would read nothing.
    if (issue !== undefined) reread([...listed.current]);
  }, [issue, reread]);
  return React.useMemo(
    () =>
      access === undefined
        ? undefined
        : {
            reachOf: id => values.get(id),
            readAgain,
            access,
            counter,
            classes,
          },
    [access, values, readAgain, counter, classes]
  );
}

/** The variables a row stands for: its own, and a type size's line height. */
function rowIdentities(entry: VariableEntry): string[] {
  return entry.lineHeight === undefined
    ? [entry.row.identity]
    : [entry.row.identity, entry.lineHeight.identity];
}

/** A row's count: every variable it stands for, together. */
function rowReach(
  entry: VariableEntry,
  usage: VariableUsageHere | undefined
): VariableReach | undefined {
  if (usage === undefined) return undefined;
  return combinedReach(rowIdentities(entry).map(usage.reachOf));
}

/**
 * "Space between blocks", drawn above the spacing variables (the model they
 * space by), and nothing above any other group or when the host offers no
 * choice.
 */
function SpacingModeAbove({
  group,
  spacing,
  readOnly,
}: {
  group: VariableGroup;
  spacing: SpacingModeControl | undefined;
  readOnly: boolean;
}): React.JSX.Element | null {
  if (group !== "spacing" || spacing === undefined) return null;
  return (
    <SpacingModeChoice
      mode={spacing.mode}
      onChange={spacing.onChange}
      readOnly={readOnly}
    />
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
 * Which variable's editor is open, what opening and closing one does, and
 * each editor's commit, which settles once the editor has closed.
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
  onSettle,
}: {
  tokens: SiteTokenSet | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  onAdded: () => void;
  /** The author is done with a variable; see `TokensPanelProps.onSettle`. */
  onSettle: (() => void) | undefined;
}): {
  /** The panel's element, which rows are found in to be focused. */
  root: React.RefObject<HTMLDivElement | null>;
  openKey: string | null;
  toggle: (key: string, open: boolean) => void;
  add: (what: NewVariable) => void;
  forget: (key: string) => void;
  /** Each row editor's commit; see {@link useCommitsSettled}. */
  commitFrom: (key: string) => (next: SiteTokenSet) => void;
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
    // Settled after the renaming below, so a just-added variable's code name
    // is part of what is persisted with the rest of its edit.
    if (fresh.current.delete(key)) {
      const named = namedAfterLabel(currentTokens(), key);
      if (named !== undefined) {
        onChange(named.tokens);
        setFocusKey(named.key);
      }
    }
    onSettle?.();
  };

  const forget = (key: string): void => {
    fresh.current.delete(key);
    setOpenKey(null);
    onSettle?.();
  };

  const toggle = (key: string, open: boolean): void => {
    if (open) setOpenKey(key);
    else close(key);
  };

  const commitFrom = useCommitsSettled(onChange, onSettle, openKey);
  return { root, openKey, toggle, add, forget, commitFrom };
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
 * The mode a host asked the preview to open on, or `null` to follow the
 * device: `false` is an explicit choice of light, not an absence.
 */
function statedPreview(prefersDark: boolean | undefined): TokenMode | null {
  if (prefersDark === undefined) return null;
  return prefersDark ? "dark" : "light";
}

/**
 * The preview switch: which mode's values the swatches and specimens show,
 * and, where the host holds the mode (see {@link VariablesPreview}), the mode
 * the canvas draws the page in as well. It changes nothing that is stored, so
 * a published page is untouched; each variable's editor shows both values.
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
  // A variable is added at the end of its group, so in a group longer than a
  // page its row would not mount and the editor opened for it would have
  // nothing to open beside.
  const shown = withOpenRow(
    entries,
    pages * PAGE_SIZE,
    entry => entry.row.key === openKey
  );
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
      <ShowMore
        hidden={hidden}
        pageSize={PAGE_SIZE}
        onMore={() => setPages(count => count + 1)}
      />
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
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
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
  usage,
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
  /** How widely it is used, where the host reads it. */
  usage: VariableUsageHere | undefined;
}): React.JSX.Element {
  const token = tokens.tokens[entry.row.at];
  const reach = rowReach(entry, usage);
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <CountTip reach={reach}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-vars__row"
              data-variable-key={entry.row.key}
              // The visible name first, then the values the swatches show, so
              // a screen reader hears both and speech input still matches.
              aria-label={`${shownName(entry)}${describe(entry, token, tokens, mode)}${countWords(reach)}`}
              data-kind={entry.row.kind}
              // A fourth column for the count, only where usage is read.
              data-counted={usage === undefined ? undefined : ""}
              // Drawn as chosen while its editor is open. Its own mark: the
              // row's tooltip sets `data-state` too, over the popover's.
              data-open={open ? "" : undefined}
            >
              <RowLead
                entry={entry}
                token={token}
                tokens={tokens}
                mode={mode}
              />
              <span className="nx-vars__name">
                {entry.label}
                {entry.kindWord === undefined ? null : (
                  <span className="nx-vars__name-kind">{` · ${entry.kindWord}`}</span>
                )}
              </span>
              <RowTail
                entry={entry}
                token={token}
                tokens={tokens}
                mode={mode}
              />
              <VariableRowCount reach={reach} />
            </button>
          </PopoverTrigger>
        </CountTip>
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
            {...(usage === undefined ? {} : { usage })}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

/** The row's count in words, after its name and values, once it is read. */
function countWords(reach: VariableReach | undefined): string {
  return reach === undefined ? "" : `. ${variableCount(reach).words}`;
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
    return <ColourPair {...colourPairOf(token)} />;
  }
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

/** The supplied version of a variable, matched the way the merge does. */
function suppliedFor(
  supplied: SiteTokenSet | undefined,
  identity: string
): SiteToken | undefined {
  return (supplied?.tokens ?? []).find(
    token => tokenIdentity(token) === identity
  );
}
