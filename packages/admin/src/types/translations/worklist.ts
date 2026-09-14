import {
  TRANSLATION_FILTER_STATES,
  type TranslationFilterState,
} from "nextly/translation-filter-states";

import { LANGUAGE_STATE_LABEL } from "@admin/components/features/entries/translation-meta";
import type {
  ListResponse,
  PaginationMeta,
} from "@admin/lib/api/response-types";

/**
 * The translation worklist's wire shape.
 *
 * The ROWS mirror what `GET /api/translations` returns and are typed here. The
 * VOCABULARY the page asks with is not: which states `?state=` accepts is the
 * server's to declare, so it is imported from `nextly/translation-filter-states`
 * and every tab below is built from that one list. A copy written here agreed
 * with the server only on the day it was written — a state the server stopped
 * accepting would stay on offer and answer with an empty worklist.
 *
 * @module types/translations/worklist
 */

/**
 * A state the worklist may ASK FOR, which is exactly a state the server accepts.
 *
 * This is the value that goes on the wire — `useTranslationWorklist` puts it in
 * `/translations?state=` — so it IS the server's type rather than a restatement
 * of it.
 */
export type WorklistState = TranslationFilterState;

/**
 * Where each state's tab sits, in the order a translator wants them.
 *
 * Only the ORDER is this page's own: `missing` leads because it is the question
 * the page exists to answer, where the language panel reads best-to-worst.
 * Keyed by every state the server accepts, so a state added there is a compile
 * error here until it has a place, rather than a filter this page never offers.
 */
const TAB_POSITION: Record<WorklistState, number> = {
  missing: 0,
  draft: 1,
  translated: 2,
  published: 3,
  stale: 4,
};

/** Sentence wording into a button label: "not translated" -> "Not translated". */
function asTabLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Each state's tab label, keyed by every state the server accepts.
 *
 * The four language states take `LANGUAGE_STATE_LABEL`'s wording, title-cased
 * because these are buttons rather than prose. That catalog already answers
 * "what is this state called" for the header control, the editor's language
 * panel, its menu and the list's per-language dots, and a worklist with a
 * vocabulary of its own would describe the same document differently depending
 * on which screen asked.
 *
 * 🔴 `stale` is the one state that is NOT a language state, and it is
 * deliberately not added to `LANGUAGE_STATES`: that is the load-bearing decision
 * of the staleness vocabulary. `languageState()` is a mutually exclusive
 * classifier — missing, then published, then draft, then translated, first
 * match wins — and staleness is ORTHOGONAL to every one of them: a stale
 * translation is still translated, and still published if it was published. A
 * fifth member would make the classifier return "stale" INSTEAD of "published",
 * so the entry list's dots and the editor's language panel would stop reporting
 * a live translation as live. A FILTER, though, is a question rather than a
 * classification, and "which documents need review" is as legitimate a question
 * as "which are drafts" — so the worklist offers it where the catalog does not.
 */
const TAB_LABEL: Record<WorklistState, string> = {
  missing: asTabLabel(LANGUAGE_STATE_LABEL.missing),
  draft: asTabLabel(LANGUAGE_STATE_LABEL.draft),
  translated: asTabLabel(LANGUAGE_STATE_LABEL.translated),
  published: asTabLabel(LANGUAGE_STATE_LABEL.published),
  // 🔴 "Needs review", not "Stale" or "Outdated", and the wording is the decision. The wire value
  // says what the system MEASURED — a source written after its translation — while the label says
  // what a person should DO about it. A translation whose source moved may well still be correct,
  // so naming the state after the measurement would tell an author their work is wrong when all
  // that is known is that it is worth a look.
  //
  // Offered because the server can answer it honestly per collection: a translations table that
  // physically records when each language was written participates, and one that does not is
  // excluded AND NAMED in `unanswerable`. An always-empty tab would read as "this site has no
  // stale translations", which is a claim and the wrong one — the naming is what stops the empty
  // case making it.
  stale: "Needs review",
};

