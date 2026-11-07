"use client";

/**
 * The editor's writers of the site style: the tokens studio, the class
 * surface, the fonts panel's upload and the breakpoints writer, with the
 * readings of the stored style each of them offers from.
 *
 * Kept apart from the editor component because each owns state or a write
 * queue of its own, and none of it is about the document being edited.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-studios
 */
import {
  resolveSiteTokens,
  validateFontFace,
  type BreakpointSet,
  type FontFaceDef,
  type NamedClass,
  type SiteTokenSet,
  type SpacingMode,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import {
  authoredBreakpoints,
  FontsPanel,
  SharedStylesPanel,
  sharedStyleNameTaken,
  TokensPanel,
  withoutFamily,
  type ClassRenameOutcome,
  type SharedStyleChange,
  type FontCatalogue,
  type FontFaceUpload,
  type FontsPanelProps,
  type PageClassBlocks,
  type SiteFamily,
  type TokensPanelProps,
  type VariablesPreview,
  useVariablesHeader,
} from "@nextlyhq/builder/shell";
import {
  usePluginClientConfig,
  useUploadMedia,
  WEB_FONT_FORMATS,
} from "@nextlyhq/plugin-sdk/admin";
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

import { catalogueFileUrl } from "../../site-fonts/contract";
import {
  classOverrideOf,
  resolveSiteStyle,
  tokenOverrideOf,
  tokenSaveOutcome,
  type SiteStyleData,
} from "../../site-style";
import { readSiteStyleRecord } from "../../site-style-record";
import { sameStoredValue } from "../../stored-json";
import { conflictWords } from "../conflict-words";
import { useSharedStylesClient } from "../shared-styles-client";
import {
  useFontCatalogueClient,
  useHeldSiteStyle,
  useSaveSiteStyle,
  useSaveSpacingMode,
  type SiteStyleReplayed,
} from "../site-style-client";
import { useShown } from "../use-shown";
import { useVariablesClient } from "../variables-client";

import { rebasedOnCode } from "./class-override-rebase";
import { toastSaveConflicts } from "./conflict-toast";
import { useDesignHeaderSlot } from "./design-panel";
import { StyleRevisionContext } from "./site-style-history";
import { PLUGIN_SOURCE } from "./stored-document";

/**
 * The faces the site loads, or `undefined` while that is not yet known.
 *
 * The same third state `offerableTokens` keeps, and for the same reason: a site
 * that self-hosts nothing legitimately has no faces, so a surface cannot tell
 * "none stored" from "the read has not come back" by looking at the value. The
 * fonts panel draws those two differently, and would otherwise report a site
 * mid-load as one loading no fonts at all.
 *
 * Unlike tokens there are no engine defaults to layer underneath — a font file
 * is something a site provides or does not — so the resolved list is returned
 * as it stands, including an empty one.
 */
export function offerableFaces(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): readonly FontFaceDef[] | undefined {
  if (pending || error !== null) return undefined;
  return style?.fonts ?? [];
}

/**
 * The tokens as the PAGE renders them, defaults included.
 *
 * Deliberately not `offerableTokens`. A studio edits what the site AUTHORED —
 * showing the engine's defaults as rows an author can rename would offer edits
 * that write nothing — while a report on what the page draws has to read what
 * the page draws. `resolveSiteTokens` layers the engine's own underneath, and
 * one of them is `font.body: system-ui`, a real typeface every site renders
 * with. Reading the authored set had the panel announce "no typeface tokens"
 * for a site whose every page was using one.
 */
export function renderedTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  return resolveSiteTokens(style?.tokens);
}

/**
 * The tokens an inspector may offer, or `undefined` while the site's own tier
 * is still unknown.
 *
 * Withheld on exactly the two states that hold the CANVAS back, and for the
 * same reason. Until the stored read answers, the merged value is the config
 * defaults alone — a real design rather than a placeholder — so a picker fed
 * from it offers a token by a name and a colour the site may have overridden,
 * and the identity an author chooses then resolves to something else on the
 * published page. The error path matters as much as the pending one: `pending`
 * is false there while the value has still fallen back to defaults.
 *
 * `undefined` rather than an empty set, because the control reads absence as
 * "the question was never asked" and offers no picker at all — which is the
 * truth here, and is different from a site that defines no tokens.
 */
export function offerableTokens(
  style: SiteStyleData | undefined,
  pending: boolean,
  error: unknown
): SiteTokenSet | undefined {
  if (pending || error !== null) return undefined;
  // A SET even when the site defines nothing, because the renderer compiles
  // with `resolveSiteTokens`, which layers the engine's own defaults underneath.
  // A site with no tokens of its own still emits `color.text`, `color.primary`
  // and the rest, so handing over `undefined` here would have the picker offer
  // none of them — and `undefined` already means something else to the control:
  // that the question was never asked.
  return style?.tokens ?? { tokens: [] };
}

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
 * panel's header belongs to every tab: the preview switch and the
 * import-and-export menu are drawn into it from here, and an import made from
 * the Fonts tab writes through the same edits the Variables tab shows. The tab
 * reads the studio through {@link VariablesTab}.
 */
