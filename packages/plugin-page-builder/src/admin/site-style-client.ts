/**
 * The editor's one read and one write for the stored Site Style document.
 *
 * Four studios — tokens, fonts, classes and breakpoints — and the canvas all
 * need this document, and each answering for itself would mean four answers to
 * how it caches, what a malformed record degrades to, and whether the canvas
 * re-renders after a save. So there is one of each here and the surfaces
 * compose them.
 *
 * ## Nothing here is a second implementation
 *
 * The read is `useStoredSiteStyle`, the editor's one query on the plugin's
 * site-style route, which answers anyone who may edit something the builder
 * opens; the Single's own read would refuse an author without Design's
 * permission, and the canvas could then draw nothing. The narrowing is
 * `readSiteStyleRecord`, the same function the server reads a stored record
 * with. The merge is `resolveSiteStyle`, the one place defaults and stored tier
 * meet. What this module adds is the composition, not a rule.
 *
 * ## One document, one cache entry, one section per write
 *
 * The whole record is one query. A studio subscribes to its own section through
 * `select`, and TanStack's structural sharing means a studio whose section did
 * not change does not re-render — the sections are plain JSON, which is what
 * makes that hold.
 *
 * A write names ONE section. Measured across SQLite, Postgres and MySQL: the
 * fields a write names are the fields it changes, so a studio never reads the
 * whole document to save part of it, and four studios cannot clobber one
 * another whatever order they save in. The mutations share one scope, so two
 * saves serialize rather than race.
 *
 * ## A save can wait for the author's pause
 *
 * Every save is a write and, in the editor, a step of undo; the server also
 * limits how many writes an address may make a minute. So a save asked to
 * HOLD is not written at once: saves of the same section made before the
 * author pauses for {@link SITE_STYLE_PAUSE_MS} are written once, with the
 * latest value, as one step. What is held is written at once when the author
 * is done ({@link releaseHeldSiteStyle}): an editor closing, the tab or panel
 * changing, the editor going away, or the page being saved. That is here, in
 * the one write every studio makes, rather than in each field.
 *
 * A held value is drawn at once all the same: it is shown over the stored
 * read ({@link SiteStylePreviewContext}) until the write answers and the read
 * has moved on, or until the write is refused.
 *
 * @module @nextlyhq/plugin-page-builder/admin/site-style-client
 */
import type { SpacingMode } from "@nextlyhq/blocks-engine";
import {
  apiErrorMessage,
  readPluginRoute,
  useTrackedWrite,
  useUpdateSingleDocument,
  validationIssues,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type Context,
} from "react";

import { documentVersionOf } from "../document-version";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_BREAKPOINTS_ROUTE_PATH,
  SPACING_MODE_ROUTE_PATH,
  type SiteBreakpointsRequest,
  type SpacingModeResult,
} from "../library-contract";
import {
  SITE_FONTS_CATALOGUE_ROUTE_PATH,
  SITE_FONTS_ROUTE_PATH,
  type AddSiteFontRequest,
  type FontCatalogueList,
  type FontCatalogueRead,
} from "../site-fonts/contract";
import { resolveSiteStyle, type SiteStyleData } from "../site-style";
import type { MergeWinner } from "../site-style-merge";
import {
  readSiteStyleRecord,
  unreadableStoredFonts,
} from "../site-style-record";
import { SITE_STYLE_SLUG } from "../site-style-storage";
import {
  revisionNumber,
  saveSectionMerged,
  sectionOf,
  type SaveConflicts,
  type VersionedSiteStyle,
} from "../site-style-versioned-save";

import { useStoredSiteStyle } from "./site-style-read";

/**
 * The four sections of the document, each one studio's to own. The spacing
 * model is not one: it is kept beside the document and saved through its own
 * route (see `useSaveSpacingMode`).
 */
export type SiteStyleSection = Exclude<keyof SiteStyleData, "spacingMode">;

/**
 * The site style as the editor should draw it: the host's code-stated defaults
 * with the stored document layered over them.
 *
 * `pending` is a REAL third state beside the data, not a detail of it. The
 * defaults alone are a legitimate answer — a site that has stored nothing gets
 * exactly them — so a surface cannot tell "nothing is stored" from "the read
 * has not come back" by looking at the value. Anything that would flash, or
 * that would commit a write derived from what it is showing, has to ask.
 */
export interface SiteStyleRead {
  /** Defaults merged with the stored tier, ready to compile a sheet from. */
  readonly siteStyle: SiteStyleData;
  /**
   * The stored tier alone, as the document holds it.
   *
   * What a writer editing one section has to build on. `save` replaces a
   * section outright, so appending to the MERGED value would copy the host's
   * config-stated entries into storage — where they stop tracking the config
   * and mask a later change to it — while appending to the config tier drops
   * everything already stored. Neither is the document being edited; this is.
   *
   * `undefined` until the read arrives, which is why `pending` exists beside
   * it: an append derived from `undefined` writes the new entry alone and
   * silently discards the rest.
   */
  readonly stored: SiteStyleData | undefined;
  /**
   * The stored font rows the read had to drop, named by position.
   *
   * Beside `stored` because it is the part of the answer `stored` cannot
   * carry: a narrowed list and a complete one are the same shape, so a writer
   * appending to it has no way to see that rows are missing from the value it
   * is about to save back over them.
   */
  readonly unreadableFonts: readonly string[];
  /** Whether the stored tier has arrived yet. */
  readonly pending: boolean;
  /** Why the read failed, when it did. */
  readonly error: Error | null;
  /** Whether the stored tier is the site as it is now, as the read reports. */
  readonly current: boolean;
}

