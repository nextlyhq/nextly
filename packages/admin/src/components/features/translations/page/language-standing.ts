/**
 * Where the language being written stands with its readers, and so what saving
 * and publishing it would do. Pure: the page draws its actions and the
 * sentence beside Save from this one answer.
 *
 * @module components/features/translations/page/language-standing
 */

import type { LocaleTranslationMeta } from "@admin/components/features/entries/translation-meta";

export interface LanguageStanding {
  /** Whether its readers are served it; undefined where that can't be known. */
  published: boolean | undefined;
  /** Whether a saved change waits to be published; undefined where unknown. */
  pending: boolean | undefined;
}

/** How a document's kind keeps unpublished work. */
export interface DraftRules {
  /** Whether it has a draft and a published state at all. */
  hasStatus: boolean;
  /** Whether a save of a published language is held until it is published. */
  holdsDrafts: boolean;
  /** Whether a held draft is read, one from before drafts stopped being held. */
  readsDraft: boolean;
}

/**
 * The standing of `code`, from every language's overview and the document's
 * own status. Unlike the list's chip, a published language with no text of its
 * own is still published: its readers are served another language's text.
 */
export function languageStanding(
  translations: Readonly<Record<string, LocaleTranslationMeta>> | undefined,
  code: string,
  documentStatus: unknown
): LanguageStanding {
  // No overview: a reader the server doesn't let read every language's state.
  if (translations === undefined) {
    return { published: undefined, pending: undefined };
  }
  const meta = translations[code];
  if (meta === undefined) return { published: false, pending: false };
  const documentPublic =
    typeof documentStatus !== "string" || documentStatus === "published";
  const languagePublic =
    meta.status === undefined ? meta.translated : meta.status === "published";
  return {
    published: documentPublic && languagePublic,
    pending: meta.pendingChange === true,
  };
}

/** Whether a save of the language reaches its readers at once. */
export type SaveReach = "readers" | "maybe" | "nobody";

export function saveReach(
  rules: DraftRules,
  standing: LanguageStanding
): SaveReach {
  if (!rules.hasStatus) return "readers";
  if (rules.holdsDrafts || standing.published === false) return "nobody";
  return standing.published === undefined ? "maybe" : "readers";
}

/** What to say beside Save before it changes what readers see. */
export function saveReachSentence(
  reach: SaveReach,
  rules: DraftRules,
  language: string
): string | undefined {
  if (reach === "nobody") return undefined;
  if (!rules.hasStatus) {
    return `There are no drafts here: saving changes what ${language} readers see at once.`;
  }
  return reach === "readers"
    ? `${language} is published and no drafts are kept here: saving changes what its readers see at once.`
    : `No drafts are kept here: if ${language} is published, saving changes what its readers see at once.`;
}

/**
 * Whether the language holds a draft from before drafts stopped being held.
 * Publishing would put live what is stored and drop the draft the page shows.
 */
export function holdsStrandedDraft(
  rules: DraftRules,
  standing: LanguageStanding
): boolean {
  return rules.readsDraft && !rules.holdsDrafts && standing.pending === true;
}

/**
 * Whether publishing the language can ever do anything: not where nothing is
 * published, and not for a published language whose saves already go live.
 */
export function publishApplies(
  rules: DraftRules,
  standing: LanguageStanding
): boolean {
  if (!rules.hasStatus || holdsStrandedDraft(rules, standing)) return false;
  return standing.published !== true || rules.holdsDrafts;
}

/**
 * The other languages a first publish of the document shows its readers too:
 * those marked published while the document was not. Empty where it already
 * is published, and undefined where it can't be known.
 */
export function languagesGoingLiveToo(args: {
  translations: Readonly<Record<string, LocaleTranslationMeta>> | undefined;
  codes: readonly string[];
  target: string;
  documentStatus: unknown;
}): string[] | undefined {
  const { translations, codes, target, documentStatus } = args;
  if (documentStatus === "published") return [];
  if (translations === undefined) return undefined;
  return codes.filter(
    code =>
      code !== target &&
      languageStanding(translations, code, "published").published === true
  );
}

/** Whether there is something to publish now. */
export function hasSomethingToPublish(
  standing: LanguageStanding,
  unsaved: boolean
): boolean {
  if (standing.published !== true) return true;
  return unsaved || standing.pending === true;
}

/** Whether the language can be taken offline: while it is, or may be, published. */
export function offlineApplies(
  rules: DraftRules,
  standing: LanguageStanding
): boolean {
  return rules.hasStatus && standing.published !== false;
}
