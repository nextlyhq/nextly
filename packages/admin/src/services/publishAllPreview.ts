/**
 * What publishing every language of a document does, language by language, as
 * the server answers it: the preview read before the publish, and the
 * `languages` the publish itself reports afterwards. Both kinds of document,
 * entries and Singles, answer in this one shape.
 *
 * @module services/publishAllPreview
 */

/** One configured language's outcome, in the order the app configures them. */
export type PublishAllLanguageOutcome =
  | { locale: string; outcome: "goes-live-with-pending-change" }
  | { locale: string; outcome: "stays-published" }
  | { locale: string; outcome: "goes-live" }
  | { locale: string; outcome: "shows-fallback"; fallback: string | null }
  | {
      locale: string;
      outcome: "out-of-date";
      /** The shared fields it is behind on that the caller may read. */
      fields: string[];
      /** How many more it is behind on that the caller may not read. */
      hiddenCount?: number;
    };

/** Something that stops the publish as a whole, whatever each language does. */
export interface PublishAllBlocker {
  reason:
    | "shared-edits-unmergeable"
    | "shared-edits-unordered"
    | "pending-change-forbidden"
    | "pending-change-invalid";
  /** The fields at fault that the caller may read. */
  fields: string[];
  /** How many more are at fault that the caller may not read. */
  hiddenCount?: number;
}

/** The answer to "what would publishing every language do". */
export interface PublishAllPreview {
  languages: PublishAllLanguageOutcome[];
  blockers: PublishAllBlocker[];
}