/**
 * The tabs this page offers: one per state the server accepts, in page order.
 *
 * Built from the server's list at runtime rather than written out, so the set
 * of tabs cannot differ from the set of states the endpoint answers for.
 */
export const WORKLIST_STATES: readonly {
  value: WorklistState;
  label: string;
}[] = [...TRANSLATION_FILTER_STATES]
  .sort((a, b) => TAB_POSITION[a] - TAB_POSITION[b])
  .map(value => ({ value, label: TAB_LABEL[value] }));

/** The state a URL asked for, or the question this page exists for. */
export function worklistStateFrom(raw: string | undefined): WorklistState {
  return (
    WORKLIST_STATES.find(s => s.value === raw)?.value ??
    WORKLIST_STATES[0].value
  );
}

/**
 * The language this worklist is actually answering for.
 *
 * A URL value is a request, not a fact, and the one that matters here is the
 * SOURCE language. It is a configured locale, so the server accepts it — and
 * then answers nonsense: nothing is ever "missing" in the language everything
 * is written in, while "translated" matches every document on the site. Both
 * are confident, neither is true, and nothing on the screen suggests the
 * language was the problem. A saved link outliving a change of default locale
 * is enough to produce it.
 *
 * So the URL is honoured only when it names a real target, and otherwise the
 * first target answers. Returns `undefined` only when there is no target at
 * all, which is a site with one language — a worklist that can never have a
 * row, and which the component reports as such.
 */
export function resolveActiveTarget(
  requested: string | undefined,
  targets: readonly string[]
): string | undefined {
  if (requested !== undefined && targets.includes(requested)) return requested;
  return targets[0];
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
/**
 * Pagination meta for this read: the canonical shape, plus what only it needs.
 *
 * An INTERSECTION rather than a rewritten object, so every field the admin's
 * `PaginationMeta` gains arrives here automatically and a change to one cannot
 * leave the other compiling against a stale shape.
 */
export type TranslationWorklistMeta = PaginationMeta & {
  /**
   * Collections the server's fan-out did not consult, named rather than
   * dropped.
   *
   * Carried all the way to the screen on purpose. A worklist that quietly
   * omits a collection reads as "nothing to do there", which is
   * indistinguishable from the truth at a glance and is the one way this page
   * can lie. Absent entirely when everything was consulted, so its PRESENCE is
   * the signal.
   *
   * Optional here rather than added to `PaginationMeta` itself: every other
   * admin list consults everything it lists, so a field they can never populate
   * would invite a reader to check it and conclude something from its absence.
   */
  notConsulted?: string[];
  /**
   * Collections that cannot answer the question this tab asks, named separately.
   *
   * Kept apart from {@link notConsulted} because the remedy differs, and that is the only reason
   * two lists are better than one here. A collection the fan-out did not reach wants a narrower
   * search; one whose translations table predates the timestamp this tab compares wants
   * `nextly migrate`. Merged, the actionable case hides among the unactionable ones.
   *
   * Only ever populated for the review tab — every other state answers from data every
   * translations table has. Absent when nothing was excluded, so its PRESENCE is the signal.
   */
  unanswerable?: string[];
  /**
   * Which remedy applies to {@link unanswerable}, decided by the server.
   *
   * `nextly migrate` applies migration FILES. A development database kept in step by the sync and
   * reload loop has no migration history carrying this column, so that advice can leave the notice
   * unchanged after a developer follows it — the same distinction core makes when it explains an
   * absent translations table. The wording lives here with the other admin strings; only the
   * choice between them comes from the server, which is the side that knows.
   */
  unanswerableRemedy?: "migrate" | "sync";
};

/** The canonical list envelope, carrying this read's own meta. */
export type TranslationWorklistResponse = Omit<
  ListResponse<TranslationWorkRow>,
  "meta"
> & { meta: TranslationWorklistMeta };