/**
 * Read the site style, merged and narrowed.
 *
 * `defaults` is the host's config tier, which the plugin publishes to the
 * browser on its client config. Passed in rather than read here so this stays
 * one question — the merge — and the surface that already holds the defaults
 * does not fetch them twice.
 */
export function useSiteStyle(defaults?: SiteStyleData): SiteStyleRead {
  const { data, isPending, error, current } = useStoredSiteStyle();
  const preview = useContext(SiteStylePreviewContext);

  // Narrowed and merged in one memo over one source. A stored row predates its
  // validators, so the read keeps what it can type and drops what it cannot,
  // exactly as the published route does — a read that refused would take down
  // the editor over one legacy row.
  // Narrowed ONCE and both views taken from it, rather than reading the row
  // twice: two calls to `readSiteStyleRecord` over one document are two
  // derivations of the same answer, and they agree until one of them moves.
  const stored = useMemo(() => readSiteStyleRecord(data), [data]);
  // What is drawn: the stored tier with any held section over it, narrowed
  // by the same reader. `stored` stays what the document holds, since a
  // writer builds on that and a held value is not stored yet.
  const drawn = useMemo(
    () =>
      preview.size === 0
        ? stored
        : readSiteStyleRecord({
            ...(typeof data === "object" && data !== null ? data : {}),
            ...Object.fromEntries(preview),
          }),
    [data, preview, stored]
  );
  const siteStyle = useMemo(
    () => resolveSiteStyle(defaults, drawn),
    [defaults, drawn]
  );
  // From the document rather than from `stored`, which is the value AFTER the
  // drop and therefore cannot report one.
  const unreadableFonts = useMemo(() => unreadableStoredFonts(data), [data]);

  return {
    siteStyle,
    stored,
    unreadableFonts,
    pending: isPending,
    error: error ?? null,
    current,
  };
}

/** What a save answers with, whichever way it went. */
export interface SiteStyleSaveResult {
  /** Whether the document now holds what was sent. */
  readonly saved: boolean;
  /**
   * Why not, per section, when it was refused.
   *
   * Keyed by the field the validator named, so a studio shows the message on
   * its own section rather than a document-wide error over one bad row.
   */
  readonly issues: Readonly<Record<string, string>>;
  /**
   * The section as it was written, when the save was merged onto a newer
   * stored copy: the author's change with every other save since kept. A
   * studio adopts it, so what someone else saved appears and the next save
   * builds on it. Absent for a save not merged (one the server gave no
   * version to merge onto, or the breakpoints).
   */
  readonly stored?: unknown;
  /**
   * The true conflicts the merge settled, when there were any: entries both
   * sides changed differently, or one removed while the other changed it.
   * What a studio tells the author; nothing is said here.
   */
  readonly conflicts?: SaveConflicts;
  /**
   * Set when the save was refused because the site's design kept changing:
   * every try was made from a version another save had already replaced.
   */
  readonly keptChanging?: true;
}

/**
 * Why a write was refused, keyed by the section the validator named.
 *
 * A refused write REJECTS by the time it reaches here, and the path there is
 * worth stating because the service and the browser disagree about it. The
 * service returns `{ success: false, committed: false }`; `unwrapServiceResult`
 * turns that into a throw, the route answers non-2xx, and the admin's fetcher
 * turns THAT into a rejected promise carrying an `ApiError`. So a client
 * reading the service's envelope would never see a refusal at all — the
 * envelope does not survive the transport.
 *
 * Keyed by `path`, which is NOT what the service-level envelope uses — that one
 * says `field`. The two are different shapes at different boundaries, and this
 * is the one a client sees.
 */
function issuesFromRejection(reason: unknown): Record<string, string> {
  const issues: Record<string, string> = {};
  // Read through the SDK's own extractor rather than a shape spelled here. A
  // local interface plus a cast would be this file's second opinion about what
  // the transport raises, and it would go on compiling after that shape moved.
  // What stays local is the REQUIREMENT: an issue with no field to attach to,
  // or nothing to say, cannot be shown against a section.
  for (const issue of validationIssues(reason)) {
    if (issue.path !== undefined && issue.message !== undefined)
      issues[issue.path] = issue.message;
  }
  return issues;
}

/**
 * A route's refusal in its own words: every reason it gave, a field named or
 * not, else its message, else `fallback` for a rejection that said nothing.
 *
 * The SDK's `apiErrorMessage`, the admin's one rule for this, rather than the
 * per-section reading above: that one keys reasons by field and so drops one
 * naming none, which left "Validation failed." where the reason belonged.
 */
export function refusalWords(reason: unknown, fallback: string): string {
  return apiErrorMessage(reason, fallback);
}

/**
 * What one save of the site's spacing model came to: stored and read back,
 * stored but not read back (the editor still holds the earlier style), or
 * refused, with the words to show for the last two.
 */
export type SpacingModeSaveResult =
  | { readonly saved: true; readonly refreshed: true }
  | { readonly saved: true; readonly refreshed: false; readonly issue: string }
  | { readonly saved: false; readonly issue: string };

/** What a stored choice whose read-back failed is told. */
const SPACING_MODE_NOT_REFRESHED =
  "The space between blocks was saved, but the editor could not read it back. Reload to see it on the canvas.";

/** What saving the site's spacing model answers. */
export interface SpacingModeSave {
  readonly save: (mode: SpacingMode) => Promise<SpacingModeSaveResult>;
}

/**
 * Save the site's spacing model through its route, then read the style again.
 *
 * The model lives beside the Single rather than in it, so the Single's own
 * write path cannot carry it; the editor's style read answers it, and reading
 * that again is what moves the canvas onto the new model.
 */