export function TokensStudio({
  merged,
  supplied,
  pending,
  spacingMode,
  classes,
  opens,
  preview,
  children,
}: {
  /** The site's tokens as the canvas compiles them: config under stored. */
  merged: SiteTokenSet | undefined;
  /**
   * The site's spacing model as the canvas compiles under it, or `undefined`
   * while the style has not been read, when the choice is not offered.
   */
  spacingMode?: SpacingMode;
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
   * The preview mode the editor holds, which it draws the canvas in too, so
   * the header's switch previews the canvas as well as the swatches. Absent,
   * the switch keeps its mode itself and previews the swatches alone.
   */
  preview?: VariablesPreview;
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
  const editable = merged === undefined ? undefined : resolveSiteTokens(merged);
  const baseline = resolveSiteTokens(supplied);
  const { edits, shownNow, issue, setIssue, notice, commit } = useTokenCommits(
    baseline,
    editable,
    supplied
  );
  // The spacing choice reports a refusal on the same line an edit does.
  const spacing = useSpacingModeChoice(spacingMode, setIssue);

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
    preview,
  });
  const studio: TokensPanelProps = {
    tokens: edits ?? editable,
    supplied: baseline,
    issue,
    ...(notice === undefined ? {} : { notice }),
    absence: absenceOf(pending),
    readOnly: !mayChange,
    onChange: commit,
    onActivity: held.extend,
    onSettle: () => void held.release(),
    currentTokens,
    header,
    ...usage.props,
    ...spacing,
  };

  return (
    <VariablesStudio.Provider value={studio}>
      {headerSlot === null ? null : createPortal(header.controls, headerSlot)}
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
  setIssue: (issue: string | undefined) => void;
  /** What the last save met of someone else's, with the way to read again. */
  notice: TokensPanelProps["notice"];
  commit: (next: SiteTokenSet) => void;
} {
  const { save, reread } = useSaveSiteStyle();
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
    const base =
      shownBefore === undefined
        ? undefined
        : tokenOverrideOf(baseline, shownBefore);
    show(next);
    setIssue(undefined);
    setConflict(undefined);
    latest.current = next;
    /*
     * Only what DIFFERS from the site's own defaults. `merged` is what the
     * canvas compiles, so saving it whole would copy every config token into
     * the database on the first edit and mask the site's code from then on.
     */
    const sent = tokenOverrideOf(baseline, next);
    void save("tokens", sent, {
      hold: true,
      ...(base === undefined ? {} : { base }),
    }).then(result => {
      settleTokenSave(result, next, { latest, persisted }, show, setIssue);
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
  return { edits, shownNow, issue, setIssue, notice, commit };
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
 * The "Space between blocks" choice: what it shows and what choosing does.
 *
 * Shown as chosen at once, then saved; a refusal puts the stored answer back
 * and says why. The canvas follows once the save has landed and the style is
 * read again, so it never draws a model the site does not hold.
 */
function useSpacingModeChoice(
  stored: SpacingMode | undefined,
  report: (issue: string | undefined) => void
): Pick<TokensPanelProps, "spacing"> {
  const { save } = useSaveSpacingMode();
  const [chosen, setChosen] = useState<SpacingMode | null>(null);
  // The latest choice, by number, and the saves in the order they were made.
  // Saves run one after another, so the server stores them in that order and
  // the last choice is the one left stored; a choice superseded before its
  // turn is never sent, and the answer to a superseded one changes nothing.
  const latest = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  if (stored === undefined) return {};
  return {
    spacing: {
      mode: chosen ?? stored,
      onChange: mode => {
        latest.current += 1;
        const submission = latest.current;
        setChosen(mode);
        report(undefined);
        queue.current = queue.current.then(async () => {
          if (submission !== latest.current) return;
          const result = await save(mode);
          if (submission !== latest.current) return;
          if (result.saved && result.refreshed) {
            setChosen(null);
            return;
          }
          // Stored but not read back: the choice stays shown, since the store
          // holds it, and the editor says it could not refresh.
          if (!result.saved) setChosen(null);
          report(result.issue);
        });
      },
    },
  };
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
 * A stored class section as the class surface holds it: read as the editor
 * reads the document, over the site's config classes.
 */
function classesFromStored(
  configured: readonly NamedClass[] | undefined,
  stored: unknown
): readonly NamedClass[] {
  return (
    resolveSiteStyle(
      configured === undefined ? {} : { classes: configured },
      readSiteStyleRecord({ classes: stored })
    ).classes ?? NO_CLASSES
  );
}

/**
 * The class list a stored save leaves: the merge as stored, when the save
 * was merged onto a newer copy, else the list composed for it.
 */
function classesAfterSave(
  result: { readonly stored?: unknown },
  composed: readonly NamedClass[],
  configured: readonly NamedClass[] | undefined
): readonly NamedClass[] {
  return result.stored === undefined
    ? composed
    : classesFromStored(configured, result.stored);
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

/** The Variables tab: the studio's variables, in the panel its frame holds. */
export function VariablesTab(): React.JSX.Element | null {
  const studio = useContext(VariablesStudio);
  return studio === null ? null : <TokensPanel {...studio} />;
}

/**
 * One serialised writer for every whole-section class write.
 *
 * Every write here is read-modify-write over the WHOLE section: the payload is
 * the complete class list, because that is what `saveSection` stores. So the
 * list a write composes from decides what survives it, and the rendered
 * `library` is stale for as long as a save takes to come back through the
 * cache.
 *
 * Two things follow, and each was a separate defect.
 *
 * **Composition must happen inside the queue, not before it.** Serialising
 * only TRANSMISSION is not enough: both callers compose their payload, then
 * queue, so the second was already built without the first. `run` therefore
 * takes a FUNCTION and calls it after the previous write settles, so every
 * payload is composed against the result of the one before it.
 *
 * **One base, shared.** Creating and renaming are the same read-modify-write
 * over the same list. Two independent bases meant a rename that had not yet
 * refreshed was invisible to a creation, which then wrote a list carrying the
 * old slug — and in the other order, dropped the new class.
 *
 * A completed write ADVANCES the base; a fresh read from the host REPLACES it,
 * because the server's answer is authoritative the moment it arrives.
 */
interface ClassWrites {
  /**
   * Run one whole-section write, composed against the freshest list.
   *
   * The callback receives the base and answers with the payload it composed
   * plus its own result. Returning `next` separately is what lets this advance
   * the base ONLY when the write succeeded — a refused write changed nothing,
   * and building the following edit on it would persist something the server
   * rejected.
   */
  run: <T>(
    write: (existing: readonly NamedClass[] | undefined) => Promise<{
      result: T;
      next?: readonly NamedClass[];
    }>
  ) => Promise<T>;
}

function useClassWrites(
  library: readonly NamedClass[] | undefined
): ClassWrites {
  const held = useRef(library);
  /*
   * The host's answer supersedes anything composed locally. This runs only
   * when `library` changes identity, which is exactly when a re-read has
   * landed — during a save's window the identity is unchanged and the base
   * keeps whatever the writes advanced it to.
   */
  useEffect(() => {
    held.current = library;
  }, [library]);

  // The chain every write joins. Held as a ref so it survives re-renders: a
  // queue recreated on render would let two writes run concurrently again.
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  const run = useCallback(
    <T,>(
      write: (existing: readonly NamedClass[] | undefined) => Promise<{
        result: T;
        next?: readonly NamedClass[];
      }>
    ): Promise<T> => {
      const started = tail.current.then(async () => {
        const answered = await write(held.current);
        if (answered.next !== undefined) held.current = answered.next;
        return answered.result;
      });
      // The chain must not break on a rejection, or every later write is
      // rejected with an error belonging to an edit the author has forgotten.
      tail.current = started.then(
        () => undefined,
        () => undefined
      );
      return started;
    },
    []
  );

  return { run };
}

/**
 * Whether a read has FAILED rather than merely not finished yet.
 *
 * A separate function because "not arrived" and "will never arrive" are
 * different states with different wording, and reading them from one
 * expression inside the hook made the hook answer two questions at once.
 */
function classReadFailed(pending: boolean, error: unknown): boolean {
  return !pending && error !== null && error !== undefined;
}

/**
 * The empty library, as ONE value rather than a fresh array each time.
 *
 * `?? []` builds a new array on every render, and `useClassWrites` reads a
 * changed identity as "the host has re-read" — so a site whose stored style
 * declares no classes looked like it was re-reading continuously, and any
 * render during an in-flight save reset the write base to the stale list. The
 * next queued write then composed from it and discarded the edit before it,
 * while reporting success.
 */
const NO_CLASSES: readonly NamedClass[] = Object.freeze([]);

/**
 * The library to show, or `undefined` while it is not known.
 *
 * `undefined` while the read is in flight, and the resolved list once it is
 * not — including an empty one. `useSiteStyle` names `pending` as a real third
 * state for exactly this reason: the defaults alone are a legitimate answer, so
 * a surface cannot tell "nothing is stored" from "the read has not come back"
 * by looking at the value.
 */
function readableClassLibrary(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  failed: boolean
): readonly NamedClass[] | undefined {
  if (pending || failed) return undefined;
  // `undefined` above and `NO_CLASSES` here stay distinct: the first is a read
  // that has not answered, the second is one that answered with nothing.
  return siteStyle?.classes ?? NO_CLASSES;
}

/** What {@link useClassSurface} returns, and what the editor hands on as its `classes`. */
export type ClassSurface = {
  library: readonly NamedClass[] | undefined;

  absence: "pending" | "failed";

  /**
   * Store a new shared style, made from a block ("Save as shared style…").
   * Resolves to the refusal in words, or `undefined` once stored. There is
   * no way to make an empty one: a style is born from a block's look.
   */
  add: (entry: NamedClass) => Promise<string | undefined>;
  /**
   * Apply one change to a shared style's styles, while it is the Style tab's
   * target, and store them. Resolves to the refusal in words, or `undefined`
   * once stored.
   */
  writeStyles: (
    classId: string,
    change: SharedStyleChange
  ) => Promise<string | undefined>;
  /** The name each class is heading for while its rename is open. */
  pendingNames: Record<string, string>;

  currentRenameAttempt: (classId: string) => number;

  rename: (
    classId: string,
    name: { label: string; slug: string }
  ) => Promise<ClassRenameOutcome>;
};

export function useClassSurface(
  siteStyle: { classes?: readonly NamedClass[] } | undefined,
  pending: boolean,
  error: unknown,
  /** The site's own config, whose classes storage layers over. */
  config: { classes?: readonly NamedClass[] } | undefined
): ClassSurface {
  // Derived outside the hook, so this decides nothing and only distributes what
  // was decided — which is what keeps the component rendering the inspector
  // free of the branch.
  const failed = classReadFailed(pending, error);
  const library = readableClassLibrary(siteStyle, pending, failed);
  const configured = config?.classes;
  /*
   * ONE writer for both edits. Creating and renaming are the same
   * read-modify-write over the same list, so two independent queues let a
   * rename that had not yet refreshed be invisible to a creation — which then
   * wrote a list carrying the old slug, and in the other order dropped the new
   * class.
   */
  const writes = useClassWrites(library);
  /*
   * Which name each class is heading for while its rename is on the network.
   *
   * Held HERE because it must survive the manager panel being unmounted, which
   * the rail does on every switch. State rather than a ref: the panel renders
   * from it, so a change has to reach the screen.
   */
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  /*
   * Which rename attempt is the live one for each class.
   *
   * A REF, and held beside the pending names rather than inside the panel,
   * because two decisions depend on the same identity and one of them outlives
   * the panel. The rail unmounts the manager on every switch, so a counter kept
   * per field starts again at zero and an older answer then passes for the
   * current one.
   *
   * A ref rather than state because both readers need the value SYNCHRONOUSLY —
   * the panel reads it in the same event that started the attempt, and a state
   * update is not visible until the render after.
   *
   * A `Map` rather than a record, because a class id is stored data: every string
   * a class can carry has to be a key here, and on a plain object some strings,
   * `__proto__` among them, name an inherited accessor instead of an entry.
   */
  const renameAttempts = useRef(new Map<string, number>());
  const beginRename = useCallback((classId: string, name: string): number => {
    const mine = (renameAttempts.current.get(classId) ?? 0) + 1;
    renameAttempts.current.set(classId, mine);
    setPendingNames(current =>
      current[classId] === name ? current : { ...current, [classId]: name }
    );
    return mine;
  }, []);
  const endRename = useCallback((classId: string, mine: number) => {
    /*
     * Only the attempt that is still the live one clears the entry. Clearing
     * unconditionally let a FIRST rename's cleanup delete a second one's
     * pending name while that second write was still on the network — and the
     * panel then compares an edit against the rendered slug, so reverting to it
     * reads as a no-op while the queued rename goes on to persist a different
     * name.
     */
    if (renameAttempts.current.get(classId) !== mine) return;
    setPendingNames(current => {
      // The record's OWN entry, for the reason the counters are a `Map`: `in`
      // also answers for inherited names, and removing one that is not there
      // would rebuild the record for nothing.
      if (!Object.hasOwn(current, classId)) return current;
      const { [classId]: _gone, ...rest } = current;
      return rest;
    });
  }, []);
  /** The live attempt for a class, for a caller deciding whether it is current. */
  const currentRenameAttempt = useCallback(
    (classId: string): number => renameAttempts.current.get(classId) ?? 0,
    []
  );
  return {
    library,
    /*
     * Which absence, so the selector can say so. A read that FAILED will not
     * finish, and a surface that goes on saying "loading" describes a state
     * the site is not in — the distinction the tokens studio already draws.
     */
    absence: failed ? ("failed" as const) : ("pending" as const),
    /*
     * Withheld while the library is unknown. A failed read leaves
     * `useSiteStyle` answering with the config defaults alone, so creating
     * against it would compose a library missing everything stored — and the
     * save would then delete those classes rather than add one.
     */
    add: useRefusalWhileReplaying(useAddClass(writes, configured)),
    /*
     * Withheld the same way: a style's styles written against a library
     * missing what a replay restored would take it away again.
     */
    writeStyles: useRefusalWhileReplaying(
      useWriteClassStyles(writes, configured)
    ),
    /** Which classes are mid-rename, for the manager's no-op check. */
    pendingNames,
    /*
     * The identity BOTH supersession decisions derive from — this hook's own
     * cleanup, and the panel's judgement of whether an answer still describes
     * the rename being attempted.
     */
    currentRenameAttempt,
    /*
     * Withheld the same way and for the same reason: renaming against a
     * library missing everything stored would save that partial list, which
     * deletes the classes it could not see rather than renaming one.
     */
    rename: useHeldWhileReplaying(
      useRenameClass(writes, configured, beginRename, endRename)
    ),
  };
}

/** What a class change made while a style replay settles is told. */
const REPLAY_SETTLING = {
  ok: false as const,
  reason: "A style change is being undone or redone. Try again in a moment.",
};

/**
 * A shared-style write answering its refusal in words, refused the same way
 * while a style undo or redo settles.
 */
function useRefusalWhileReplaying<Args extends unknown[]>(
  write: (...args: Args) => Promise<string | undefined>
): (...args: Args) => Promise<string | undefined> {
  const held = useHeldWhileReplaying(write);
  return useCallback(
    async (...args: Args) => {
      const outcome = await held(...args);
      // A string or nothing is the write's own answer; the settling refusal
      // is the only object, and says why in its reason.
      return typeof outcome === "object" ? outcome.reason : outcome;
    },
    [held]
  );
}

/**
 * A class write, refused while a style undo or redo settles.
 *
 * The inspector and the class manager compose a whole library from the one
 * they hold, which still has what the replay took away until the read
 * catches up; a write made then would put it back. So the write waits, said
 * in words, until the replayed value has been read.
 */
function useHeldWhileReplaying<Args extends unknown[], Outcome>(
  write: (...args: Args) => Promise<Outcome>
): (...args: Args) => Promise<Outcome | typeof REPLAY_SETTLING> {
  const { settling } = useContext(StyleRevisionContext);
  const latest = useRef(settling);
  latest.current = settling;
  return useCallback(
    (...args: Args) =>
      latest.current ? Promise.resolve(REPLAY_SETTLING) : write(...args),
    [write]
  );
}

/** An undo's answer when what it takes back was kept over another's removal. */
const REMOVED_BY_THEM = Symbol("removed-by-them");

/**
 * The stored classes as a replay finds them, with one style taken out: the
 * undo of an edit that kept a style another author had removed meanwhile.
 * Nothing to write once the style is no longer stored.
 */
function classRemovedFrom(
  held: unknown,
  configured: readonly NamedClass[] | undefined,
  classId: string
): SiteStyleReplayed {
  const entries = (Array.isArray(held) ? held : []).filter(
    (entry): entry is NamedClass => typeof entry === "object" && entry !== null
  );
  if (!entries.some(entry => entry.id === classId)) {
    return { kind: "unchanged" };
  }
  return {
    kind: "write",
    value: classOverrideOf(
      configured,
      entries.filter(entry => entry.id !== classId)
    ),
  };
}

/**
 * One style's change applied to the stored classes as a replay finds them:
 * the stored tier with that style changed, nothing to write, or nothing it
 * can do once the style is neither stored nor in the site's code (a removed
 * style is not recreated).
 */
function classChangeOn(
  held: unknown,
  /** The site's code as it was when the step was recorded. */
  recorded: readonly NamedClass[] | undefined,
  /** The site's code as it is now, when the step is replayed. */
  configured: readonly NamedClass[] | undefined,
  classId: string,
  change: SharedStyleChange
): SiteStyleReplayed {
  const entries = (Array.isArray(held) ? held : []).filter(
    (entry): entry is NamedClass => typeof entry === "object" && entry !== null
  );
  const at = entries.findIndex(entry => entry.id === classId);
  const code = configured?.find(each => each.id === classId);
  // A style the site's code supplies is stored only while it differs from
  // the code's, so after an undo the stored tier may not hold it: its
  // styles are then the code's. Stored, it is first moved onto the code as
  // it now is, so the code's old values in it don't mask the new.
  const stored = entries[at];
  const entry =
    stored === undefined
      ? code
      : rebasedOnCode(
          stored,
          recorded?.find(each => each.id === classId),
          code
        );
  if (entry === undefined) {
    // The code no longer supplies it and nothing of the site's own is left.
    return stored === undefined
      ? { kind: "gone" }
      : {
          kind: "write",
          value: classOverrideOf(
            configured,
            entries.filter((_, index) => index !== at)
          ),
        };
  }
  const out = change(entry.styles);
  if (out.kind === "refused") return { kind: "gone" };
  // Nothing for the change to do can still leave the rebase to store: the
  // code may since have set the value the change sets, and the stored entry
  // would go on masking it.
  if (out.kind === "unchanged" && (stored === undefined || stored === entry)) {
    return { kind: "unchanged" };
  }
  const changed = {
    ...entry,
    styles: out.kind === "write" ? out.styles : entry.styles,
  };
  const next =
    at === -1
      ? [...entries, changed]
      : entries.map((each, index) => (index === at ? changed : each));
  // Only what differs from the code is stored, as a forward write stores
  // it: an undo that brings a supplied style back to the code's drops it,
  // so a later change in code shows.
  return { kind: "write", value: classOverrideOf(configured, next) };
}

/** A section save's refusal in words, or the fallback when it gave none. */
function refusalOf(
  result: { saved: boolean; issues: Record<string, string> },
  fallback: string
): string | undefined {
  if (result.saved) return undefined;
  const reasons = Object.values(result.issues);
  // An empty `issues` is still a refusal: reporting it as saved is the one
  // outcome that must never be silent.
  return reasons.length > 0 ? reasons.join(" ") : fallback;
}

/**
 * Add a shared style the builder made from a block: appended to the library,
 * through the one queue every class write joins, so it builds on a rename
 * still in flight rather than on the list both started from.
 *
 * The entry comes whole from the builder's save plan (its id, class name,
 * position and the block's styles), so the plan and the store cannot
 * disagree about what was saved.
 */
function useAddClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  const { save: saveSection, reread } = useSaveSiteStyle();
  return useCallback(
    async (entry: NamedClass): Promise<string | undefined> =>
      writes.run<string | undefined>(async existing => {
        if (existing === undefined) {
          return {
            result:
              "This site's shared styles could not be read, so none can be added.",
          };
        }
        /*
         * Judged again against the library the queue holds, just before it
         * stores: a rename that landed after the dialog read the library can
         * have taken this class name, and two styles with one class name would
         * write one selector.
         */
        const taken = sharedStyleNameTaken(
          entry.label ?? entry.slug,
          entry.slug,
          existing
        );
        if (taken !== undefined) return { result: taken };
        const next: NamedClass[] = [...existing, entry];
        /*
         * Only what DIFFERS from the site's own config classes. The base is the
         * MERGED set the canvas compiles, so saving it whole would copy every
         * config class into the database and mask the site's code from then on.
         */
        // Merged from the list it was composed against, so a style saved
        // elsewhere meanwhile is kept.
        const result = await saveSection(
          "classes",
          classOverrideOf(configured, next),
          { base: classOverrideOf(configured, existing) }
        );
        // Stored over someone else's change to a style: said, with Reload.
        toastSaveConflicts("classes", result, reread);
        // `next` is returned ONLY on success, so a refused write never becomes
        // the base the following edit builds on; the merge as stored, where
        // the save met a newer one.
        const refused = refusalOf(
          result,
          "This shared style could not be saved."
        );
        return refused === undefined
          ? {
              result: undefined,
              next: classesAfterSave(result, next, configured),
            }
          : { result: refused };
      }),
    [writes, configured, saveSection, reread]
  );
}

/**
 * Store one shared style's styles, every other key of its entry (its name,
 * its lock) kept. A history step like any style write, so the editor's Undo
 * writes the style's previous styles back.
 */
function useWriteClassStyles(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined
) {
  const { reserve, reread } = useSaveSiteStyle();
  // The code's styles as they are when a step is undone or redone, not when
  // it was made: the code may change while the step waits in the history.
  const configuredNow = useRef(configured);
  configuredNow.current = configured;
  return useCallback(
    async (
      classId: string,
      change: SharedStyleChange
    ): Promise<string | undefined> => {
      /*
       * The history place is taken NOW, when the author makes the edit; the
       * payload is composed and sent in the queue, after the writes before
       * it. A page edit made while those are stored then comes after this
       * one in the history, as it was made.
       */
      const slot = reserve("classes");
      return writes.run<string | undefined>(async existing => {
        if (existing === undefined) {
          slot.cancel();
          return {
            result:
              "This site's shared styles could not be read, so this one can't be changed.",
          };
        }
        const entry = existing.find(each => each.id === classId);
        if (entry === undefined) {
          slot.cancel();
          return { result: "This shared style is no longer on the site." };
        }
        /*
         * The change applied to the styles as they stand after every write
         * queued before it, rather than an envelope the editor composed from
         * the last read: two edits made before the first is stored would
         * otherwise each carry the read's styles, and the second would undo
         * the first.
         */
        const changed = change(entry.styles);
        // Nothing to save gives the history place up again.
        if (changed.kind !== "write") slot.cancel();
        if (changed.kind === "refused") return { result: changed.reason };
        if (changed.kind === "unchanged") return { result: undefined };
        const next = existing.map(each =>
          each.id === classId ? { ...each, styles: changed.styles } : each
        );
        /*
         * Undone and redone as a change to this one style, composed against
         * the stored classes as they stand then: a whole earlier library
         * written back would also undo what changed elsewhere meanwhile, such
         * as a style removed through the Shared styles tab.
         */
        const undo = change.invert(entry.styles);
        /*
         * Where the write was merged onto another author's newer save, the
         * styles it replaced are theirs, not the ones this edit started from:
         * Undo inverts against those, so it puts their value back rather than
         * the value from before both edits.
         */
        const undoOf = (
          replaced: unknown
        ): SharedStyleChange | typeof REMOVED_BY_THEM => {
          if (replaced === undefined) return undo;
          const theirs = classesFromStored(configured, replaced).find(
            each => each.id === classId
          );
          // Gone from what the write replaced: another author removed the
          // style, and this edit kept it. Undo removes it again.
          return theirs === undefined
            ? REMOVED_BY_THEM
            : change.invert(theirs.styles);
        };
        /*
         * The code the stored entry was last rebased onto: the code this
         * edit was made against, then whatever each replay rebased it onto,
         * so a second change to the code between undo and redo is told
         * from the site's own.
         */
        let baseline = configured;
        const replay =
          (step: SharedStyleChange) =>
          (held: unknown): SiteStyleReplayed => {
            const now = configuredNow.current;
            const out = classChangeOn(held, baseline, now, classId, step);
            if (out.kind !== "gone") baseline = now;
            return out;
          };
        const result = await slot.save(
          classOverrideOf(configured, next),
          {
            undo: (held, replaced) => {
              const step = undoOf(replaced);
              return step === REMOVED_BY_THEM
                ? classRemovedFrom(held, configuredNow.current, classId)
                : replay(step)(held);
            },
            redo: replay(change),
          },
          { base: classOverrideOf(configured, existing) }
        );
        toastSaveConflicts("classes", result, reread);
        const refused = refusalOf(
          result,
          "This shared style could not be changed."
        );
        return refused === undefined
          ? {
              result: undefined,
              next: classesAfterSave(result, next, configured),
            }
          : { result: refused };
      });
    },
    [writes, configured, reserve, reread]
  );
}

/**
 * Rename one class, through the same section write that creates one.
 *
 * Answers the OUTCOME rather than reporting success by staying quiet. A site
 * style save is a network write and the panel clears its field as soon as the
 * author finishes typing, so a refusal that returned nothing would leave the
 * row reading as renamed until the next read contradicted it.
 */
function useRenameClass(
  writes: ClassWrites,
  configured: readonly NamedClass[] | undefined,
  /**
   * Take the next attempt for this class and record the name it heads for.
   *
   * Held by the CALLER rather than by the panel, because a rename outlives the
   * panel: switching rail panels unmounts the manager, and a field remembering
   * its own pending name lost it on exactly the switch that makes the window
   * long enough to matter. Without it, an author who reverts a rename after
   * coming back has the revert read as a no-op while the first write lands.
   */
  beginRename: (classId: string, name: string) => number,
  /** Release the pending name, but only if this attempt is still the live one. */
  endRename: (classId: string, attempt: number) => void
) {
  const { reserve, reread } = useSaveSiteStyle();
  return useCallback(
    async (
      classId: string,
      name: { label: string; slug: string }
    ): Promise<ClassRenameOutcome> => {
      const mine = beginRename(classId, name.label);
      /*
       * The history place is taken NOW, as a style edit's is: a rename
       * queued behind writes still being stored would otherwise take its
       * place only once they answered, after a page edit made meanwhile.
       */
      const slot = reserve("classes");
      try {
        return await writes.run<ClassRenameOutcome>(async existing => {
          if (existing === undefined) {
            slot.cancel();
            return {
              result: {
                ok: false as const,
                reason:
                  "This site's shared styles could not be read, so none can be renamed.",
              },
            };
          }
          // The name and the class name derived from it, together; every
          // other key the entry holds, its lock among them, is kept.
          const next = existing.map(entry =>
            entry.id === classId
              ? { ...entry, label: name.label, slug: name.slug }
              : entry
          );
          // A refused save withdraws its place itself. Merged from the list
          // it was composed against, the next edit builds on what was stored.
          const result = await slot.save(
            classOverrideOf(configured, next),
            undefined,
            { base: classOverrideOf(configured, existing) }
          );
          toastSaveConflicts("classes", result, reread);
          if (result.saved) {
            return {
              result: { ok: true as const },
              next: classesAfterSave(result, next, configured),
            };
          }
          const reasons = Object.values(result.issues);
          return {
            result: {
              ok: false as const,
              reason:
                reasons.length > 0
                  ? reasons.join(" ")
                  : "This shared style could not be renamed.",
            },
          };
        });
      } finally {
        /*
         * Cleared however it went, and in a `finally` so a rejection cannot
         * leave a class permanently reading as mid-rename. A refused write
         * leaves the class with the name it had; a successful one is followed
         * by a read carrying the new one. Either way the stored slug is the
         * answer again.
         *
         * Cleared only where THIS attempt is still the live one, which is the
         * whole reason the identity exists: a superseded attempt finishing late
         * would otherwise release a name a newer write is still heading for.
         */
        endRename(classId, mine);
      }
    },
    [writes, configured, reserve, reread, beginRename, endRename]
  );
}

/**
 * The record an upload answers with, derived from the hook rather than restated.
 *
 * Naming the shape here would be this file's second opinion about what the
 * media pipeline returns, and it would go on compiling after that shape moved.
 */
type UploadedMedia = Awaited<
  ReturnType<ReturnType<typeof useUploadMedia>["mutateAsync"]>
>;

/**
 * Store a font file on this site, then declare the `@font-face` that loads it.
 *
 * Two writes that have to happen in this order and cannot be one: the file must
 * exist and have an id before anything can point at it, and a face pointing at
 * an id that was never stored is a family the page silently fails to load.
 *
 * The face is built from what upload validation SETTLED on rather than from
 * what the browser guessed — `media.mimeType` is the type the bytes were proved
 * to be, so the `format()` hint in the emitted rule cannot disagree with the
 * file the route will serve.
 *
 * @param stored - The faces already declared, which the new one is appended to
 * @returns A writer answering with a message when it refused, `undefined` when
 *   the face is stored
 */
function useFontFaceWriter(
  stored: readonly FontFaceDef[] | undefined,
  storedPending: boolean,
  unreadableFonts: readonly string[]
): {
  add: (request: FontFaceUpload) => Promise<string | undefined>;
  remove: (family: SiteFamily) => Promise<string | undefined>;
} {
  const { save: saveSiteStyle, reread } = useSaveSiteStyle();
  const { mutateAsync: uploadMedia } = useUploadMedia();
  /*
   * Every face this writer has saved, kept until the read reports it back.
   *
   * `useUpdateSingleDocument` starts its invalidation with `void`, so the save
   * resolves BEFORE the refetch that carries the new face into `stored`. An
   * author adding a family's regular and its bold in quick succession reaches
   * the second add while `stored` still describes the document as it was, and
   * a base taken from it saves the second face over the first.
   *
   * Held rather than reset on arrival, and UNIONED with `stored` below: once
   * the read catches up the two agree and the union is `stored` exactly, so
   * there is no moment when this has to be judged stale. The union is also
   * what keeps a face added from another surface in the meantime — a reset
   * base would drop it.
   */
  const written = useRef<readonly FontFaceDef[]>([]);
  /*
   * The last file that reached storage, and what it became.
   *
   * The two writes cannot be one — the bytes must have an id before a face can
   * point at one — so a refused style write leaves a stored object no face
   * references. The form keeps the `File` on a refusal so the author can fix
   * the descriptors and resubmit, and without this each attempt uploaded the
   * same bytes again: a run of validation failures left a copy per attempt.
   *
   * Keyed on the `File` itself, which is the identity the picker hands over
   * and which changes exactly when the author chooses a different file.
   */
  const uploaded = useRef<{ file: File; media: UploadedMedia } | null>(null);
  /*
   * Reload after a save met someone else's change: what this writer saved
   * ahead of the read is dropped, and the read is asked for again.
   */
  const reload = useCallback(() => {
    written.current = [];
    reread();
  }, [reread]);

  const add = useCallback(
    async (request: FontFaceUpload): Promise<string | undefined> => {
      /*
       * Refused rather than guessed at. `save` replaces the section outright,
       * so appending to a stored tier that has not arrived writes the new face
       * ALONE and discards every face already stored — and the author is told
       * it saved.
       *
       * The panel does not render the form while the read is in flight, so
       * nothing reaches this through the UI and no test drives it. It stays
       * because the callback is the host's to hand out and a boolean over a
       * value already in hand costs nothing, while the failure it prevents is
       * silent data loss.
       */
      if (storedPending) {
        return "This site's fonts are still loading. Try again in a moment.";
      }

      /*
       * Refused BEFORE the upload, because the alternative is deletion.
       *
       * `stored` is the read's value, which drops any row it cannot type, and
       * `save` replaces the section outright — so appending to it saves a list
       * those rows are missing from, and the write succeeds, because what it
       * sends is exactly what the checker approves.
       *
       * Not a capability withdrawn: `refusing` in the storage module rejects a
       * write over any issue at all, so such a row already blocks every save of
       * this section. Refusing here names it, and does so before an upload
       * whose bytes nothing would reference.
       */
      if (unreadableFonts.length > 0) {
        return `This site stores a font this version cannot read (${unreadableFonts.join(", ")}), and adding one would replace it. Repair or remove that entry first.`;
      }

      /*
       * Refused from the file's own first bytes BEFORE the upload: the media
       * pipeline takes far more than fonts, and a file stored here that no
       * face points at would stay in the media library. The type check after
       * the upload stays, for what the pipeline settles on.
       */
      const signed = await webFontFormatOf(request.file);
      if (signed === undefined) {
        return NOT_A_FONT;
      }
      // The face judged as the save will judge it, also BEFORE the upload: a
      // family the site cannot store would otherwise leave a stored file no
      // face points at.
      const problems = validateFontFace(
        {
          family: request.family,
          src: [{ url: "/api/media/pending/raw", format: signed }],
          weight: request.weight,
          style: request.style,
          source: { kind: "upload" },
        },
        "fonts"
      );
      if (problems.length > 0) {
        return problems.map(problem => problem.message).join(" ");
      }

      const stored_ = await storeOnce(request.file, uploaded, uploadMedia);
      if (typeof stored_ === "string") return stored_;
      const media = stored_;

      /*
       * The picker's `accept` is a hint a caller can bypass, and the media
       * pipeline accepts far more than fonts. A PNG stored here would be saved
       * as a face with no `format()` — which `validateFontFace` permits — and
       * the byte route answers 404 for every type outside the servable set, so
       * the site would carry a family that silently never loads.
       *
       * Decided on the type upload validation SETTLED on rather than the one
       * the browser guessed, which is the same value the route will check the
       * bytes against.
       */
      const format = fontFormatFor(media.mimeType);
      if (format === undefined) {
        return NOT_A_FONT;
      }

      const face: FontFaceDef = {
        family: request.family,
        /*
         * The route that serves bytes to a reader with no session. A stored
         * media URL is not usable here: `validateFontFace` refuses anything
         * carrying a scheme or an authority, and a backend that stores absolute
         * URLs would produce exactly that.
         */
        src: [{ url: `/api/media/${media.id}/raw`, format }],
        weight: request.weight,
        style: request.style,
        // So the Fonts tab can say it was uploaded rather than downloaded.
        source: { kind: "upload" },
      };

      // The faces this add was made from, which the save is merged onto
      // the stored ones from: a face added elsewhere meanwhile is kept.
      const base = appendBase(stored, written.current);
      const next = [...base, face];
      const result = await saveSiteStyle("fonts", next, { base });
      toastSaveConflicts("fonts", result, reload);
      if (result.saved) {
        // Stored and referenced, so the next add starts clean rather than
        // pointing a second face at the first face's bytes.
        uploaded.current = null;
        written.current = facesAfterSave(result, next);
        return undefined;
      }
      /*
       * Joined rather than picked from, for the reason the breakpoint writer
       * joins: `issues` is keyed by path, and taking the first tells an author
       * about one refused field while a second is also refused.
       */
      const reasons = Object.values(result.issues);
      return reasons.length > 0
        ? reasons.join(" ")
        : "That font could not be saved.";
    },
    [saveSiteStyle, stored, storedPending, unreadableFonts, uploadMedia, reload]
  );

  /*
   * Remove a family's stored faces, through the same section write and so
   * one step of the editor's undo history. The files stay in the media
   * library: another page or face may still point at them.
   */
  const remove = useCallback(
    async (family: SiteFamily): Promise<string | undefined> => {
      if (storedPending) {
        return "This site's fonts are still loading. Try again in a moment.";
      }
      if (unreadableFonts.length > 0) {
        return `This site stores a font this version cannot read (${unreadableFonts.join(", ")}), and removing one would replace it. Repair or remove that entry first.`;
      }
      const base = appendBase(stored, written.current);
      const next = withoutFamily(base, family.key);
      const result = await saveSiteStyle("fonts", next, { base });
      toastSaveConflicts("fonts", result, reload);
      if (result.saved) {
        // Forgotten here too, or the next upload would put it back; the
        // merge as stored, where the save met a newer one.
        written.current =
          result.stored === undefined
            ? withoutFamily(written.current, family.key)
            : facesAfterSave(result, next);
        return undefined;
      }
      const reasons = Object.values(result.issues);
      return reasons.length > 0
        ? reasons.join(" ")
        : `${family.family} could not be removed.`;
    },
    [saveSiteStyle, stored, storedPending, unreadableFonts, reload]
  );

  return { add, remove };
}

/**
 * The faces a stored save leaves: the merge as stored, read as the editor
 * reads the document, when the save was merged onto a newer copy, else the
 * faces sent.
 */
function facesAfterSave(
  result: { readonly stored?: unknown },
  sent: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  return result.stored === undefined
    ? sent
    : (readSiteStyleRecord({ fonts: result.stored }).fonts ?? []);
}

/**
 * Everything a new face must be saved alongside: what was read, plus what this
 * writer saved that the read has not reported back yet.
 *
 * A union rather than a choice between the two. Picking `written` while it
 * looks ahead would drop a face added from another surface since; picking
 * `stored` drops the one just saved. Order follows `stored`, so a face keeps
 * the position the document gives it and an unreported one lands after —
 * where it will be once the read catches up.
 *
 * @param stored - The read's faces, or `undefined` before it arrives
 * @param written - Faces this writer has saved, oldest first
 * @returns The faces to append to
 */
function appendBase(
  stored: readonly FontFaceDef[] | undefined,
  written: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  const base = stored ?? [];
  const present = new Set(base.map(faceIdentity));
  return [...base, ...written.filter(face => !present.has(faceIdentity(face)))];
}

/**
 * What makes two face records the same stored row.
 *
 * The sources carry it: a face added here points at one media object, whose id
 * is minted by the upload, so two adds never collide and a re-read of the same
 * row always matches. Family, weight and style join it because a document may
 * legitimately point two faces at one file — a variable font serving both an
 * upright and a synthesised oblique is the ordinary case.
 */
function faceIdentity(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/**
 * The Google Fonts catalogue as the Fonts tab reads it: through the server,
 * with previews from the file host the server names. `undefined` when the
 * host turned the catalogue off.
 */
function useFontCatalogue(): FontCatalogue | undefined {
  const config = usePluginClientConfig(PLUGIN_SOURCE);
  const client = useFontCatalogueClient();
  // The file host the last read named, which previews are built under. Rows
  // exist only once a read has answered, so it is set before it is asked.
  const previewBase = useRef("");
  const off = config?.fontCatalogue === false;
  return useMemo(
    () =>
      off
        ? undefined
        : {
            load: async (signal: AbortSignal) => {
              const read = await client.load(signal);
              previewBase.current = read.previewBase;
              return read;
            },
            previewUrl: (family, weight, style) =>
              catalogueFileUrl(previewBase.current, {
                id: family.id,
                version: "latest",
                subset: family.defSubset,
                weight,
                style,
              }),
            add: client.add,
          },
    [off, client]
  );
}

/**
 * The Fonts tab, with the writers that add and remove a face and the
 * catalogue.
 *
 * Its own component rather than more hooks in the editor: a panel that needs
 * writers is the thing that should own them. Shown read-only to a role
 * without `update-site-style`, which the server would refuse anyway.
 */
export function FontsPanelWithUpload({
  faces,
  codeFaces,
  tokens,
  absence,
  onOpenTokens,
  storedFaces,
  storedPending,
  unreadableFonts,
}: FontsPanelProps & {
  storedFaces: readonly FontFaceDef[] | undefined;
  storedPending: boolean;
  unreadableFonts: readonly string[];
}): React.JSX.Element {
  const mayChange = useCan("update-site-style");
  const writer = useFontFaceWriter(storedFaces, storedPending, unreadableFonts);
  const catalogue = useFontCatalogue();
  return (
    <FontsPanel
      absence={absence}
      acceptFiles={FONT_FILE_ACCEPT}
      faces={faces}
      codeFaces={codeFaces}
      readOnly={!mayChange}
      onAddFace={writer.add}
      onRemoveFamily={writer.remove}
      catalogue={catalogue}
      onOpenTokens={onOpenTokens}
      tokens={tokens}
    />
  );
}

/**
 * The Shared styles tab, with the class surface's rename and the shared-style
 * routes' reads, lock and removal.
 *
 * Shown read-only to a role without `update-site-style`, which the server
 * would refuse anyway; locking is its own permission, which the usage read
 * reports, so it is offered on the server's word alone.
 */
export function SharedStylesStudio({
  classes,
  pageBlocks,
  styleContext,
  suppliedClassIds,
  tokens,
  looks,
}: {
  classes: ClassSurface;
  pageBlocks: PageClassBlocks;
  styleContext: StyleCompileContext;
  suppliedClassIds: readonly string[] | undefined;
  /** The site's variables as the canvas draws them, for the rows' preview tile. */
  tokens: SiteTokenSet | undefined;
  /** The look the inspector edits on its own, which a Block looks row chooses. */
  looks?: React.ComponentProps<typeof SharedStylesPanel>["looks"];
}): React.JSX.Element {
  const mayChange = useCan("update-site-style");
  const access = useSharedStylesClient();
  const initialOpenId = useStyleToOpen();
  return (
    <SharedStylesPanel
      library={classes.library}
      absence={classes.absence}
      suppliedClassIds={suppliedClassIds}
      styleContext={styleContext}
      tokens={tokens}
      pageBlocks={pageBlocks}
      readOnly={!mayChange}
      access={access}
      onRename={classes.rename}
      currentRenameAttempt={classes.currentRenameAttempt}
      pendingNames={classes.pendingNames}
      {...(looks === undefined ? {} : { looks })}
      {...(initialOpenId === undefined ? {} : { initialOpenId })}
    />
  );
}

/**
 * The style the tab opens as it mounts, sent from the Variables tab, read
 * once and then taken from the studio, so the tab chosen again later opens
 * on its list.
 */
function useStyleToOpen(): string | undefined {
  const toOpen = useContext(SharedStyleToOpen);
  const [initial] = useState(toOpen.id);
  const { taken } = toOpen;
  useEffect(() => {
    if (initial !== undefined) taken();
  }, [initial, taken]);
  return initial;
}

/**
 * Put a file on this site, at most once per file.
 *
 * The two writes an added face needs cannot be one — the bytes must have an id
 * before a face can point at one — so a refused style write leaves a stored
 * object no face references. The form keeps the `File` on a refusal so the
 * author can correct the descriptors and press Add again, and re-uploading on
 * each attempt turned a run of refusals into a copy per attempt.
 *
 * @param file - What the author chose, and the identity this remembers by
 * @param seen - Where the last stored file and its record are kept
 * @param upload - The media pipeline's own mutation
 * @returns The stored record, or a message the author can act on
 */
async function storeOnce(
  file: File,
  seen: React.MutableRefObject<{ file: File; media: UploadedMedia } | null>,
  upload: (input: { file: File }) => Promise<UploadedMedia>
): Promise<UploadedMedia | string> {
  const remembered = seen.current;
  if (remembered !== null && remembered.file === file) return remembered.media;

  try {
    const media = await upload({ file });
    seen.current = { file, media };
    return media;
  } catch (reason) {
    /*
     * The upload's own refusal, which is the one an author can act on: it names
     * the format, the size cap or the signature mismatch. Replacing it with
     * wording of our own would describe a policy this surface does not hold.
     */
    return reason instanceof Error
      ? reason.message
      : "That file could not be uploaded.";
  }
}

const NOT_A_FONT =
  "This file isn\u2019t a .woff2 or .woff font, so it wasn\u2019t added.";

/**
 * The `format()` keyword of the web font a file begins as, by its signature,
 * read from the same table the upload gate checks the bytes against; nothing
 * when it begins as none.
 */
async function webFontFormatOf(file: File): Promise<string | undefined> {
  // `FileReader` rather than `Blob.arrayBuffer()`, which not every DOM the
  // admin runs in provides.
  const head = await new Promise<Uint8Array>(resolve => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(
        reader.result instanceof ArrayBuffer
          ? new Uint8Array(reader.result)
          : new Uint8Array(0)
      );
    reader.onerror = () => resolve(new Uint8Array(0));
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
  const text = String.fromCharCode(...head);
  return WEB_FONT_FORMATS.find(format => format.signature === text)
    ?.formatKeyword;
}

/**
 * The `format()` hint for a validated media type.
 *
 * Read from the same table the upload gate, the public byte route and the
 * admin dropzone read, so this panel cannot come to disagree with any of them
 * about what a web font is. A restated map is the shape that drifts: a format
 * core adds would be stored and served while this panel refused the type it
 * had just accepted, and the author would see a font the site handles
 * everywhere except the one screen offering to add it.
 *
 * An unrecognised type contributes no hint at all rather than a guessed one:
 * `format()` is advisory, and a browser told the wrong format skips the source
 * entirely.
 */
function fontFormatFor(mimeType: string): string | undefined {
  const settled = mimeType.toLowerCase().trim();
  return WEB_FONT_FORMATS.find(format => format.mimeType === settled)
    ?.formatKeyword;
}

/**
 * What the file picker offers, in the two vocabularies a picker accepts.
 *
 * Both, because neither alone is enough. A `.woff2` chosen from disk is
 * reported with no type at all on the platforms that do not carry fonts in
 * their registry, so a types-only `accept` hides the file the author came to
 * add; an extensions-only one hides a font handed over by a tool that names it
 * correctly and spells it differently.
 */
const FONT_FILE_ACCEPT: string = WEB_FONT_FORMATS.flatMap(format => [
  format.extension,
  format.mimeType,
]).join(",");

/**
 * Writing the site's breakpoints, for the manager in the top bar.
 *
 * A hook rather than a callback inside the editor, because that component is
 * already the largest branch point on this surface and every decision folded
 * into it is one more path through the whole thing. What it needs from here is
 * one stable function.
 *
 * Section-scoped, so this sends the breakpoints and nothing else — the other
 * three fields of the record are owned by other studios and are not read here in
 * order to write this one.
 */
export function useBreakpointWriter(
  configSiteStyle: SiteStyleData | undefined
): (next: BreakpointSet) => Promise<string | undefined> {
  const { save: saveSiteStyle } = useSaveSiteStyle();
  /*
   * Whether the HOST states breakpoints in its config, which is what makes an
   * empty stored set unrepresentable. Read from the config tier rather than from
   * the merged value, because the merged one cannot tell a stored set from a
   * defaulted one — which is the ambiguity being guarded.
   *
   * Through the SAME base filter the manager uses. A config carrying only the
   * built-in `{ id: "base" }` row states no authored breakpoint, so counting it
   * refuses the one save that returns such a site to its base-only state — and
   * tells the author to remove a config row the manager deliberately hides as
   * built in. Three surfaces now ask this question and all three ask it once.
   */
  const configuredAuthored = authoredBreakpoints(configSiteStyle?.breakpoints);
  const configured =
    configuredAuthored.viewport.length > 0 ||
    configuredAuthored.container.length > 0;

  return useCallback(
    async (next: BreakpointSet): Promise<string | undefined> => {
      /*
       * An empty set is not storable as an intention while the host states
       * defaults, so it is refused rather than reported as saved.
       *
       * `resolveSiteStyle` layers the stored record over the host's config and
       * decides "was anything stored" with `hasBreakpoints`, which is
       * `viewport.length > 0 || container.length > 0`. So writing
       * `{ viewport: [], container: [] }` succeeds, reads back as NOTHING
       * STORED, and the config defaults return — the author removes every row,
       * is told it saved, and watches them reappear.
       *
       * Refusing says what happened and where the remaining breakpoints come
       * from, which is the one thing the author cannot see from this screen.
       * Representing "explicitly none" would take a stored-format change, and
       * that is not a decision this callback should make silently.
       */
      const emptied = next.viewport.length === 0 && next.container.length === 0;
      if (emptied && configured) {
        return "Your site's configuration defines these breakpoints, so removing them all here would restore them. Remove them from the config instead.";
      }
      const result = await saveSiteStyle("breakpoints", next);
      if (result.saved) return undefined;
      const reasons = Object.values(result.issues);
      // `issues` can be empty on a refusal the transport could not describe.
      // Answering `undefined` there would report a save that did not happen,
      // which is the one outcome that must never be silent.
      return reasons.length > 0
        ? reasons.join(" ")
        : "These breakpoints could not be saved.";
    },
    [saveSiteStyle, configured]
  );
}

/**
 * What the stored site style's read has DONE, in the manager's three words.
 *
 * Named rather than written inline for the reason the writer moved out of the
 * editor component: every decision folded into that function is another path
 * through the whole of it, and `fallow` reports the growth as introduced
 * complexity.
 *
 * `error === null`, not `!== undefined`. `useSiteStyle` types the field as
 * `Error | null` and normalises a successful read to `null`, so an `undefined`
 * comparison is true on success as well as on failure — the mistake that once
 * withheld the provenance trace unconditionally.
 */
export function siteStyleStatus(
  pending: boolean,
  error: Error | null
): "loading" | "unavailable" | "ready" {
  if (pending) return "loading";
  return error === null ? "ready" : "unavailable";
}
