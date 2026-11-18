"use client";

/**
 * The tokens studio: the Design panel's frame, which holds the variables an
 * author is editing and saves them as they are edited, and the Variables tab
 * that reads it. Also the hand-off from the Variables tab to the Shared styles
 * tab, which the studio holds because it surrounds every tab.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-tokens-studio
 */
import {
  resolveSiteTokens,
  tokenIdentity,
  type BlockDocument,
  type ComponentLookup,
  type DocumentLimits,
  type NamedClass,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  DESIGN_TAB_GROUPS,
  TokensPanel,
  type DesignTab,
  type TokensPanelProps,
  useVariablesHeader,
  variableMatchesByTab,
} from "@nextlyhq/builder/shell";
import { useCan } from "@nextlyhq/plugin-sdk/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  resolveSiteStyle,
  tokenOverrideOf,
  tokenSaveOutcome,
} from "../../site-style";
import {
  readSiteStyleRecord,
  tokensKeptAfterRefusal,
} from "../../site-style-record";
import { readStoredJson, sameStoredValue } from "../../stored-json";
import { withoutVariables } from "../../variables-without";
import { conflictWords } from "../conflict-words";
import { useHeldSiteStyle, useSaveSiteStyle } from "../site-style-client";
import { useShown } from "../use-shown";
import {
  cleanUpUnused,
  useVariablesClient,
  type CleanUpResult,
} from "../variables-client";

import { useDesignBrowse, useDesignHeaderSlot } from "./design-panel";
import { usedOnPage } from "./used-on-page";

/**
 * The tokens studio, and the state that belongs to it rather than to the editor.
 *
 * Its own component because the token set an author is part-way through editing
 * is the STUDIO's business: the editor around it owns a document, and a panel's
 * unsaved half-state living in that editor is state with no reader outside one
 * branch of one render.
 *
 * Saved as it is edited rather than behind a save button. A token is site-wide,
 * so the canvas behind this panel is the preview — an unsaved edit would show
 * the author a page no visitor would see, with no other surface on which to
 * notice the difference.
 *
 * Shown at once and stored once the author pauses: each edit is held for the
 * pause, so a run of edits is one write and one step of undo, and it is
 * written at once when a variable's editor closes, the Variables tab or this
 * panel goes away, or the page is saved.
 *
 * It is the Design panel's FRAME rather than its Variables tab, because the
 * panel's header belongs to every tab: the import-and-export menu is drawn
 * into it from here, and an import made from the Fonts tab writes through the
 * same edits the Variables tab shows. The tab reads the studio through
 * {@link VariablesTab}.
 */
