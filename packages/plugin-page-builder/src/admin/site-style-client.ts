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
 * The read is the admin's own `useSingleDocument`, so this document caches and
 * invalidates exactly as every other Single does. The narrowing is
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
  useSingleDocument,
  useUpdateSingleDocument,
  validationIssues,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo } from "react";

import { resolveSiteStyle, type SiteStyleData } from "../site-style";
import { readSiteStyleRecord } from "../site-style-record";
import { SITE_STYLE_SLUG } from "../site-style-storage";

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
  const { data, isPending, error } = useSingleDocument(SITE_STYLE_SLUG);

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

  return {
    siteStyle,
    stored,
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

  const save = useCallback(
    async (
      section: SiteStyleSection,
      value: unknown
    ): Promise<SiteStyleSaveResult> => {
      try {
        await mutation.mutateAsync({ [section]: value });
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
    [mutation]
  );

  return { save, saving: mutation.isPending };
}
