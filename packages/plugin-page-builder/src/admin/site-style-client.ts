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
  const siteStyle = useMemo(
    () => resolveSiteStyle(defaults, readSiteStyleRecord(data)),
    [defaults, data]
  );

  return {
    siteStyle,
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

/** The shape a refused write answers with, which is a RESULT and not a throw. */
interface WriteEnvelope {
  readonly success?: boolean;
  readonly committed?: boolean;
  readonly errors?: readonly { field?: string; message?: string }[];
}

/**
 * Read a write's verdict out of what the API answered with.
 *
 * A refused write RESOLVES — measured — carrying `success: false` and a
 * per-field error rather than rejecting. So a caller that awaited the promise
 * and took a settled one for a successful one would report "saved" over a write
 * the database refused, which is the one outcome a studio must never show.
 */
function verdictOf(result: unknown): SiteStyleSaveResult {
  const envelope = (result ?? {}) as WriteEnvelope;
  // Absent means the endpoint answered without saying otherwise, which is what
  // a plain success looks like. Only an explicit `false` is a refusal.
  const saved = envelope.success !== false && envelope.committed !== false;
  if (saved) return { saved: true, issues: {} };
  const issues: Record<string, string> = {};
  for (const issue of envelope.errors ?? []) {
    const field = issue.field ?? "";
    if (field !== "" && issue.message !== undefined) {
      issues[field] = issue.message;
    }
  }
  return { saved: false, issues };
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
      const result = await mutation.mutateAsync({ [section]: value });
      return verdictOf(result);
    },
    [mutation]
  );

  return { save, saving: mutation.isPending };
}