export function TokensStudio({
  merged,
  supplied,
  pending,
  classes,
  opens,
  mode,
  children,
}: {
  /** The site's tokens as the canvas compiles them: config under stored. */
  merged: SiteTokenSet | undefined;
  /** What the site's own code supplies, which the stored tier layers over. */
  supplied: SiteTokenSet | undefined;
  /** Whether the read is still in flight, as against having failed. */
  pending: boolean;
  /**
   * The site's shared styles, so one using a variable says what it sets with
   * it. Absent while they are being read.
   */
  classes?: readonly NamedClass[];
  /** Where a shared style or a block look using a variable opens. */
  opens?: StyleOpeners;
  /**
   * The mode the editor draws the canvas in, which the swatches show too.
   * Absent, they show the mode the canvas draws by itself.
   */
  mode?: TokenMode;
  /** The Design panel's tabs. */
  children: React.ReactNode;
}): React.JSX.Element {
  const usage = useStudioUsage(classes, opens);
  const held = useReleasedOnLeave(useHeldSiteStyle());
  // The server refuses a change to the site style without this grant; the
  // panel shows the variables read-only rather than offering edits it would
  // refuse.
  const mayChange = useCan("update-site-style");
  const headerSlot = useDesignHeaderSlot();
  /*
   * What the CANVAS resolves, which is what the studio has to show and edit.
   *
   * `resolveSiteTokens` layers the engine's own defaults — `color.primary`,
   * `color.text`, `space.4` and the rest — under whatever the site states, and
   * the renderer compiles with it. Without that step here, the studio reports
   * every category empty on a site that states no tokens of its own, while the
   * page it is previewing is actively using them and the colour picker beside
   * it offers them. They could then be neither seen nor overridden: adding a
   * token and renaming it to a default's label does not reach one, because the
   * rename freezes the new token's own identity.
   *
   * The baseline for the override is resolved for the same reason. Storing what
   * differs from the CONFIG alone would write every engine default into the
   * database on the first edit — the same fault as saving the merged set, one
   * tier further down.
   */
  const { editable, baseline } = resolvedTiers(merged, supplied);
  const { edits, shownNow, issue, notice, commit, cleanUp } = useTokenCommits(
    baseline,
    editable,
    supplied
  );

  /*
   * The set as it is at the moment an import needs it, rather than the one
   * the panel last rendered with. `shown` is written before React is told
   * anything, so it answers for an edit the panel has not been re-rendered
   * with yet.
   */
  const currentTokens = (): SiteTokenSet | undefined => shownNow() ?? editable;
  const header = useVariablesHeader({
    onChange: commit,
    currentTokens,
    readOnly: !mayChange,
    ...(mode === undefined ? {} : { mode }),
  });
  useReportVariableMatches(edits ?? editable);
  const studio: TokensPanelProps = {
    tokens: edits ?? editable,
    supplied: baseline,
    issue,
    ...optionalNotice(notice),
    absence: absenceOf(pending),
    readOnly: !mayChange,
    onChange: commit,
    onActivity: held.extend,
    onSettle: () => void held.release(),
    currentTokens,
    header,
    ...usage.props,
    // "Clean up unused…", once what is held for the author's pause is
    // written, so the route judges the section as they left it.
    ...(mayChange
      ? {
          onCleanUp: async (ids: readonly string[]) => {
            await held.release();
            return cleanUp(ids, usage.props.usage.uses);
          },
        }
      : {}),
  };

  return (
    <VariablesStudio.Provider value={studio}>
      <InHeaderSlot slot={headerSlot}>{header.controls}</InHeaderSlot>
      {/* Above whichever tab is open, since an import or export can be
          started from any of them. */}
      <div className="nx-pb-design__reports">{header.overlays}</div>
      <SharedStyleToOpen.Provider value={usage.toOpen}>
        {children}
      </SharedStyleToOpen.Provider>
    </VariablesStudio.Provider>
  );
}

/**
 * The two tiers of variables the studio works with, both resolved as the
 * canvas resolves them (see {@link TokensStudio}): the set it shows and edits,
 * absent while the site style is unread, and the baseline its overrides are
 * stored against.
 */
function resolvedTiers(
  merged: SiteTokenSet | undefined,
  supplied: SiteTokenSet | undefined
): { editable: SiteTokenSet | undefined; baseline: SiteTokenSet } {
  return {
    editable: merged === undefined ? undefined : resolveSiteTokens(merged),
    baseline: resolveSiteTokens(supplied),
  };
}

/** The panel's conflict notice, as an optional prop: present only when said. */
function optionalNotice(
  notice: TokensPanelProps["notice"]
): Pick<TokensPanelProps, "notice"> {
  return notice === undefined ? {} : { notice };
}

/** `children` drawn into the Design header's slot, once the header has one. */
function InHeaderSlot({
  slot,
  children,
}: {
  slot: Element | null;
  children: React.ReactNode;
}): React.JSX.Element | null {
  return slot === null ? null : createPortal(children, slot);
}

/**
 * The studio's edits: what it shows, what the last save said, and the commit
 * every edit goes through.
 *
 * The studio's own latest set is the authority while it is open.
 * `useSiteStyle` answers from a query refetched only after a save lands, so
 * two edits made before that — two blurs, two removals, a double Add — would
 * both compose against the SAME snapshot and the second would overwrite the
 * first. Nothing would report it: the mutation serialises the payloads and
 * neither fails. Composing against this means every edit builds on the last.
 */
