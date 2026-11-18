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
 * The import-and-export menu belongs in the Design panel's own header,
 * beside its title, and stays there whichever of its tabs is open. A host
 * that draws that header holds it with {@link useVariablesHeader} and hands
 * the result in as `header`; this view then takes its mode from it and draws
 * no controls of its own. Without one, the view holds them itself: drawn into
 * `headerActions` when the host gives that element, else at the top of this
 * view.
 *
 * ## The mode shown is the canvas's
 *
 * Swatches and specimens show the values of the mode the canvas is drawn in.
 * The panel has no light and dark switch of its own: the host that draws the
 * canvas offers the preview (the editor's, in its top bar) and hands the mode
 * in, so the panel and the canvas never show different modes.
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
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  BuiltInColoursSetting,
  builtInColoursShown,
  useHiddenReadAgain,
} from "./built-in-colours";
import { useCanvasTokenModeAt } from "./canvas/prefers-dark";
import { ColourCleanUp, type CleanUpColours } from "./colour-cleanup";
import {
  ColourGroupHead,
  ColourGroupHostContext,
  NewGroupButton,
  useColourGroupDrop,
  useColourGroupHost,
} from "./colour-group-ui";
import { colourGroups, inColourGroup } from "./colour-groups";
import { hiddenColours } from "./colour-usage";
import { useColourFilter } from "./colour-usage-filter";
import {
  GroupToggle,
  OwnSearch,
  ViewBody,
  markOf,
  useListedGroups,
  useViewSearch,
} from "./design-group-toggle";
import { commitFocusedField } from "./editor-field-commit";
import { FluidRangeFields } from "./fluid-popover";
import { ShowMore, withOpenRow } from "./panel-actions";
import { SiteTextSection } from "./site-text-panel";
import {
  addVariable,
  duplicateVariable,
  fluidRangeOf,
  setFluidRange,
  labelNewVariable,
  searchVariableGroups,
  type VariableEntry,
  type VariableGroup,
} from "./tokens-studio";
import { ADDS, AddRows, EmptyGroup, type OnAdd } from "./variable-adds";
import { VariableRow } from "./variable-row";
import {
  combinedReach,
  usageState,
  type VariableReach,
  type VariablesAccess,
} from "./variable-usage";
import {
  useVariableUsage,
  type VariableUsageHere,
} from "./variable-usage-view";
import { useVariablesTransfer } from "./variables-transfer";

/** A save's note to the author, and the way to read the variables again. */
export interface TokensPanelNotice {
  readonly text: string;
  readonly onReload: () => void;
}

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
   * What the last save has to tell the author although it was stored: that
   * it met someone else's change to the same variables. Drawn beside
   * `issue` as a status rather than an alert, since nothing failed, with a
   * Reload that reads the variables again and drops the host's own copy.
   * The host clears it on the next edit and on Reload.
   */
  notice?: TokensPanelNotice;
  /**
   * Which mode's values the swatches and specimens show, for a view that
   * holds its header itself.
   *
   * - `true`: Dark, whatever the device prefers.
   * - `false`: Light, whatever the device prefers.
   * - omitted: the mode the canvas draws, followed live: the page's own
   *   theme marker where it states one, else the device's scheme.
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
  /**
   * The variable groups this view lists, in this order: one Design tab's.
   * Absent: every group.
   */
  groups?: readonly VariableGroup[];
  /**
   * A search the host keeps across several views, as the Design panel keeps
   * one across its tabs. Given, this view lists what it matches and draws no
   * search box of its own.
   */
  search?: string;
  /** The host's search field, where focus goes once a variable is removed. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  /** Which groups are folded, and the way to fold one. Absent: none fold. */
  folds?: GroupFolds;
  /**
   * The variables the open page and its components use, by identity, for
   * the Colours tab's "Used on this page"; read by the host from the
   * editor's document, so it follows unsaved edits. Absent: none.
   */
  usedOnPage?: ReadonlySet<string>;
  /**
   * Remove the colours the site made that nothing uses, each judged on its
   * own: "Clean up unused…" under the Colours tab's filter. Absent: not
   * offered.
   *
   * @experimental Settles with the Colours tab's clean-up.
   */
  onCleanUp?: CleanUpColours;
}

