/**
 * The translation worklist's wire shape.
 *
 * Mirrors what `GET /api/translations` returns. Kept as a type rather than
 * imported from core because `packages/admin` reads resolved DATA across that
 * boundary and nothing else — the same rule that keeps it independent of
 * `blocks-engine` and `plugin-page-builder`.
 *
 * @module types/translations/worklist
 */

/** The four states a language can be asked about, as the API names them. */
export type WorklistState = "missing" | "translated" | "draft" | "published";

/** One document's outstanding work in one language. */
export interface TranslationWorkRow {
  /** Collection slug — also how the row is opened. */
  collection: string;
  /** Its plural label, because a person reads this, not a route. */
  collectionLabel: string;
  id: string;
  /** The document's title in the DEFAULT language: the thing being translated. */
  title: string;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * The canonical list envelope, as every other list read in this admin receives
 * it. The worklist is capped rather than paged, so its meta describes a single
 * synthetic page.
 */
export interface TranslationWorklistResponse {
  items: TranslationWorkRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    /** True when this answer is known to be incomplete — not a page to request. */
    hasNext: boolean;
    hasPrev: boolean;
    /**
     * Collections the server's fan-out did not consult, named rather than
     * dropped.
     *
     * Carried all the way to the screen on purpose. A worklist that quietly
     * omits a collection reads as "nothing to do there", which is
     * indistinguishable from the truth at a glance and is the one way this page
     * can lie. Absent entirely when everything was consulted, so its PRESENCE
     * is the signal.
     */
    notConsulted?: string[];
  };
}