function useTokenCommits(
  baseline: SiteTokenSet,
  /** The set shown before any edit: what the first edit is made from. */
  editable: SiteTokenSet | undefined,
  /** The site's code tier, which a stored merge is shown over. */
  supplied: SiteTokenSet | undefined
): {
  edits: SiteTokenSet | null;
  shownNow: () => SiteTokenSet | null;
  issue: string | undefined;
  /** What the last save met of someone else's, with the way to read again. */
  notice: TokensPanelProps["notice"];
  commit: (next: SiteTokenSet) => void;
  /** "Clean up unused…": see {@link useCleanUp}. */
  cleanUp: CleanUpThrough;
} {
  const { save, reread, changeThrough } = useSaveSiteStyle();
  const [edits, show, shownNow] = useShown<SiteTokenSet | null>(null);
  const [issue, setIssue] = useState<string | undefined>(undefined);
  /*
   * The words for a save that was stored but met someone else's change to
   * the same variables. Cleared by the next edit and by Reload.
   */
  const [conflict, setConflict] = useState<string | undefined>(undefined);
  /*
   * The last set a save is KNOWN to have stored, and what a refused edit falls
   * back to — not "whatever was on screen before it", which after an earlier
   * refusal is itself a value the site never accepted.
   */
  const persisted = useRef<SiteTokenSet | null>(null);
  /* The most recent edit handed to a save, and the one question both branches
   * of an answer ask: is this still about what the author is looking at? */
  const latest = useRef<SiteTokenSet | null>(null);

  const commit = (next: SiteTokenSet): void => {
    /*
     * What this edit was made from, taken before it is shown: the set on
     * screen, as the stored tier holds it. The save is merged onto the
     * section as stored now from this base, so a token someone else saved
     * meanwhile is kept rather than dropped by a copy that never saw it.
     */
    const shownBefore = shownNow() ?? editable;
    show(next);
    setIssue(undefined);
    setConflict(undefined);
    send(next, shownBefore, { hold: true, keepIssue: false });
  };

  /*
   * Saves a set shown, and settles its answer. A refusal of the latest edit
   * takes back only the variables refused: the rest of the edit is shown
   * and saved again at once, and the reason stays said while it is.
   */
  const send = (
    next: SiteTokenSet,
    from: SiteTokenSet | undefined,
    how: { hold: boolean; keepIssue: boolean }
  ): void => {
    latest.current = next;
    const base =
      from === undefined ? undefined : tokenOverrideOf(baseline, from);
    /*
     * Only what DIFFERS from the site's own defaults. `merged` is what the
     * canvas compiles, so saving it whole would copy every config token into
     * the database on the first edit and mask the site's code from then on.
     */
    const sent = tokenOverrideOf(baseline, next);
    void save("tokens", sent, {
      hold: how.hold,
      ...(base === undefined ? {} : { base }),
    }).then(result => {
      const kept =
        result.saved || latest.current !== next
          ? undefined
          : // Judged against what is known stored: the last set a save
            // stored, or the set as loaded before any save here.
            partlyKept(next, persisted.current ?? editable ?? null);
      if (kept !== undefined) {
        show(kept);
        // Said as any refusal of the latest edit is said.
        const said = tokenSaveOutcome(
          false,
          result.issues,
          next,
          next,
          persisted.current
        ).issue;
        setIssue(said ?? undefined);
        send(kept, persisted.current ?? undefined, {
          hold: false,
          keepIssue: true,
        });
        return;
      }
      settleTokenSave(
        result,
        next,
        { latest, persisted },
        show,
        // A save of what a refusal kept leaves the refusal's reason said.
        how.keepIssue
          ? (issue: string | undefined) => {
              if (issue !== undefined) setIssue(issue);
            }
          : setIssue
      );
      adoptMergedTokens(
        result,
        sent,
        next,
        supplied,
        { latest, persisted },
        show
      );
      // Said whichever edit it answers: a true conflict is never silent.
      const words = result.saved
        ? conflictWords("tokens", result.conflicts)
        : undefined;
      if (words !== undefined) setConflict(words);
    });
  };
  /*
   * Reload: the studio's own copy is dropped, so it shows the read again,
   * and the read is asked for again, carrying both changes as stored.
   */
  const reload = (): void => {
    setConflict(undefined);
    latest.current = null;
    persisted.current = null;
    show(null);
    reread();
  };
  const notice =
    conflict === undefined ? undefined : { text: conflict, onReload: reload };
  const cleanUp = useCleanUp(changeThrough, reread, gone => {
    // What the studio shows, and knows stored, without what the route took.
    const kept = withoutColours(shownNow() ?? editable, gone);
    if (kept === undefined) return;
    latest.current = kept;
    persisted.current = kept;
    show(kept);
  });
  return { edits, shownNow, issue, notice, commit, cleanUp };
}