export function useSaveSpacingMode(): SpacingModeSave {
  const { refetch } = useStoredSiteStyle();
  const save = useCallback<SpacingModeSave["save"]>(
    async mode => {
      try {
        await writePluginRoute<SpacingModeResult>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: SPACING_MODE_ROUTE_PATH,
          body: { mode },
        });
      } catch (reason) {
        return {
          saved: false,
          issue: refusalWords(
            reason,
            "The space between blocks was not changed."
          ),
        };
      }
      // Stored; the canvas moves only once the style is read again. A failed
      // read answers rather than rejects, so its verdict is what tells a
      // refreshed editor from one still drawing the earlier model.
      const read = await refetch().catch(() => ({ isError: true }));
      return read.isError
        ? { saved: true, refreshed: false, issue: SPACING_MODE_NOT_REFRESHED }
        : { saved: true, refreshed: true };
    },
    [refetch]
  );
  return { save };
}

/**
 * A stored style change as one step of the editor's undo history. Each half
 * writes the section and answers whether the write was stored.
 */
export interface SiteStyleStep {
  readonly undo: () => Promise<SiteStyleReplay>;
  readonly redo: () => Promise<SiteStyleReplay>;
}

/** What one half of a step came to: whether it was stored, and what. */
export interface SiteStyleReplay {
  readonly stored: boolean;
  readonly section: SiteStyleSection;
  /** The section's value once the write answered. */
  readonly value: unknown;
}

/**
 * Where saves made inside the editor become steps of its history.
 *
 * A style is stored the moment it changes, so undoing one is another write:
 * the section as it was before. `settled` holds, per section, what it will
 * hold once every write already made in this editor has answered: a stored
 * write's value, or for a refused one what stood before it. Shared by every
 * studio, and every write joins it in turn, so a step's "before" is what was
 * really there, whichever saves were in flight or refused, which the read
 * cannot say until it catches up.
 */
export interface SiteStyleHistory {
  /** Records a step; answers a function that withdraws it. */
  readonly record: (step: SiteStyleStep) => () => void;
  readonly settled: Map<SiteStyleSection, SectionChain>;
  /**
   * Draws a section's value before it is stored, and hears how its write
   * went: `"held"` shows it, `"stored"` keeps it until the read moves on, and
   * `"dropped"` withdraws it, the write being refused or not needed. An
   * answer for a value no longer shown is ignored. Absent, a value is drawn
   * once it is stored.
   */
  readonly preview?: (
    section: SiteStyleSection,
    value: unknown,
    state: "held" | "stored" | "dropped"
  ) => void;
}

/**
 * The held values drawn over the stored read, by section. Empty outside an
 * editor, and whenever nothing is held.
 */
export const SiteStylePreviewContext: Context<
  ReadonlyMap<SiteStyleSection, unknown>
> = createContext<ReadonlyMap<SiteStyleSection, unknown>>(new Map());

/**
 * One section's writes in this editor, in turn.
 *
 * `tail` settles to what the section holds once every write made so far has
 * answered. Once none is in flight (`pending` 0), `held` is that value and
 * `heldAt` the stored document read at that moment: a newer read means the
 * section moved elsewhere (another tab, or the echo of these writes), and the
 * read is believed over the chain from then on.
 */
export interface SectionChain {
  tail: Promise<unknown>;
  pending: number;
  held: unknown;
  heldAt: unknown;
  /**
   * The save waiting for the author's pause, while there is one. On the
   * chain because it is the chain's next write: it holds `pending` until it
   * is written, so every later write and replay waits behind it.
   */
  waiting?: HeldWrite;
  /**
   * The section's latest write, as the entry form's storing gate tracks it:
   * the gate refuses Save and Publish while a section's latest attempt
   * failed, until a later one succeeds, and it lives as long as the form,
   * open builder or not. `by` names the write it came from.
   */
  attempt?: { readonly by: object; readonly settled: Promise<void> };
}

/**
 * Each section's name in the storing gate's words: "… wasn't saved, so this
 * page wasn't either", said when a write of it was refused.
 */
const SECTION_LABELS: Readonly<Record<SiteStyleSection, string>> = {
  tokens: "A change to the site's variables",
  classes: "A change to the site's shared styles",
  fonts: "A change to the site's fonts",
  breakpoints: "A change to the site's breakpoints",
};

/** A save held for the author's pause. */
export interface HeldWrite {
  /** What the write will store: the latest value saved while it waited. */
  value: unknown;
  /** Waits again from now, the author being still at work. */
  readonly extend: () => void;
  /** Writes now rather than after the pause. */
  readonly release: () => void;
  /** Settles once the write has answered. */
  readonly answered: Promise<SiteStyleSaveResult>;
}

/**
 * How long a held save waits for the author to stop before it is written:
 * long enough to span a field's commit and the next field's first keys, short
 * enough that a change is stored about as soon as the author looks away.
 */
export const SITE_STYLE_PAUSE_MS = 700;

/** The saves an editor's sections are holding, the first for each. */
function heldWrites(history: SiteStyleHistory | null): HeldWrite[] {
  if (history === null) return [];
  return [...history.settled.values()].flatMap(chain =>
    chain.waiting === undefined ? [] : [chain.waiting]
  );
}

/**
 * Writes every held save now, and settles once each has answered. For when
 * the author is done: what they typed must not wait on a pause that may never
 * come, or be lost with the editor.
 */
export async function releaseHeldSiteStyle(
  history: SiteStyleHistory | null
): Promise<void> {
  if (history === null) return;
  for (const write of heldWrites(history)) write.release();
  // Every write still on its way, a chain's tail settling once each made to
  // it so far has answered. Save does not rely on this: the form's storing
  // gate waits for every tracked write, and says when one was refused.
  await Promise.all(
    [...history.settled.values()]
      .filter(chain => chain.pending > 0)
      .map(chain => chain.tail)
  );
}