/**
 * Which of the Design panel's groups the author folded, by group id, and
 * the way to fold or open one. The host keeps it, so a group stays folded
 * for that author across reloads.
 */
export interface GroupFolds {
  readonly folded: ReadonlySet<string>;
  readonly onFold: (group: string, folded: boolean) => void;
}

/** The Design panel's header controls, and the mode its views show. */
export interface VariablesHeader {
  /** Which mode's values the swatches and specimens show. */
  readonly mode: TokenMode;
  /** The import-and-export menu. */
  readonly controls: React.JSX.Element;
  /** What an import or an export reports, and the import's preview. */
  readonly overlays: React.JSX.Element;
}

/**
 * The header controls and their state, for a host that keeps them while the
 * Design panel's tabs change under them: the mode its views show, and the
 * import-and-export menu with what it reports.
 *
 * The mode is the host's `mode` where it hands one in: the mode it draws its
 * canvas in, so the swatches show what the canvas shows. Without one,
 * `prefersDark` as {@link TokensPanelProps.prefersDark} reads it, else the
 * mode the canvas draws by itself.
 */
export function useVariablesHeader({
  onChange,
  currentTokens,
  readOnly,
  prefersDark,
  mode: hosted,
}: {
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  readOnly: boolean;
  prefersDark?: boolean;
  mode?: TokenMode;
}): VariablesHeader {
  /*
   * Without a host's mode, the one the canvas actually draws: the marker on
   * the page it shows, which a site's own page may state, else the device's
   * scheme. The bare device setting would name the wrong mode on a page that
   * states its own.
   */
  const drawn = useCanvasTokenModeAt(null);
  const mode: TokenMode = hosted ?? statedMode(prefersDark) ?? drawn;
  const transfer = useVariablesTransfer({ onChange, currentTokens, readOnly });
  return {
    mode,
    controls: <div className="nx-vars__controls">{transfer.menu}</div>,
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
  ...hosted
}: TokensPanelProps & {
  header: VariablesHeader;
  /** Whether this view draws the header's controls and reports itself. */
  placed: boolean;
}): React.JSX.Element {
  const { mode } = header;
  const { query, needle, searching, setQuery, own } = useViewSearch(
    hosted.search
  );
  const {
    root,
    openKey,
    fresh,
    toggle,
    add,
    duplicate,
    forget,
    commitFrom,
    focus,
  } = useOpenVariable({ tokens, onChange, currentTokens, onSettle });
  const ownSearch = React.useRef<HTMLInputElement>(null);
  // Where focus goes once a variable is removed: the host's search where it
  // keeps one, else the view's own.
  const search = hosted.searchRef ?? ownSearch;

  const groups = useListedGroups(tokens, mode, hosted.groups);
  // A row just added stays shown while its editor is open, though the
  // search would hide it: added where the author is, it is not lost.
  const { shown: matched, held } = searched(groups, needle, fresh);
  const usage = useUsageOfRows(hosted, groups, issue);
  // The built-in colours the site hides, while it does: none otherwise.
  const builtInsShown = builtInColoursShown(tokens);
  const builtIn = (identity: string): boolean =>
    suppliedFor(supplied, identity) !== undefined;
  const colours = colourIdentities(groups);
  const hidden = hiddenColours(colours, {
    shown: builtInsShown,
    stateOf: identity => usageState(usage?.reachOf(identity)),
    builtIn,
    onPage: hosted.usedOnPage,
  });
  useHiddenReadAgain(
    builtInsShown,
    tokens,
    colours.filter(builtIn),
    usage?.readAgain
  );
  // The Colours tab's usage filter, over what the search matched.
  const colourFilter = useColourFilter({
    shown: matched,
    tokens,
    usage,
    usedOnPage: hosted.usedOnPage,
    openKey,
    hidden,
  });
  const { shown } = colourFilter;

  if (tokens === undefined) {
    return <Unread absence={absence} />;
  }

  return (
    // Typing anywhere in the panel, the editors beside the rows included
    // (React carries their events here through the portal), is activity.
    <div
      className="nx-vars"
      ref={root}
      data-read-only={markOf(readOnly)}
      onInput={onActivity}
    >
      <PlacedControls placed={placed} slot={headerActions} header={header} />
      <OwnSearch ref={ownSearch} shown={own} query={query} onQuery={setQuery} />
      <ViewBody
        adds={
          <HiddenGroupAdds
            groups={groups}
            searching={searching}
            readOnly={readOnly}
            folds={hosted.folds}
            onAdd={add}
          />
        }
        notes={
          <PanelNotes
            readOnly={readOnly}
            issue={issue}
            notice={hosted.notice}
          />
        }
        overlays={placedOverlays(placed, header)}
      >
        <TypeTabSiteText
          groups={hosted.groups}
          tokens={tokens}
          onChange={onChange}
          readOnly={readOnly}
          mode={mode}
          supplied={supplied?.siteText}
        />
        <TypeTabRange
          groups={hosted.groups}
          tokens={tokens}
          onChange={onChange}
          readOnly={readOnly}
        />
        {colourFilter.control}
        <ColourCleanUp
          groups={groups}
          tokens={tokens}
          usage={usage}
          usedOnPage={hosted.usedOnPage}
          builtIn={identity => suppliedFor(supplied, identity) !== undefined}
          readOnly={readOnly}
          onCleanUp={hosted.onCleanUp}
        />
        <VariableGroups
          shown={shown}
          searching={searching}
          folds={hosted.folds}
          onAdd={add}
          rows={rowsHostOf({
            tokens,
            mode,
            readOnly,
            openKey,
            supplied,
            toggle,
            commitFrom,
            duplicate,
            usage,
            held,
            fresh,
            forget,
            search,
            focus,
            hidden,
            marksBuiltIn: !builtInsShown,
          })}
        />
        {/* The Colours tab ends with the site's built-in colours setting. */}
        {groups.some(group => group.group === "colours") ? (
          <BuiltInColoursSetting
            tokens={tokens}
            readOnly={readOnly}
            onChange={commitFrom(BUILT_IN_COLOURS_KEY)}
          />
        ) : null}
      </ViewBody>
    </div>
  );
}