/** The studio's clean-up, handed the where-used read that names a kept one. */
type CleanUpThrough = (
  ids: readonly string[],
  uses: Parameters<typeof cleanUpUnused>[1]
) => Promise<CleanUpResult>;

/**
 * "Clean up unused…": the colours removed through the clean-up route, which
 * judges each on its own, as one step of the editor's history, whose halves
 * are the section before it and as the route left it. What went is taken out
 * of what the studio shows at once, and the site style read again.
 */
function useCleanUp(
  changeThrough: ReturnType<typeof useSaveSiteStyle>["changeThrough"],
  reread: () => void,
  taken: (gone: ReadonlySet<string>) => void
): CleanUpThrough {
  return async (ids, uses) => {
    let result: CleanUpResult | undefined;
    await changeThrough("tokens", async before => {
      result = await cleanUpUnused(ids, uses);
      const gone = removedBy(result);
      const section = readStoredJson(before);
      // Nothing removed, or nothing stored to remove it from: no step.
      if (gone.size === 0 || !isSection(section)) return undefined;
      return withoutVariables(section, gone);
    });
    const done = result ?? NOT_ASKED;
    const gone = removedBy(done);
    if (gone.size > 0) {
      taken(gone);
      reread();
    }
    return done;
  };
}

/** The answer of a clean-up the history never ran. */
const NOT_ASKED: CleanUpResult = {
  kind: "refused",
  reason: "The colours could not be removed. Try again.",
};

/** The identities a clean-up removed. */
function removedBy(result: CleanUpResult): ReadonlySet<string> {
  return new Set(result.kind === "done" ? result.removed : []);
}