/** The author is still at work, so every held save waits again. */
export function extendHeldSiteStyle(history: SiteStyleHistory | null): void {
  for (const write of heldWrites(history)) write.extend();
}

/**
 * The editor's held saves, for a surface that knows when the author is still
 * at work or done. Outside an editor nothing is held, and both do nothing.
 */
export function useHeldSiteStyle(): {
  readonly extend: () => void;
  readonly release: () => Promise<void>;
} {
  const history = useContext(SiteStyleHistoryContext);
  return useMemo(
    () => ({
      extend: () => extendHeldSiteStyle(history),
      release: async () => {
        await releaseHeldSiteStyle(history);
      },
    }),
    [history]
  );
}

/** Whether two section values are the same, as stored JSON. */
/** What a queued write answers with when it should write nothing after all. */
const SKIP: unique symbol = Symbol("skip");
/**
 * What a held write answers with when its edits came back to the value the
 * section held before them: there is nothing to write, and no step to keep.
 */
const UNCHANGED: unique symbol = Symbol("unchanged");
/**
 * What a replay answers with when the change it would take back was refused:
 * the section already shows what came before it, so there is nothing to
 * write and the replay is done, which a write skipped for any other reason
 * is not.
 */
const ALREADY_UNDONE: unique symbol = Symbol("already undone");

