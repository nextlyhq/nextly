/**
 * The site's content languages as Settings › Languages reads and changes them,
 * mirroring what `/api/languages` answers.
 *
 * @module types/languages
 */

/** Which way a language's text runs. */
export type LanguageDirection = "ltr" | "rtl";

/** One language as Settings shows it. */
export interface LanguageView {
  code: string;
  /** The language's display name. */
  label: string;
  direction: LanguageDirection;
  /** The languages a missing value falls back to, in order, by code. */
  fallback: string[];
  position: number;
  isDefault: boolean;
  /** False for a removed language, kept with its content so adding it back restores it. */
  active: boolean;
}

/** The languages, and whether the configuration declares them. */
export interface LanguageList {
  /** The configuration declares the languages, so Settings may only show them. */
  lockedByConfig: boolean;
  languages: LanguageView[];
}

/** A language's details, as adding or editing one names them. */
interface LanguageDetails {
  label: string;
  direction?: LanguageDirection;
  fallback?: string[];
}

/**
 * One change to the languages, as `POST /api/languages` takes it. An edit
 * names only the details it changes; making a language the default is
 * confirmed, having read what it touches.
 */
export type LanguageChange =
  | ({ kind: "add"; code: string } & LanguageDetails)
  | ({ kind: "update"; code: string } & Partial<LanguageDetails>)
  | { kind: "reorder"; codes: string[] }
  | { kind: "remove"; code: string }
  | { kind: "setDefault"; code: string; confirmed: true };

/** What making another language the default would touch, read before it is confirmed. */
export interface DefaultChangeSummary {
  from: string;
  to: string;
  /** Translation rows per language code, across every translated collection, Single and field group. */
  translationsPerLanguage: Record<string, number>;
  /** Pending changes (working drafts) in the current default language. */
  pendingInCurrentDefault: number;
}
