/**
 * What the editor's Languages menu says about one document: each language's one-line status, and
 * how many of its translations need work.
 *
 * Read off the document's translation overview (`_translations`) only, so a line never claims
 * more than the server told this reader. Someone who may not read every language's state is told
 * none, and still finds each language. Free of React, so every state is tested without rendering.
 *
 * Whether readers see a language is the list chips' own answer (`languageChipFacts`), so the menu
 * and the list never disagree about a document. The line says that and the one thing the language
 * needs most: what is out of date, else that its changes are not published. The row keeps both
 * facts apart, so neither is lost where the line says only one.
 *
 * @module components/features/languages-menu/languages-menu-model
 */

import { languageChipFacts } from "@admin/components/features/entries/EntryList/language-chips";
import type { LocaleTranslationMeta } from "@admin/components/features/entries/translation-meta";
import { languageName } from "@admin/lib/i18n/language-name";

/** One of the site's languages, as `useLocalization` gives it. */
export interface MenuLanguage {
  code: string;
  label: string;
  rtl: boolean;
}

/** One language's part of the overview, with the fields whose origin is recorded. */
export interface LanguageOverview extends LocaleTranslationMeta {
  /** Each field's origin, by field name; absent where none is recorded. */
  fields?: Readonly<Record<string, { outOfDate?: boolean }>>;
}

/** Where a language stands with its readers. */
export type LanguageStanding = "live" | "draft" | "not started";

/** One language's row in the menu. */
export interface LanguageRow {
  code: string;
  /** The language's name, with its code where another language has the same name. */
  name: string;
  /**
   * How the name is marked up: in its own language and direction where it is written in it
   * ("Español"), and otherwise with the direction its own letters have ("Spanish").
   */
  nameAttributes: { lang?: string; dir: "ltr" | "rtl" | "auto" };
  isDefault: boolean;
  /** Where it stands; null where the overview was not read. */
  standing: LanguageStanding | null;
  /** The thing it needs most: "1 field out of date". Null where it needs nothing. */
  need: string | null;
  /** Whether it is out of date. Never the default language. */
  outOfDate: boolean;
  /** Whether a saved change waits to be published in it, whatever its line says first. */
  pendingChange: boolean;
  /** Whether this translation is out of date or holds unpublished changes. */
  needsWork: boolean;
}

export interface LanguagesMenuModel {
  /** Every language of the site, in its order. */
  rows: LanguageRow[];
  /** How many translations need work. The default language is not one of them. */
  needWork: number;
}

/** Whether `label` is the language's own name for itself, as "Español" is Spanish's. */
function isOwnName(label: string, code: string): boolean {
  try {
    // A language the runtime has no names for is named in the runtime's own
    // language instead, which would pass for the language's own name.
    if (Intl.DisplayNames.supportedLocalesOf([code]).length === 0) return false;
    const spelled = label.trim().toLocaleLowerCase(code);
    return [code, new Intl.Locale(code).language].some(
      tag => languageName(tag).toLocaleLowerCase(code) === spelled
    );
  } catch {
    // A code the runtime does not read as a language names nothing.
    return false;
  }
}

function nameAttributesOf({
  code,
  label,
  rtl,
}: MenuLanguage): LanguageRow["nameAttributes"] {
  if (!isOwnName(label, code)) return { dir: "auto" };
  return { lang: code, dir: rtl ? "rtl" : "ltr" };
}

/** What is out of date in a language: how many fields, or null where it is not told by field. */
function outOfDateOf(
  overview: LanguageOverview | undefined
): { fields: number | null } | undefined {
  const fields = Object.values(overview?.fields ?? {}).filter(
    field => field.outOfDate === true
  ).length;
  if (fields > 0) return { fields };
  return overview?.stale === true ? { fields: null } : undefined;
}

function outOfDateWords(fields: number | null): string {
  if (fields === null) return "out of date";
  return `${fields} ${fields === 1 ? "field" : "fields"} out of date`;
}

/** The thing a language needs most, or null: catching up first, then publishing. */
function needOf(
  outOfDate: { fields: number | null } | undefined,
  pending: boolean
): string | null {
  if (outOfDate) return outOfDateWords(outOfDate.fields);
  return pending ? "changes not published" : null;
}