export function sameSection(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Null outside the editor, where a save joins no history. */
export const SiteStyleHistoryContext: Context<SiteStyleHistory | null> =
  createContext<SiteStyleHistory | null>(null);

/**
 * A section as the stored document holds it, or `null` when it holds none.
 * Raw rather than narrowed, so writing it back stores exactly what was there.
 */
export function storedSection(
  document: unknown,
  section: SiteStyleSection
): unknown {
  return sectionOf(document, section);
}

/** How a save is made. */
export interface SiteStyleSaveOptions {
  /**
   * Wait for the author's pause, joining any save of the section already
   * waiting; see the module note. A save without it writes at once, along
   * with whatever of its section is waiting.
   */
  readonly hold?: boolean;
  /**
   * The section as the studio built `value` from. A save is merged onto the
   * section as stored now, keeping what was saved since this base; without
   * one, the section as this editor last held it stands in. A held burst
   * keeps its first save's base.
   */
  readonly base?: unknown;
}

/** Saving one section, and what the last attempt said. */
/** A place taken in the editor's history for a change whose value comes later. */
/**
 * What a step's undo or redo writes, composed against the section as it
 * stands when the step is replayed: the value to write, nothing to write, or
 * nothing it can do (what it changed is gone), which it says.
 */
export type SiteStyleReplayed =
  | { readonly kind: "write"; readonly value: unknown }
  | { readonly kind: "unchanged" }
  | { readonly kind: "gone" };

/**
 * How a step is taken back and put forward against the section as it stands
 * then, rather than by writing back a whole earlier value: an edit to one
 * entry is undone at that entry, so a change made to another since is kept.
 */
export interface SiteStyleInverse {
  readonly undo: (held: unknown) => SiteStyleReplayed;
  readonly redo: (held: unknown) => SiteStyleReplayed;
}

export interface SiteStyleSlot {
  /**
   * Save the change's value into the place taken. With `inverse`, the step's
   * undo and redo compose against the section as it stands when replayed.
   */
  readonly save: (
    value: unknown,
    inverse?: SiteStyleInverse,
    /** As a section save takes it: the base `value` was built from. */
    options?: Pick<SiteStyleSaveOptions, "base">
  ) => Promise<SiteStyleSaveResult>;
  /** Give the place up: nothing is saved. */
  readonly cancel: () => void;
}

export interface SiteStyleWrite {
  /** Save ONE section. Every other section is left exactly as it was. */
  readonly save: (
    section: SiteStyleSection,
    value: unknown,
    options?: SiteStyleSaveOptions
  ) => Promise<SiteStyleSaveResult>;
  /**
   * Take a place in the editor's history for a change to one section now,
   * and save its value into it later.
   */
  readonly reserve: (section: SiteStyleSection) => SiteStyleSlot;
  /** Whether a save is in flight. */
  readonly saving: boolean;
}

/**
 * Write one section of the site style.
 *
 * Section-scoped because the document's four fields are independent and a write
 * changes only the fields it names. A studio therefore sends what it owns and
 * nothing else — it never has to read the document to save part of it, and it
 * cannot overwrite a section it has never seen.
 */
export function useSaveSiteStyle(): SiteStyleWrite {
  // One scope across every studio, so two saves against this document
  // serialize instead of interleaving their cache updates. Four surfaces own
  // four fields of one record, which is exactly the case a shared scope is for.
  const mutation = useUpdateSingleDocument(SITE_STYLE_SLUG, undefined, {
    scopeId: SITE_STYLE_SLUG,
    // Every write is sent so the browser finishes it after the page is gone:
    // one released while the page is visible can still be in flight when
    // the author leaves, and keepalive cannot be added once a request has
    // started. It costs nothing while the page stays; a body over 64 KB is
    // sent as an ordinary request.
    keepalive: () => true,
  });
  // The stored document, read at the moment of a save rather than closed over.
  const { data, refetch, readFresh } = useStoredSiteStyle();
  const stored = useRef(data);
  stored.current = data;
  const history = useContext(SiteStyleHistoryContext);
  // The entry form's storing gate, which every write in turn is tracked with.
  const track = useTrackedWrite();
  /*
   * Each section as this hook's last write answered it, with the version
   * the same answer gave. Newer than the read until the read catches up, so
   * the next save merges onto it rather than onto a read from before.
   */
  const written = useRef(new Map<SiteStyleSection, VersionedSiteStyle>());

  /**
   * The newest stored copy of a section in hand, with its version: the
   * read's, or this hook's last write's when that is newer. `undefined` when
   * neither carries a version, as from a server that gives none.
   */
  const newest = useCallback(
    (section: SiteStyleSection): VersionedSiteStyle | undefined => {
      const read: VersionedSiteStyle = {
        doc: stored.current,
        rev: documentVersionOf(stored.current),
      };
      const own = written.current.get(section);
      const readAt = revisionNumber(read.rev);
      const ownAt = revisionNumber(own?.rev);
      if (own !== undefined && ownAt !== undefined) {
        if (readAt === undefined || ownAt > readAt) return own;
      }
      return readAt === undefined ? undefined : read;
    },
    []
  );

  const writeSection = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown,
      plan: SectionPlan
    ): Promise<SectionWritten> => {
      try {
        if (section === "breakpoints") {
          // The site's breakpoints change through Settings' route, the one
          // write the Single lets change them. The document is read again
          // after, as the Single's own update leaves it.
          await writePluginRoute<SiteBreakpointsRequest>({
            plugin: PAGE_BUILDER_PLUGIN_NAME,
            path: SITE_BREAKPOINTS_ROUTE_PATH,
            body: { breakpoints: value },
            // Unload-safe, as the Single's update below is: the browser
            // finishes the write if the page goes before it answers.
            keepalive: true,
          });
          await refetch();
          return { result: { saved: true, issues: {} } };
        }
        const latest = newest(section);
        if (latest === undefined) {
          // No version to merge onto or send: the write is made as it
          // always was, unjudged, over whatever the style holds.
          await mutation.mutateAsync({ [section]: value });
          void refetch();
          return { result: { saved: true, issues: {} } };
        }
        // Merged onto the newest stored copy and sent with its version; a
        // save made in between refuses it, and it is read and merged again.
        const saved = await saveSectionMerged({
          section,
          // Without a base, the section as it stands is taken for one, so
          // the value is written whole, as it was before merging.
          base:
            plan.base === undefined
              ? sectionOf(latest.doc, section)
              : plan.base.value,
          mine: value,
          prefer: plan.prefer,
          latest,
          read: async () => {
            const doc = await readFresh();
            return { doc, rev: documentVersionOf(doc) };
          },
          write: async body => {
            const item = await mutation.mutateAsync(body);
            return writtenSection(item, section, body[section]);
          },
          staleOf: staleRefusalData,
        });
        written.current.set(section, saved.latest);
        // The editor reads the style through the plugin's route, which the
        // Single's own write does not invalidate, so it is asked again.
        // Not awaited, as the Single's own invalidation is not: the save has
        // answered, and the history waits for this read where it must.
        void refetch();
        return {
          result: {
            saved: true,
            issues: {},
            stored: saved.stored,
            ...(saved.conflicts === undefined
              ? {}
              : { conflicts: saved.conflicts }),
          },
          merged: { stored: saved.stored, replaced: saved.replaced },
        };
      } catch (reason) {
        // Caught rather than propagated, because a studio needs the reason
        // beside the section that produced it. Letting this reject would push
        // the same decision onto four surfaces, and the one that forgot would
        // show an unhandled rejection where a field message belongs.
        const issues = issuesFromRejection(reason);
        // Refused as stale after every try: the design kept changing.
        const keptChanging =
          staleRefusalData(reason) === undefined
            ? {}
            : { keptChanging: true as const };
        // A rejection carrying no per-path detail is still a refusal. Answering
        // `saved: true` because nothing could be read from it would report a
        // save that did not happen, which is the one outcome worth failing
        // loudly over — so the section names itself and the message stands in.
        if (Object.keys(issues).length === 0) {
          const message =
            reason instanceof Error
              ? reason.message
              : "This could not be saved.";
          return {
            result: {
              saved: false,
              issues: { [section]: message },
              ...keptChanging,
            },
          };
        }
        return { result: { saved: false, issues, ...keptChanging } };
      }
    },
    [mutation, refetch, readFresh, newest]
  );

  /** A save with no history around it: mine kept on a true conflict. */
  const write = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown,
      base: unknown
    ): Promise<SiteStyleSaveResult> =>
      (
        await writeSection(section, value, {
          prefer: "mine",
          ...(base === undefined ? {} : { base: { value: base } }),
        })
      ).result,
    [writeSection]
  );

  /**
   * Write a section after every write already made to it in this editor, and
   * hand on what it then holds. `value` is read only once those have
   * answered, so an undo can write back a "before" that is still settling.
   * `plan` says how the write is merged onto the newest stored copy: from
   * the studio's base, or else from what the section held before it, with
   * mine or theirs kept on a true conflict.
   */
  const inTurn = useCallback(
    (
      chain: SectionChain,
      section: SiteStyleSection,
      value: (before: unknown) => unknown,
      plan: TurnPlan = { prefer: "mine" }
    ) => {
      const before = chain.tail;
      chain.pending += 1;
      // This write, as the section's latest attempt names the one it was.
      const turn = {};
      const done = before.then(async (held): Promise<TurnAnswer> => {
        const next = await value(held);
        // A write whose step was withdrawn while it waited stores nothing,
        // and says nothing new about the section either.
        if (next === SKIP) {
          return {
            result: { saved: false, issues: {} },
            holds: held,
            wrote: false,
            skipped: true,
          };
        }
        if (next === ALREADY_UNDONE) {
          return {
            result: { saved: true, issues: {} },
            holds: held,
            wrote: false,
          };
        }
        // Nothing to write: the section already holds what was asked for,
        // which is as good a correction of a refusal as a stored write.
        if (next === UNCHANGED) {
          return {
            result: { saved: true, issues: {} },
            holds: held,
            wrote: false,
          };
        }
        const { result, merged } = await writeSection(section, next, {
          prefer: plan.prefer,
          base: { value: plan.base === undefined ? held : plan.base },
        });
        // What the section holds now is what was written: the merge, where
        // the write was merged onto a newer save.
        if (!result.saved) return { result, holds: held, wrote: true };
        return merged === undefined
          ? { result, holds: next, wrote: true }
          : {
              result,
              holds: merged.stored,
              wrote: true,
              replaced: merged.replaced,
            };
      });
      chain.attempt = attemptOf(chain.attempt, turn, done);
      track(SECTION_LABELS[section], chain.attempt.settled);
      chain.tail = done.then(({ holds }) => {
        chain.pending -= 1;
        if (chain.pending === 0) {
          chain.held = holds;
          chain.heldAt = stored.current;
        }
        return holds;
      });
      return { before, done, turn };
    },
    [writeSection, track]
  );

  /**
   * A save that leaves the section as it stands: no step to take back, but
   * still a write in turn, tracked by the form's storing gate like any other.
   * The gate may hold the refusal of the save before it, and this is what
   * corrects it; written directly, the gate kept the refusal and Save stayed
   * refused.
   */
  const writeWithoutStep = useCallback(
    async (
      chain: SectionChain,
      section: SiteStyleSection,
      value: unknown
    ): Promise<SiteStyleSaveResult> => {
      const { done } = inTurn(chain, section, () => value);
      return (await done).result;
    },
    [inTurn]
  );

  /**
   * The section's chain, begun again from the stored read when nothing of
   * this editor's is in flight and the read has moved on since it settled.
   */
  const chainOf = useCallback(
    (
      settled: Map<SiteStyleSection, SectionChain>,
      section: SiteStyleSection
    ): SectionChain => {
      const known = settled.get(section);
      if (
        known !== undefined &&
        (known.pending > 0 || known.heldAt === stored.current)
      ) {
        return known;
      }
      const held = storedSection(stored.current, section);
      const fresh: SectionChain = {
        tail: Promise.resolve(held),
        pending: 0,
        held,
        heldAt: stored.current,
        // Begun again from a newer read, the section's latest attempt
        // stays: a write skipped later answers as it did.
        ...(known?.attempt === undefined ? {} : { attempt: known.attempt }),
      };
      settled.set(section, fresh);
      return fresh;
    },
    []
  );

  /*
   * A place in the editor's history, taken when the author makes a change
   * whose value is only known later: the shared-style edits compose their
   * section inside a queue, after the writes before them. The step is recorded
   * now, so a page edit made meanwhile comes after it as it was made; its undo
   * and redo wait until the value is known. Withdrawn when nothing is saved.
   */
  const reserve = useCallback(
    (section: SiteStyleSection): SiteStyleSlot => {
      if (history === null) {
        return {
          save: (value, _inverse, options) =>
            write(section, value, options?.base),
          cancel: () => {},
        };
      }
      const { settled } = history;
      type Filled = {
        before: Promise<unknown>;
        done: Promise<TurnAnswer>;
        inverse: SiteStyleInverse | undefined;
      };
      let fill: (filled: Filled | null) => void = () => {};
      const filled = new Promise<Filled | null>(resolve => {
        fill = resolve;
      });
      // Set once the change is dropped or refused: an undo or redo of it
      // queued in the meantime then writes nothing.
      let withdrawn = false;
      const replay =
        (pick: (known: Filled, held: unknown) => unknown) =>
        async (): Promise<SiteStyleReplay> => {
          const known = await filled;
          const { result, holds } = await inTurn(
            chainOf(settled, section),
            section,
            held => (withdrawn || known === null ? SKIP : pick(known, held)),
            // A replay is merged onto the newest stored copy too, and yields
            // to theirs where the change to take back is no longer there.
            REPLAY_PLAN
          ).done;
          return { stored: result.saved, section, value: holds };
        };
      const withdraw = history.record({
        // Back to what stood just before the change was stored, as the
        // write found it, so a save it was merged onto stays.
        undo: replay(async (known, held) =>
          known.inverse === undefined
            ? replacedBy(await known.done, known.before)
            : replayedValue(known.inverse.undo(held))
        ),
        // What the change stored: the merge, not the studio's value alone.
        redo: replay(async (known, held) =>
          known.inverse === undefined
            ? (await known.done).holds
            : replayedValue(known.inverse.redo(held))
        ),
      });
      const drop = (): void => {
        withdrawn = true;
        fill(null);
        withdraw();
      };
      return {
        cancel: drop,
        save: async (value, inverse, options) => {
          const chain = chainOf(settled, section);
          // A save that leaves the section as it stands is no step to take
          // back.
          if (chain.pending === 0 && sameSection(chain.held, value)) {
            drop();
            return writeWithoutStep(chain, section, value);
          }
          const { before, done } = inTurn(chain, section, () => value, {
            prefer: "mine",
            base: options?.base,
          });
          fill({ before, done, inverse });
          const { result } = await done;
          // A refused save changed nothing, so its step is withdrawn.
          if (!result.saved) drop();
          return result;
        },
      };
    },
    [write, writeWithoutStep, history, inTurn, chainOf]
  );

  /*
   * A save inside the editor is also a step of its history, recorded when the
   * author makes the change rather than when it is stored: the studios save
   * without waiting, and a page edit made meanwhile comes after it. One that
   * leaves the section as it stands is no step at all, and must not end the
   * redo branch, so it is not given a place.
   */
  const save = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown,
      options?: SiteStyleSaveOptions
    ): Promise<SiteStyleSaveResult> => {
      if (history === null) return write(section, value, options?.base);
      const { settled } = history;
      const chain = chainOf(settled, section);
      if (chain.waiting !== undefined) {
        return joinWaiting(
          history,
          section,
          chain.waiting,
          value,
          options?.hold === true
        );
      }
      // A save that leaves the section as it stands is no step to take back,
      // and must not end the redo branch.
      if (chain.pending === 0 && sameSection(chain.held, value)) {
        return writeWithoutStep(chain, section, value);
      }
      const held = options?.hold === true ? holdFor(chain, value) : undefined;
      // Merged from the studio's base, the first save's for a held burst:
      // the later saves joining it only change the value.
      const { before, done, turn } = inTurn(
        chain,
        section,
        prior => (held === undefined ? value : held.next(prior)),
        { prefer: "mine", base: options?.base }
      );
      if (held !== undefined) {
        held.settle(done.then(({ result }) => result));
        history.preview?.(section, value, "held");
      }
      // Set once the save is refused: an undo or redo of it queued in the
      // meantime then writes nothing, or a change would be stored with no
      // step left to take it back.
      let withdrawn = false;
      const replay =
        (target: () => unknown) => async (): Promise<SiteStyleReplay> => {
          let sent: unknown = SKIP;
          const chainNow = chainOf(settled, section);
          // Whether this step's write is still the section's latest attempt,
          // asked before the replay becomes one itself.
          const latestIsMine = chainNow.attempt?.by === turn;
          const { result, holds } = await inTurn(
            chainNow,
            section,
            async () => {
              if (withdrawn) {
                // Undoing a change that was refused takes it back: answering
                // as done clears its refusal from the storing gate, and the
                // undo is done, since what came before it already shows. Only
                // while nothing of the section came after it, whose refusal
                // this must not clear.
                return latestIsMine ? ALREADY_UNDONE : SKIP;
              }
              // The section's value, not a promise of it: an undo's target is
              // what the section held, which may still be settling.
              sent = await target();
              // Drawn at once, over whatever an earlier write left drawn: the
              // read may already hold this value, and then never moves on.
              history.preview?.(section, sent, "held");
              return sent;
            },
            REPLAY_PLAN
          ).done;
          if (sent !== SKIP) {
            history.preview?.(
              section,
              sent,
              result.saved ? "stored" : "dropped"
            );
          }
          return { stored: result.saved, section, value: holds };
        };
      const withdraw = history.record({
        // A change still waiting is written before it is taken back, so the
        // step's two halves are the two values the section really held.
        // Back to what stood just before the change was stored, as the write
        // found it: a save it was merged onto is kept, and Undo puts theirs
        // back where mine replaced it.
        undo: () => {
          chainOf(settled, section).waiting?.release();
          return replay(async () => replacedBy(await done, before))();
        },
        // What the change stored, read when the step is replayed: the value
        // the burst came to, merged onto any save it met.
        redo: replay(async () => (await done).holds),
      });
      const { result, wrote } = await done;
      // Refused, or not written because the edits came back to where they
      // started: either way nothing changed, so the step is withdrawn (which
      // also gives back the redo it cut off) and nothing new is drawn.
      const changed = result.saved && wrote;
      if (held !== undefined) {
        history.preview?.(
          section,
          held.write.value,
          changed ? "stored" : "dropped"
        );
      }
      if (!changed) {
        withdrawn = true;
        withdraw();
      }
      return result;
    },
    [write, writeWithoutStep, history, inTurn, chainOf]
  );

  return { save, reserve, saving: mutation.isPending };
}