/** Whether a stored section is one to take variables out of. */
function isSection(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The set without these colours, and without their places in the order. */
function withoutColours(
  set: SiteTokenSet | null | undefined,
  gone: ReadonlySet<string>
): SiteTokenSet | undefined {
  if (set === null || set === undefined) return undefined;
  return {
    ...set,
    tokens: set.tokens.filter(token => !gone.has(tokenIdentity(token))),
    ...(set.order === undefined
      ? {}
      : { order: set.order.filter(identity => !gone.has(identity)) }),
  };
}

/**
 * What the Variables tab is handed of usage: the variable routes, with the
 * way to a shared style using one, and the site's shared styles; and the
 * style the Shared styles tab is to open.
 */
function useStudioUsage(
  classes: readonly NamedClass[] | undefined,
  opens: StyleOpeners | undefined
): {
  props: Pick<TokensPanelProps, "usage" | "classes">;
  toOpen: StyleToOpen;
} {
  const opening = useSharedStyleOpening(opens?.sharedStyles);
  const usage = useVariablesClient(opening.open, useSteady(opens?.look));
  return {
    props: { usage, ...(classes === undefined ? {} : { classes }) },
    toOpen: opening.toOpen,
  };
}

/**
 * The shared style the Shared styles tab opens as it mounts, and taking it,
 * so a later visit to the tab opens none.
 */
interface StyleToOpen {
  readonly id: string | undefined;
  readonly taken: () => void;
}

/** No style to open, outside a studio. */
const NO_STYLE_TO_OPEN: StyleToOpen = { id: undefined, taken: () => {} };

/**
 * The style the Variables tab sent the author to, held by the studio, which
 * surrounds every tab: the Variables tab sets it and the Shared styles tab,
 * mounted when it is shown, takes it.
 */
const SharedStyleToOpen = createContext<StyleToOpen>(NO_STYLE_TO_OPEN);

/**
 * Where the Variables tab sends an author to a style using a variable: the
 * Shared styles tab for a shared style, and the inspector's look editor for
 * a block look, which the Shared styles tab does not list.
 */
export interface StyleOpeners {
  /** Show the Design panel's Shared styles tab. */
  readonly sharedStyles?: () => void;
  /** Edit a block look in the inspector. */
  readonly look?: (look: { id: string; blockType: string }) => void;
}

/**
 * The latest of a host's callbacks behind one identity, so a host handing a
 * new function each render does not change the Variables tab's access, by
 * which its reads are keyed; nothing when the host hands none.
 */
function useSteady<A>(
  callback: ((arg: A) => void) | undefined
): ((arg: A) => void) | undefined {
  const latest = useRef(callback);
  latest.current = callback;
  const given = callback !== undefined;
  return useMemo(
    () => (given ? (arg: A) => latest.current?.(arg) : undefined),
    [given]
  );
}

/**
 * Opening a shared style from the Variables tab: the style held, then the
 * Shared styles tab shown. Nothing to open without a way to show that tab.
 */
function useSharedStyleOpening(onShowSharedStyles: (() => void) | undefined): {
  open: ((classId: string) => void) | undefined;
  toOpen: StyleToOpen;
} {
  const [id, setId] = useState<string | undefined>(undefined);
  // The style held, then the tab shown, through the latest way to the tab.
  const open = useSteady(
    onShowSharedStyles === undefined
      ? undefined
      : (classId: string) => {
          setId(classId);
          onShowSharedStyles();
        }
  );
  const taken = useCallback(() => setId(undefined), []);
  const toOpen = useMemo(() => ({ id, taken }), [id, taken]);
  return { open, toOpen };
}

/**
 * What a refused edit keeps once only its refused variables are taken back,
 * or nothing when that is everything, and the set stored before stands.
 */
function partlyKept(
  refused: SiteTokenSet,
  persisted: SiteTokenSet | null
): SiteTokenSet | undefined {
  const kept = tokensKeptAfterRefusal(refused, persisted);
  return kept === null || kept === persisted ? undefined : kept;
}

/**
 * What a token save's answer does to the studio: the set it shows, the line
 * it says, and the last set known to be stored. `tokenSaveOutcome` decides;
 * this applies.
 */
function settleTokenSave(
  result: { saved: boolean; issues: Readonly<Record<string, string>> },
  next: SiteTokenSet,
  refs: {
    readonly latest: { current: SiteTokenSet | null };
    readonly persisted: { current: SiteTokenSet | null };
  },
  show: (tokens: SiteTokenSet | null) => void,
  setIssue: (issue: string | undefined) => void
): void {
  const outcome = tokenSaveOutcome(
    result.saved,
    result.issues,
    next,
    refs.latest.current,
    refs.persisted.current
  );
  if (result.saved) refs.persisted.current = next;
  if (outcome.tokens !== undefined) show(outcome.tokens);
  if (outcome.issue !== undefined) setIssue(outcome.issue ?? undefined);
}

/**
 * After a save merged onto a newer stored copy, the studio shows what was
 * stored: the author's edit with what someone else saved kept, so their
 * change appears and the next edit builds on it. Only for the latest edit,
 * and only where the merge stored something other than what was sent.
 */
function adoptMergedTokens(
  result: { readonly saved: boolean; readonly stored?: unknown },
  sent: SiteTokenSet,
  next: SiteTokenSet,
  supplied: SiteTokenSet | undefined,
  refs: {
    readonly latest: { current: SiteTokenSet | null };
    readonly persisted: { current: SiteTokenSet | null };
  },
  show: (tokens: SiteTokenSet | null) => void
): void {
  if (!result.saved || result.stored === undefined) return;
  if (refs.latest.current !== next || sameStoredValue(result.stored, sent)) {
    return;
  }
  const adopted = tokensFromStored(supplied, result.stored);
  refs.latest.current = adopted;
  refs.persisted.current = adopted;
  show(adopted);
}

/**
 * A stored token section as the studio shows it: read as the editor reads
 * the document, over the site's code and the engine's defaults.
 */
function tokensFromStored(
  supplied: SiteTokenSet | undefined,
  stored: unknown
): SiteTokenSet {
  return resolveSiteTokens(
    resolveSiteStyle(
      supplied === undefined ? {} : { tokens: supplied },
      readSiteStyleRecord({ tokens: stored })
    ).tokens
  );
}

/**
 * The held site-style writes, written when the panel goes away: whatever an
 * edit left waiting is stored, an import made from another tab included.
 */
function useReleasedOnLeave<H extends { release: () => Promise<void> }>(
  held: H
): H {
  const release = useRef(held.release);
  release.current = held.release;
  useEffect(() => () => void release.current(), []);
  return held;
}

/** Why the studio has no variables to show: a read in flight, or one that failed. */
function absenceOf(pending: boolean): "pending" | "failed" {
  return pending ? "pending" : "failed";
}

/** The tokens studio's state, for the Variables tab inside it. */
const VariablesStudio = createContext<TokensPanelProps | null>(null);

/**
 * The studio's state, for a tab drawn inside its frame that edits the same
 * variables: `null` outside one.
 */
export function useVariablesStudio(): TokensPanelProps | null {
  return useContext(VariablesStudio);
}

/** The Variables tab: the studio's variables, in the panel its frame holds. */
export function VariablesTab({
  tab,
  usedOnPage,
}: {
  /** The Design tab this is: its groups are the ones listed. */
  tab: Exclude<DesignTab, "styles">;
  /** The variables the open page uses, for "Used on this page". */
  usedOnPage?: ReadonlySet<string>;
}): React.JSX.Element | null {
  const studio = useContext(VariablesStudio);
  const { search, searchRef, folds } = useDesignBrowse();
  return studio === null ? null : (
    <TokensPanel
      {...studio}
      groups={DESIGN_TAB_GROUPS[tab]}
      search={search}
      searchRef={searchRef}
      {...(folds === undefined ? {} : { folds })}
      {...(usedOnPage === undefined ? {} : { usedOnPage })}
    />
  );
}

/** No components, for a region that reaches none. */
const NO_COMPONENTS: ComponentLookup = new Map();

/**
 * The Colours tab, with what the open page and the components it places use,
 * read from the editor's document so it follows an edit before any save.
 */
export function ColoursTab({
  document,
  components,
  regions,
  limits,
}: {
  document: BlockDocument;
  components: ComponentLookup;
  /** The header and footer drawn around the page, each with its components. */
  regions: readonly {
    readonly document: BlockDocument;
    readonly definitions?: ComponentLookup;
  }[];
  limits: DocumentLimits;
}): React.JSX.Element | null {
  const studio = useContext(VariablesStudio);
  const tokens = studio?.tokens;
  const classes = studio?.classes;
  const used = useMemo(
    () =>
      usedOnPage(
        [
          { document, components },
          ...regions.map(region => ({
            document: region.document,
            components: region.definitions ?? NO_COMPONENTS,
          })),
        ],
        limits,
        tokens,
        classes
      ),
    [document, components, regions, limits, tokens, classes]
  );
  return <VariablesTab tab="colours" usedOnPage={used} />;
}

/**
 * How many variables the panel's search matches in each tab, reported to
 * the panel for the counts beside its tab names, whichever tab is open: the
 * studio holds the variables for all of them.
 */
function useReportVariableMatches(tokens: SiteTokenSet | undefined): void {
  const { search, reportMatches } = useDesignBrowse();
  const matches = useMemo(
    () => variableMatchesByTab(tokens, search),
    [tokens, search]
  );
  useEffect(() => {
    reportMatches(matches);
  }, [matches, reportMatches]);
}

/**
 * The style the tab opens as it mounts, sent from the Variables tab, read
 * once and then taken from the studio, so the tab chosen again later opens
 * on its list.
 *
 * The Design search is cleared for the trip: kept from the tab the author
 * came from, it matched the variable, and could hide the style they were
 * sent to.
 */
export function useStyleToOpen(): string | undefined {
  const toOpen = useContext(SharedStyleToOpen);
  const [initial] = useState(toOpen.id);
  const { taken } = toOpen;
  const { setSearch } = useDesignBrowse();
  useEffect(() => {
    if (initial === undefined) return;
    setSearch("");
    taken();
  }, [initial, taken, setSearch]);
  return initial;
}