/**
 * The site's text, first where the view lists the type scale: what every
 * page's headings, body text, links, buttons and captions look like.
 */
function TypeTabSiteText({
  groups,
  ...section
}: React.ComponentProps<typeof SiteTextSection> & {
  groups: readonly VariableGroup[] | undefined;
}): React.JSX.Element | null {
  if (groups !== undefined && !groups.includes("type")) return null;
  return <SiteTextSection {...section} />;
}

/**
 * The site's fluid range, where the view lists the type scale: the Type
 * tab, or a view of every group. Changing it remakes every size made with
 * "Fluid…", in the same edit, so it saves and undoes as one.
 */
function TypeTabRange({
  groups,
  tokens,
  onChange,
  readOnly,
}: {
  groups: readonly VariableGroup[] | undefined;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
}): React.JSX.Element | null {
  if (groups !== undefined && !groups.includes("type")) return null;
  return (
    <FluidRangeFields
      range={fluidRangeOf(tokens)}
      onRange={range => onChange(setFluidRange(tokens, range))}
      readOnly={readOnly}
    />
  );
}

/** What an import or export reported, drawn by the view placed to draw it. */
function placedOverlays(
  placed: boolean,
  header: VariablesHeader
): React.JSX.Element | undefined {
  return placed ? header.overlays : undefined;
}

/** The header's controls, drawn by the view that is placed to draw them. */
function PlacedControls({
  placed,
  slot,
  header,
}: {
  placed: boolean;
  slot: HTMLElement | null | undefined;
  header: VariablesHeader;
}): React.JSX.Element | null {
  return placed ? (
    <HeaderControls slot={slot}>{header.controls}</HeaderControls>
  ) : null;
}

/**
 * What the view's rows are drawn from: the view's state, with a variable
 * removed putting focus back on the search, the place a removed row's
 * focus has to go.
 */