/** How one section write is merged onto the newest stored copy. */
interface SectionPlan {
  /** Whose value a true conflict keeps. */
  readonly prefer: MergeWinner;
  /** The section the value was built from; absent, the stored one stands in. */
  readonly base?: { readonly value: unknown };
}

/** What one section write came to, and the merge where there was one. */
interface SectionWritten {
  readonly result: SiteStyleSaveResult;
  /** The section as written and as it stood just before, for a merged write. */
  readonly merged?: { readonly stored: unknown; readonly replaced: unknown };
}

/** How a write in turn is merged: from `base`, else from what the section held. */
interface TurnPlan {
  readonly prefer: MergeWinner;
  readonly base?: unknown;
}

/** An undo or redo: from what the section held, theirs kept on a conflict. */
const REPLAY_PLAN: TurnPlan = { prefer: "theirs" };

/** What a write in turn answers once it is done. */
interface TurnAnswer {
  readonly result: SiteStyleSaveResult;
  /** What the section holds once this write has answered. */
  readonly holds: unknown;
  readonly wrote: boolean;
  readonly skipped?: boolean;
  /** The section as the merged write found it stored, which Undo puts back. */
  readonly replaced?: unknown;
}

/**
 * What a step's undo writes: the section as its merged write found it, or,
 * for a write not merged, what the section held before it in this editor.
 */