type RowIdentity = Pick<
  LanguageRow,
  "code" | "name" | "nameAttributes" | "isDefault"
>;
type RowState = Omit<LanguageRow, keyof RowIdentity>;

/** A row's state where the overview was not read: nothing is said of it. */
const UNKNOWN: RowState = {
  standing: null,
  need: null,
  outOfDate: false,
  pendingChange: false,
  needsWork: false,
};

/** What a language has of its own, as the overview tells it. */
function contentOf(overview: LanguageOverview | undefined, isDefault: boolean) {
  const pending = overview?.pendingChange === true;
  // The default language is always written. Any other has content of its own, or has its first
  // content still held in a saved change.
  const written = isDefault || overview?.translated === true;
  return { pending, written, started: written || pending };
}

/** Whether a translation needs work. The default language is not one. */
function needsWorkIn(
  row: Pick<LanguageRow, "isDefault" | "outOfDate" | "pendingChange">
): boolean {
  return !row.isDefault && (row.outOfDate || row.pendingChange);
}

function standingOf(started: boolean, live: boolean): LanguageStanding {
  if (!started) return "not started";
  return live ? "live" : "draft";
}

function rowStateOf(args: {
  overview: LanguageOverview | undefined;
  isDefault: boolean;
  documentStatus: unknown;
}): RowState {
  const { isDefault, overview } = args;
  const { pending, written, started } = contentOf(overview, isDefault);
  // The default language is what translations are made from, so it never fell behind one.
  const outOfDate = isDefault || !written ? undefined : outOfDateOf(overview);
  const facts = { outOfDate: outOfDate !== undefined, pendingChange: pending };
  const { live } = languageChipFacts(
    {
      translated: started,
      // First content still held is shown to nobody, whatever status the language is given.
      status: written ? overview?.status : "draft",
    },
    args.documentStatus
  );
  return {
    standing: standingOf(started, live),
    need: needOf(outOfDate, pending),
    ...facts,
    needsWork: needsWorkIn({ isDefault, ...facts }),
  };
}

/**
 * The menu for one saved, translated document, or null for a site with fewer than two languages.
 * Without `translations` no state was read, and the rows say none.
 *
 * `documentStatus` is the document's own Draft / Published status, passed only where it has that
 * lifecycle: a language published in a document still in draft is shown to nobody.
 */
export function languagesMenuModel(args: {
  languages: readonly MenuLanguage[];
  defaultLanguage: string;
  translations: Readonly<Record<string, LanguageOverview>> | undefined;
  documentStatus?: unknown;
}): LanguagesMenuModel | null {
  const { languages, translations } = args;
  if (languages.length < 2) return null;
  const rows = languages.map((language): LanguageRow => {
    const { code, label } = language;
    const isDefault = code === args.defaultLanguage;
    const nameIsShared =
      languages.filter(other => other.label === label).length > 1;
    return {
      code,
      name: nameIsShared ? `${label} (${code})` : label,
      nameAttributes: nameAttributesOf(language),
      isDefault,
      ...(translations === undefined
        ? UNKNOWN
        : rowStateOf({
            overview: translations[code],
            isDefault,
            documentStatus: args.documentStatus,
          })),
    };
  });
  return { rows, needWork: rows.filter(row => row.needsWork).length };
}

function sentenceCase(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A row's line, in the parts its dots set apart: "Live" and "1 field out of date", or for the
 * language on screen "Editing" and "live, 1 field out of date". Empty where nothing is said of it.
 * Someone who may not change the language is "Viewing" it.
 */
export function statusParts(
  { standing, need }: Pick<LanguageRow, "standing" | "need">,
  onScreen: boolean,
  canEdit = true
): string[] {
  const facts = [standing, need].filter(
    (each): each is string => each !== null
  );
  if (onScreen)
    return [
      canEdit ? "Editing" : "Viewing",
      ...(facts.length === 0 ? [] : [facts.join(", ")]),
    ];
  return facts.map((words, index) =>
    index === 0 ? sentenceCase(words) : words
  );
}

/** The count in words: "1 needs attention", "2 need attention". */
export function needWorkWords(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} attention`;
}