function rowsHostOf({
  supplied,
  forget,
  search,
  ...rows
}: Omit<RowsHost, "suppliedOf" | "onRemoved"> & {
  supplied: SiteTokenSet | undefined;
  forget: (key: string) => void;
  search: React.RefObject<HTMLInputElement | null>;
}): RowsHost {
  return {
    ...rows,
    suppliedOf: identity => suppliedFor(supplied, identity),
    onRemoved: key => {
      forget(key);
      // After the removed row's editor has closed: closing hands focus back
      // to its trigger, which went with the row, and would leave it nowhere.
      window.setTimeout(() => search.current?.focus(), 0);
    },
  };
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
  /** Adds a copy of a row's variable right below it, and opens it. */
  readonly duplicate: (entry: VariableEntry) => void;
  /** The new row a search would hide, shown marked "New" meanwhile. */
  readonly held: string | null;
  /** The row just added or copied, never saved, while its editor is open. */
  readonly fresh: string | null;
  /** Focuses a row once it is drawn, wherever it is drawn now. */
  readonly focus: (key: string) => void;
  /** The built-in colours the site hides, left out with any group they empty. */
  readonly hidden: ReadonlySet<string>;
  /** Whether a built-in colour's row says so: while the site hides the rest. */
  readonly marksBuiltIn: boolean;
}

/** The groups a search leaves, or that none match. */
function VariableGroups({
  shown,
  searching,
  folds,
  onAdd,
  rows,
}: {
  shown: readonly {
    readonly group: VariableGroup;
    readonly heading: string;
    readonly entries: readonly VariableEntry[];
  }[];
  searching: boolean;
  folds: GroupFolds | undefined;
  onAdd: OnAddTo;
  rows: RowsHost;
}): React.JSX.Element {
  const colours = useColourGroupHost(
    rows.tokens,
    rows.readOnly,
    rows.commitFrom(COLOUR_GROUPS_KEY)
  );
  if (shown.length === 0) {
    return <p className="nx-vars__note">No variables match this search.</p>;
  }
  return (
    <ColourGroupHostContext.Provider
      value={{
        ...colours,
        onMoved: (row, next) => movedInto(row, next, folds, rows.focus),
      }}
    >
      {shown
        .flatMap(group =>
          sectionsOf(
            group,
            rows.tokens,
            searching,
            colours.pending,
            rows.hidden
          )
        )
        .map(section => (
          <React.Fragment key={section.key}>
            <Group
              group={section.group}
              heading={section.heading}
              entries={section.entries}
              searching={searching}
              folds={folds}
              readOnly={rows.readOnly}
              openKey={rows.openKey}
              onAdd={onAdd}
              named={section.named}
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
                  onDuplicate={() => rows.duplicate(entry)}
                  fresh={
                    rows.fresh === entry.row.key
                      ? { marked: rows.held === entry.row.key }
                      : undefined
                  }
                  usage={rows.usage}
                  reach={rowReach(entry, rows.usage)}
                  builtIn={
                    rows.marksBuiltIn &&
                    rows.suppliedOf(entry.row.identity) !== undefined
                  }
                  onRemoved={() => rows.onRemoved(entry.row.key)}
                />
              )}
            </Group>
          </React.Fragment>
        ))}
    </ColourGroupHostContext.Provider>
  );
}

/**
 * After a colour row moved: moved into another group it is drawn there anew,
 * so that group is opened and the row keeps the focus.
 */
function movedInto(
  row: { readonly key: string; readonly identity: string },
  next: SiteTokenSet,
  folds: GroupFolds | undefined,
  focus: (key: string) => void
): void {
  const into = colourGroups(next).find(group =>
    group.identities.includes(row.identity)
  );
  if (into !== undefined) openFold(folds, colourGroupFoldKey(into.name));
  focus(row.key);
}

/** What the Colours tab's group changes commit under: no row's editor. */
const COLOUR_GROUPS_KEY = "colour-groups";

/** What the built-in colours setting commits under: no row's editor. */
const BUILT_IN_COLOURS_KEY = "built-in-colours";

/** An add, with the named group of colours whose list its add row ends. */
type OnAddTo = (
  what: Parameters<OnAdd>[0],
  from: Parameters<OnAdd>[1],
  group?: string
) => void;

/** One section of the list: a group, or one named group of colours. */
interface ListSection {
  readonly key: string;
  readonly group: VariableGroup;
  readonly heading: string;
  readonly entries: readonly VariableEntry[];
  readonly named?: { readonly name: string; readonly last: boolean };
}

/**
 * The sections a group is listed in: the Colours group as its named groups,
 * in the site's order, each holding its own colours; any other group whole.
 * A search lists only the named groups it matches in.
 */