async function replacedBy(
  answer: TurnAnswer,
  before: Promise<unknown>
): Promise<unknown> {
  return "replaced" in answer ? answer.replaced : await before;
}

/**
 * The document a section write answered with, and its version. The write's
 * own response carries the whole stored document; one that does not is
 * taken for the section as sent, with the version it gave, which is still a
 * true pair for this section alone.
 */
function writtenSection(
  item: unknown,
  section: SiteStyleSection,
  sent: unknown
): VersionedSiteStyle {
  const rev = documentVersionOf(item);
  return typeof item === "object" && item !== null && section in item
    ? { doc: item, rev }
    : { doc: { [section]: sent }, rev };
}

/**
 * The public data of a refusal made because the Site Style changed since
 * the version the write was sent with, or `undefined` for any other failure.
 * Read from the transport's error as the admin raises it: status 409 with
 * the `STALE_VERSION` code, its data naming the version stored now.
 */
function staleRefusalData(reason: unknown): unknown {
  if (typeof reason !== "object" || reason === null) return undefined;
  const { status, code, data } = reason as {
    readonly status?: unknown;
    readonly code?: unknown;
    readonly data?: unknown;
  };
  return status === 409 && code === "STALE_VERSION" ? (data ?? {}) : undefined;
}

/**
 * A composed replay as the section chain takes it: the value, nothing to
 * write, or nothing it can do, which stores nothing and is refused (so the
 * history says the change could not be undone or redone).
 */
