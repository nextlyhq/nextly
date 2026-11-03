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
 * @module @nextlyhq/plugin-page-builder/admin/site-style-client
 */
import {
  apiErrorMessage,
  readPluginRoute,
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

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_BREAKPOINTS_ROUTE_PATH,
  type SiteBreakpointsRequest,
} from "../library-contract";
import {
  SITE_FONTS_CATALOGUE_ROUTE_PATH,
  SITE_FONTS_ROUTE_PATH,
  type AddSiteFontRequest,
  type FontCatalogueList,
  type FontCatalogueRead,
} from "../site-fonts/contract";
import { resolveSiteStyle, type SiteStyleData } from "../site-style";
import {
  readSiteStyleRecord,
  unreadableStoredFonts,
} from "../site-style-record";
import { SITE_STYLE_SLUG } from "../site-style-storage";

import { useStoredSiteStyle } from "./site-style-read";

/** The four sections of the document, each one studio's to own. */
export type SiteStyleSection = keyof SiteStyleData;

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
  const { data, isPending, error } = useStoredSiteStyle();

  // Narrowed and merged in one memo over one source. A stored row predates its
  // validators, so the read keeps what it can type and drops what it cannot,
  // exactly as the published route does — a read that refused would take down
  // the editor over one legacy row.
  // Narrowed ONCE and both views taken from it, rather than reading the row
  // twice: two calls to `readSiteStyleRecord` over one document are two
  // derivations of the same answer, and they agree until one of them moves.
  const stored = useMemo(() => readSiteStyleRecord(data), [data]);
  const siteStyle = useMemo(
    () => resolveSiteStyle(defaults, stored),
    [defaults, stored]
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
}

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
}

/** Whether two section values are the same, as stored JSON. */
/** What a queued write answers with when it should write nothing after all. */
const SKIP: unique symbol = Symbol("skip");

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
  if (typeof document !== "object" || document === null) return null;
  return (document as Record<string, unknown>)[section] ?? null;
}

/** Saving one section, and what the last attempt said. */
export interface SiteStyleWrite {
  /** Save ONE section. Every other section is left exactly as it was. */
  readonly save: (
    section: SiteStyleSection,
    value: unknown
  ) => Promise<SiteStyleSaveResult>;
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
  });
  // The stored document, read at the moment of a save rather than closed over.
  const { data, refetch } = useStoredSiteStyle();
  const stored = useRef(data);
  stored.current = data;
  const history = useContext(SiteStyleHistoryContext);

  const write = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown
    ): Promise<SiteStyleSaveResult> => {
      try {
        if (section === "breakpoints") {
          // The site's breakpoints change through Settings' route, the one
          // write the Single lets change them. The document is read again
          // after, as the Single's own update leaves it.
          await writePluginRoute<SiteBreakpointsRequest>({
            plugin: PAGE_BUILDER_PLUGIN_NAME,
            path: SITE_BREAKPOINTS_ROUTE_PATH,
            body: { breakpoints: value },
          });
          await refetch();
        } else {
          await mutation.mutateAsync({ [section]: value });
          // The editor reads the style through the plugin's route, which the
          // Single's own write does not invalidate, so it is asked again.
          // Not awaited, as the Single's own invalidation is not: the save has
          // answered, and the history waits for this read where it must.
          void refetch();
        }
        return { saved: true, issues: {} };
      } catch (reason) {
        // Caught rather than propagated, because a studio needs the reason
        // beside the section that produced it. Letting this reject would push
        // the same decision onto four surfaces, and the one that forgot would
        // show an unhandled rejection where a field message belongs.
        const issues = issuesFromRejection(reason);
        // A rejection carrying no per-path detail is still a refusal. Answering
        // `saved: true` because nothing could be read from it would report a
        // save that did not happen, which is the one outcome worth failing
        // loudly over — so the section names itself and the message stands in.
        if (Object.keys(issues).length === 0) {
          const message =
            reason instanceof Error
              ? reason.message
              : "This could not be saved.";
          return { saved: false, issues: { [section]: message } };
        }
        return { saved: false, issues };
      }
    },
    [mutation, refetch]
  );

  /**
   * Write a section after every write already made to it in this editor, and
   * hand on what it then holds. `value` is read only once those have
   * answered, so an undo can write back a "before" that is still settling.
   */
  const inTurn = useCallback(
    (
      chain: SectionChain,
      section: SiteStyleSection,
      value: (before: unknown) => unknown
    ) => {
      const before = chain.tail;
      chain.pending += 1;
      const done = before.then(async held => {
        const next = await value(held);
        // A write whose step was withdrawn while it waited stores nothing.
        if (next === SKIP) {
          return { result: { saved: false, issues: {} }, holds: held };
        }
        const result = await write(section, next);
        return { result, holds: result.saved ? next : held };
      });
      chain.tail = done.then(({ holds }) => {
        chain.pending -= 1;
        if (chain.pending === 0) {
          chain.held = holds;
          chain.heldAt = stored.current;
        }
        return holds;
      });
      return { before, done };
    },
    [write]
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
      };
      settled.set(section, fresh);
      return fresh;
    },
    []
  );

  /*
   * A save inside the editor is also a step of its history, recorded when the
   * author makes the change rather than when it is stored: the studios save
   * without waiting, and a page edit made meanwhile comes after it. A refused
   * save changed nothing, so its step is withdrawn.
   */
  const save = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown
    ): Promise<SiteStyleSaveResult> => {
      if (history === null) return write(section, value);
      const { settled } = history;
      const chain = chainOf(settled, section);
      // A save that leaves the section as it stands is no step to take back,
      // and must not end the redo branch.
      if (chain.pending === 0 && sameSection(chain.held, value)) {
        return write(section, value);
      }
      const { before, done } = inTurn(chain, section, () => value);
      // Set once the save is refused: an undo or redo of it queued in the
      // meantime then writes nothing, or a change would be stored with no
      // step left to take it back.
      let withdrawn = false;
      const replay =
        (target: () => unknown) => async (): Promise<SiteStyleReplay> => {
          const { result, holds } = await inTurn(
            chainOf(settled, section),
            section,
            () => (withdrawn ? SKIP : target())
          ).done;
          return { stored: result.saved, section, value: holds };
        };
      const withdraw = history.record({
        undo: replay(() => before),
        redo: replay(() => value),
      });
      const { result } = await done;
      if (!result.saved) {
        withdrawn = true;
        withdraw();
      }
      return result;
    },
    [write, history, inTurn, chainOf]
  );

  return { save, saving: mutation.isPending };
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