function sectionsOf(
  group: {
    readonly group: VariableGroup;
    readonly heading: string;
    readonly entries: readonly VariableEntry[];
  },
  tokens: SiteTokenSet,
  searching: boolean,
  /** Groups made with "+ New group" that hold no colour yet. */
  pending: readonly string[] = [],
  /** The built-in colours the site hides: a group of only these is left out. */
  hidden: ReadonlySet<string> = new Set()
): ListSection[] {
  const whole: ListSection = { ...group, key: group.group };
  if (group.group !== "colours" || group.entries.length === 0) return [whole];
  const byIdentity = new Map(
    group.entries.map(entry => [entry.row.identity, entry])
  );
  const named = colourGroups(tokens)
    .map(colourGroup => ({
      name: colourGroup.name,
      identities: colourGroup.identities,
      entries: colourGroup.identities.flatMap(identity => {
        const entry = byIdentity.get(identity);
        return entry === undefined ? [] : [entry];
      }),
    }))
    .filter(colourGroup => !searching || colourGroup.entries.length > 0)
    .filter(
      colourGroup =>
        colourGroup.identities.length === 0 ||
        !colourGroup.identities.every(identity => hidden.has(identity))
    )
    .concat(
      searching
        ? []
        : pending.map(name => ({ name, identities: [], entries: [] }))
    );
  return named.map((colourGroup, at) => ({
    key: colourGroupFoldKey(colourGroup.name),
    group: group.group,
    heading: colourGroup.name,
    entries: colourGroup.entries,
    named: { name: colourGroup.name, last: at === named.length - 1 },
  }));
}

/** What a named group with no colour in it says. */
const NEW_GROUP_EMPTY = "Drag a colour here, or use Move to group…";

/** A named group's heading with its name field and ⋯; any other as it is. */
function ColourGroupHeadIf({
  name,
  children,
}: {
  name: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  if (name === undefined) return <>{children}</>;
  return <ColourGroupHead name={name}>{children}</ColourGroupHead>;
}

/** What a named group of colours keeps its fold under. */
function colourGroupFoldKey(name: string): string {
  return `colour-group:${name}`;
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
  const { values, reread, readAgain } = reads;
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
            classes,
          },
    [access, values, readAgain, classes]
  );
}