function replayedValue(replayed: SiteStyleReplayed): unknown {
  if (replayed.kind === "write") return replayed.value;
  return replayed.kind === "unchanged" ? UNCHANGED : SKIP;
}

/**
 * A write's attempt as the storing gate tracks it: settled when the write
 * answered, rejected with the reasons when it was refused, and, for a write
 * skipped without being sent, settled as the section's attempt before it
 * was, so that it says nothing new about the section.
 */
function attemptOf(
  prior: SectionChain["attempt"],
  by: object,
  done: Promise<{
    result: SiteStyleSaveResult;
    skipped?: boolean;
  }>
): NonNullable<SectionChain["attempt"]> {
  const settled = done.then(({ result, skipped }) => {
    if (skipped === true) return prior?.settled;
    const reasons = Object.values(result.issues);
    if (!result.saved && reasons.length > 0) {
      throw new Error(reasons.join(" "));
    }
    return undefined;
  });
  // The gate reads the refusal; held here too, so a refusal no gate is
  // tracking is not reported as unhandled.
  settled.catch(() => {});
  return { by, settled };
}

/**
 * A save made while one of its section waits, joined to it: the value it
 * stores is this one, and its step is the one already recorded. Held, it
 * waits again; otherwise everything waiting is written now.
 */
function joinWaiting(
  history: SiteStyleHistory,
  section: SiteStyleSection,
  waiting: HeldWrite,
  value: unknown,
  hold: boolean
): Promise<SiteStyleSaveResult> {
  waiting.value = value;
  // Drawn as the value the waiting write will now answer about.
  history.preview?.(section, value, "held");
  if (hold) waiting.extend();
  else waiting.release();
  return waiting.answered;
}

/**
 * A save made to wait on `chain` for the author's pause. `next` settles to
 * the value to write once it is to be written, after the pause or at once on
 * `release`, given what the section held before; `settle` hands it the
 * answer its write will have, once queued.
 */
function holdFor(
  chain: SectionChain,
  value: unknown
): {
  write: HeldWrite;
  next: (prior: unknown) => Promise<unknown>;
  settle: (answer: Promise<SiteStyleSaveResult>) => void;
} {
  let start: () => void = () => {};
  const due = new Promise<void>(resolve => {
    start = resolve;
  });
  let answer: (result: Promise<SiteStyleSaveResult>) => void = () => {};
  const answered = new Promise<SiteStyleSaveResult>(resolve => {
    answer = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write: HeldWrite = {
    value,
    extend: () => {
      clearTimeout(timer);
      timer = setTimeout(write.release, SITE_STYLE_PAUSE_MS);
    },
    release: () => {
      clearTimeout(timer);
      // No longer joined by later saves: from here it is a write in flight,
      // and the next save starts a write, and a step, of its own.
      if (chain.waiting === write) delete chain.waiting;
      start();
    },
    answered,
  };
  chain.waiting = write;
  write.extend();
  return {
    write,
    // What to write once due: the latest value, or nothing when the edits
    // came back to what the section held before them.
    next: async prior => {
      await due;
      return sameSection(prior, write.value) ? UNCHANGED : write.value;
    },
    settle: answer,
  };
}

/**
 * Reading the Google Fonts catalogue and adding a family from it, both through
 * the server: the editor's browser never asks the catalogue's api itself.
 *
 * An add is a site save made at once rather than a step of the editor's undo
 * history; Remove in the Fonts tab is the way back. The style is read again
 * afterwards, so the canvas and the tab draw the new faces.
 */
export function useFontCatalogueClient(): {
  readonly load: (signal: AbortSignal) => Promise<FontCatalogueRead>;
  readonly add: (request: AddSiteFontRequest) => Promise<string | undefined>;
} {
  const { refetch } = useStoredSiteStyle();
  const load = useCallback(async (signal: AbortSignal) => {
    const list = await readPluginRoute<FontCatalogueList>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_FONTS_CATALOGUE_ROUTE_PATH,
      signal,
    });
    if (list === undefined) throw new Error("The catalogue answered nothing.");
    // The list envelope, read back into what the Fonts tab draws from.
    return {
      families: list.items,
      previewBase: list.meta.previewBase,
      fetchedAt: list.meta.fetchedAt,
    };
  }, []);
  const add = useCallback(
    async (request: AddSiteFontRequest): Promise<string | undefined> => {
      try {
        await writePluginRoute<AddSiteFontRequest>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: SITE_FONTS_ROUTE_PATH,
          body: request,
        });
      } catch (reason) {
        // The route's own words: which value the family does not offer, or
        // that the catalogue did not answer.
        return refusalWords(reason, "This font could not be added.");
      }
      await refetch();
      return undefined;
    },
    [refetch]
  );
  return useMemo(() => ({ load, add }), [load, add]);
}
