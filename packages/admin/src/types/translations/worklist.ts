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

/**
 * Every state a worklist can be asked for, in the order a translator wants
 * them, and the single source everything else derives from.
 *
 * A tuple rather than a union so there is something to READ at runtime. The
 * page validates a state arriving in the URL, the component renders one tab per
 * state, and the type constrains both — three questions that were each answered
 * by their own hand-kept list, so adding or renaming a state could compile
 * while the URL silently fell back and the tab quietly went missing.
 *
 * The LABEL lives here too. It is the language panel's own wording; a worklist
 * with a vocabulary of its own would describe the same document differently
 * depending on which screen asked.
 *
 * `missing` is first because it is the question this page exists for.
 *
 * Kept in step with the server's `TRANSLATION_FILTER_STATES` by the wire
 * contract rather than by import: `packages/admin` reads resolved DATA across
 * that boundary and nothing else.
 */
export const WORKLIST_STATES = [
  { value: "missing", label: "Not translated" },
  { value: "draft", label: "Draft" },
  { value: "translated", label: "Translated" },
  { value: "published", label: "Published" },
] as const;

export type WorklistState = (typeof WORKLIST_STATES)[number]["value"];

/** The state a URL asked for, or the question this page exists for. */
export function worklistStateFrom(raw: string | undefined): WorklistState {
  return (
    WORKLIST_STATES.find(s => s.value === raw)?.value ??
    WORKLIST_STATES[0].value
  );
}

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