/** The identities of the colours the view lists. */
function colourIdentities(
  groups: readonly {
    readonly group: VariableGroup;
    readonly entries: readonly VariableEntry[];
  }[]
): string[] {
  return groups
    .filter(group => group.group === "colours")
    .flatMap(group => group.entries.map(entry => entry.row.identity));
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

/** The read-only line, a save that failed, and a save that met another. */
function PanelNotes({
  readOnly,
  issue,
  notice,
}: {
  readOnly: boolean;
  issue: string | undefined;
  notice: TokensPanelNotice | undefined;
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
      {notice === undefined ? null : (
        // A status, not an alert: the save was stored, and this says what
        // it met on the way.
        <div className="nx-vars__notice" role="status">
          <p className="nx-vars__notice-text">{notice.text}</p>
          <Button
            className="nx-vars__notice-reload"
            onClick={notice.onReload}
            size="sm"
            type="button"
            variant="outline"
          >
            Reload
          </Button>
        </div>
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
  onSettle,
}: {
  tokens: SiteTokenSet | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  /** The author is done with a variable; see `TokensPanelProps.onSettle`. */
  onSettle: (() => void) | undefined;
}): {
  /** The panel's element, which rows are found in to be focused. */
  root: React.RefObject<HTMLDivElement | null>;
  openKey: string | null;
  /** The row just added, while its editor is open; a search keeps it. */
  fresh: string | null;
  toggle: (key: string, open: boolean) => void;
  add: OnAddTo;
  duplicate: (entry: VariableEntry) => void;
  forget: (key: string) => void;
  /** Each row editor's commit; see {@link useCommitsSettled}. */
  commitFrom: (key: string) => (next: SiteTokenSet) => void;
  /** Focuses a row once it is drawn, as after a move to another group. */
  focus: (key: string) => void;
} {
  const root = React.useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const fresh = React.useRef(new Set<string>());
  const [freshOpen, setFreshOpen] = React.useState<string | null>(null);
  // What was pressed to add a variable: where focus goes back to when the
  // new row is not drawn once its editor closes, as under a search it does
  // not match.
  const origin = React.useRef<HTMLElement | null>(null);
  // Focus a row after its key changed under it (a just-added variable named
  // after its label) or after the editor closed onto a new row.
  React.useEffect(() => {
    if (focusKey === null) return;
    const find = (): HTMLElement | null | undefined =>
      root.current?.querySelector<HTMLElement>(
        `[data-variable-key="${CSS.escape(focusKey)}"]`
      );
    const row = find();
    if (row) {
      row.focus();
      // A row drawn anew, as one moved into another group is, has its button
      // replaced once just after it mounts, as its editor's anchor registers.
      // Focus follows the new one, unless it has gone elsewhere since.
      window.setTimeout(() => {
        const owner = row.ownerDocument;
        if (row.isConnected || owner.activeElement !== owner.body) return;
        find()?.focus();
      }, 0);
    } else if (origin.current?.isConnected === true) origin.current.focus();
    setFocusKey(null);
  }, [focusKey, tokens]);

  // A variable just added is brought into view before its editor is placed
  // beside it: added at the end of a long list, it would otherwise open its
  // editor below the window, far from the "+" pressed.
  React.useLayoutEffect(() => {
    if (openKey === null || !fresh.current.has(openKey)) return;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-variable-key="${CSS.escape(openKey)}"]`
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [openKey, tokens]);

  // A variable just made, new or a copy, opens; its code name follows its
  // name until the editor closes.
  const opened = (made: { tokens: SiteTokenSet; at: number }): void => {
    const added = made.tokens.tokens[made.at];
    if (added === undefined) return;
    onChange(made.tokens);
    const key = tokenIdentity(added);
    fresh.current.add(key);
    setFreshOpen(key);
    setOpenKey(key);
  };

  // The search is kept: the new row is added where the author is, in the
  // named group of colours its add row ends.
  const add: OnAddTo = (what, from, group) => {
    origin.current = from;
    const made = addVariable(currentTokens() ?? tokens, what);
    opened({ ...made, tokens: inColourGroup(made.tokens, made.at, group) });
  };

  const duplicate = (entry: VariableEntry): void => {
    const set = currentTokens() ?? tokens;
    if (set === undefined) return;
    origin.current = null;
    opened(duplicateVariable(set, entry.row.at, entry.label));
  };

  const close = (key: string): void => {
    // A field still being typed in commits first, as leaving it does: a
    // click outside closes the editor before the field's own blur, and the
    // name typed there would otherwise miss the code name made below.
    commitFocusedField(root.current?.ownerDocument);
    setOpenKey(null);
    setFreshOpen(null);
    // Settled after the renaming below, so a just-added variable's code name
    // is part of what is persisted with the rest of its edit.
    if (fresh.current.delete(key)) {
      const named = namedAfterLabel(currentTokens(), key);
      if (named !== undefined) onChange(named.tokens);
      // Its row once drawn again, or what added it where a search hides it.
      setFocusKey(named?.key ?? key);
    }
    onSettle?.();
  };

  const forget = (key: string): void => {
    fresh.current.delete(key);
    setOpenKey(null);
    setFreshOpen(null);
    onSettle?.();
  };

  const toggle = (key: string, open: boolean): void => {
    if (open) setOpenKey(key);
    else close(key);
  };

  const commitFrom = useCommitsSettled(onChange, onSettle, openKey);
  return {
    root,
    openKey,
    fresh: freshOpen,
    toggle,
    add,
    duplicate,
    forget,
    commitFrom,
    focus: setFocusKey,
  };
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

/**
 * The adds of the groups hidden while they hold nothing, as a worded line at
 * the end of the view: hidden, their own "+" would go with them, and the
 * first variable of such a group could not be made.
 */
function HiddenGroupAdds({
  groups,
  searching,
  readOnly,
  folds,
  onAdd,
}: {
  groups: readonly { group: VariableGroup; entries: readonly unknown[] }[];
  searching: boolean;
  readOnly: boolean;
  folds: GroupFolds | undefined;
  onAdd: OnAdd;
}): React.JSX.Element | null {
  const hidden = groups.filter(
    group => SHOWN_WHEN_FILLED.has(group.group) && group.entries.length === 0
  );
  if (readOnly || searching || hidden.length === 0) return null;
  return (
    <div className="nx-vars__hidden-adds">
      {hidden.map(group => (
        <AddRows
          key={group.group}
          group={group.group}
          onAdd={(what, from) => {
            openFold(folds, group.group);
            onAdd(what, from);
          }}
        />
      ))}
    </div>
  );
}

/**
 * Opens a group the author folded, for a variable about to be added to it,
 * so its row and editor are drawn: the stored fold, which a search only
 * sets aside and would bring back once the add clears it.
 */
function openFold(folds: GroupFolds | undefined, group: string): void {
  if (folds?.folded.has(group) === true) folds.onFold(group, false);
}

/** The groups that list only what they hold, hidden while they hold none. */
const SHOWN_WHEN_FILLED: ReadonlySet<VariableGroup> = new Set<VariableGroup>([
  "fonts",
  "content",
  "other",
]);

/**
 * The groups narrowed to a search, through the one search rule; with no
 * search, "Fonts and weights" and "Other values" only when they have rows.
 * The row `kept` is listed at the end of its group whatever the search, so
 * a variable just added stays in view while its editor is open; `held` is
 * that row when the search alone would have hidden it, so it is marked
 * "New". One search decides both, so the row kept and the row marked never
 * disagree.
 */
function searched<
  G extends { group: VariableGroup; entries: readonly VariableEntry[] },
>(
  groups: readonly G[],
  needle: string,
  kept: string | null
): { shown: G[]; held: string | null } {
  if (needle === "") {
    return {
      shown: groups.filter(
        group => !SHOWN_WHEN_FILLED.has(group.group) || group.entries.length > 0
      ),
      held: null,
    };
  }
  const found = searchVariableGroups(groups, needle);
  if (kept === null) return { shown: found, held: null };
  let held: string | null = null;
  const shown = groups.flatMap(group => {
    const hit = found.find(candidate => candidate.group === group.group);
    const keep = group.entries.find(entry => entry.row.key === kept);
    if (keep === undefined || hit?.entries.includes(keep) === true) {
      return hit === undefined ? [] : [hit];
    }
    held = kept;
    return [{ ...group, entries: [...(hit?.entries ?? []), keep] }];
  });
  return { shown, held };
}

/**
 * The mode a host asked the view to show, or `null` to follow the canvas:
 * `false` is an explicit choice of light, not an absence.
 */
function statedMode(prefersDark: boolean | undefined): TokenMode | null {
  if (prefersDark === undefined) return null;
  return prefersDark ? "dark" : "light";
}

/** One group: its heading, its "+", and its rows, a page at a time. */
function Group({
  group,
  heading,
  entries,
  searching,
  folds,
  readOnly,
  openKey,
  onAdd,
  named,
  children,
}: {
  group: VariableGroup;
  heading: string;
  /**
   * A named group of colours within the Colours group: its name, which keys
   * its fold, and whether it ends the list and so holds the add row.
   */
  named?: { readonly name: string; readonly last: boolean } | undefined;
  entries: readonly VariableEntry[];
  searching: boolean;
  /** Present: the heading folds the group, and shows how many it holds. */
  folds: GroupFolds | undefined;
  readOnly: boolean;
  /** The row whose editor is open, which is drawn even past the page. */
  openKey: string | null;
  onAdd: OnAddTo;
  children: (entry: VariableEntry) => React.ReactNode;
}): React.JSX.Element {
  const id = React.useId();
  // A search opens every group it matches in and folds none; the folds come
  // back as they were once it is cleared.
  const { foldKey, folded } = foldOf(group, named, folds, searching);
  return (
    <section
      className="nx-vars__group"
      aria-labelledby={id}
      // Which group this is, for a host bringing one into view.
      data-group={group}
      data-colour-group={named?.name}
      data-folded={folded ? "" : undefined}
    >
      <GroupHead
        id={id}
        name={named?.name}
        foldKey={foldKey}
        heading={heading}
        count={entries.length}
        folds={folds}
        folded={folded}
        searching={searching}
      />
      {folded ? null : (
        <GroupRows
          entries={entries}
          empty={named === undefined ? ADDS[group].empty : NEW_GROUP_EMPTY}
          searching={searching}
          openKey={openKey}
        >
          {children}
        </GroupRows>
      )}
      {readOnly || folded ? null : (
        <GroupEnd
          group={group}
          named={named}
          onAdd={(what, from) => {
            openFold(folds, foldKey);
            onAdd(what, from, named?.name);
          }}
        />
      )}
    </section>
  );
}

/**
 * What a group's fold is kept under, and whether it is folded: a search
 * opens every group it matches in and folds none, and the folds come back
 * as they were once it is cleared.
 */
function foldOf(
  group: VariableGroup,
  named: { readonly name: string } | undefined,
  folds: GroupFolds | undefined,
  searching: boolean
): { foldKey: string; folded: boolean } {
  const foldKey = named === undefined ? group : colourGroupFoldKey(named.name);
  return {
    foldKey,
    folded: folds !== undefined && !searching && folds.folded.has(foldKey),
  };
}

/**
 * A group's heading: its name, folding where the group folds; a named group
 * of colours with its name field, its ⋯ and a drop for a dragged colour.
 */
function GroupHead({
  id,
  name,
  foldKey,
  heading,
  count,
  folds,
  folded,
  searching,
}: {
  id: string;
  /** A named group of colours' name. */
  name: string | undefined;
  foldKey: string;
  heading: string;
  count: number;
  folds: GroupFolds | undefined;
  folded: boolean;
  searching: boolean;
}): React.JSX.Element {
  // A colour dropped on a named group's heading goes to its end.
  const dropOnHead = useColourGroupDrop(name ?? "");
  return (
    <div
      className="nx-vars__group-head"
      {...(name === undefined ? {} : dropOnHead)}
    >
      <ColourGroupHeadIf name={name}>
        <h3 className="nx-vars__group-name" id={id}>
          <GroupHeading
            group={foldKey}
            heading={heading}
            count={count}
            folds={folds}
            folded={folded}
            searching={searching}
          />
        </h3>
      </ColourGroupHeadIf>
    </div>
  );
}

/**
 * What ends an open group's list, so a new row is added where it is: its
 * add row, and under the last named group of colours, "+ New group". A named
 * group before the last ends with neither.
 */
function GroupEnd({
  group,
  named,
  onAdd,
}: {
  group: VariableGroup;
  named: { readonly name: string; readonly last: boolean } | undefined;
  onAdd: OnAdd;
}): React.JSX.Element | null {
  if (named?.last === false) return null;
  return (
    <>
      <AddRows group={group} onAdd={onAdd} />
      {named === undefined ? null : <NewGroupButton />}
    </>
  );
}

/** A group's name, or, where the group folds, the button that folds it. */
function GroupHeading({
  group,
  heading,
  count,
  folds,
  folded,
  searching,
}: {
  /** What the group's fold is kept under. */
  group: string;
  heading: string;
  count: number;
  folds: GroupFolds | undefined;
  folded: boolean;
  searching: boolean;
}): React.JSX.Element {
  if (folds === undefined) return <>{heading}</>;
  return (
    <GroupToggle
      heading={heading}
      count={count}
      open={!folded}
      onToggle={searching ? undefined : () => folds.onFold(group, !folded)}
    />
  );
}

/** An open group's rows, a page at a time, or its one empty line. */
function GroupRows({
  entries,
  empty,
  searching,
  openKey,
  children,
}: {
  entries: readonly VariableEntry[];
  /** What an empty group says. */
  empty: string;
  searching: boolean;
  openKey: string | null;
  children: (entry: VariableEntry) => React.ReactNode;
}): React.JSX.Element {
  const [pages, setPages] = React.useState(1);
  // A variable is added at the end of its group, so in a group longer than a
  // page its row would not mount and the editor opened for it would have
  // nothing to open beside.
  const shown = withOpenRow(
    entries,
    pages * PAGE_SIZE,
    entry => entry.row.key === openKey
  );
  return (
    <>
      {entries.length === 0 && !searching ? (
        <EmptyGroup text={empty} />
      ) : (
        <ul className="nx-vars__list">{shown.map(children)}</ul>
      )}
      <ShowMore
        hidden={entries.length - shown.length}
        pageSize={PAGE_SIZE}
        onMore={() => setPages(count => count + 1)}
      />
    </>
  );
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
