/**
 * Which languages an operation involves, as its access rules are told.
 *
 * A rule may answer by language: let a translator edit French only, or keep
 * a draft language unreadable. So every rule is told the language it is
 * judging and every language the operation involves. One operation sets them
 * once, at its start, with {@link withRuleLanguage}, and every rule asked
 * inside it reads them: the collection's gate, a related row's, and each
 * field's. That keeps one answer for one operation, however many places ask.
 *
 * An operation that names no language of its own is told every configured
 * language. That is the truth about a delete or a bulk change, which act on
 * every language, and it is the safe answer for any path that forgets to
 * say: a rule that limits someone to one language refuses it rather than
 * being passed by an empty list.
 *
 * @module auth/access/rule-language
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { container } from "../../di/container";
import {
  isPlainObject,
  TRANSLATED_KEY,
} from "../../domains/collections/query/filter-shape";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../domains/field-groups/storage/field-group-field-type";
import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
import { appLocalization } from "../../domains/i18n/configured-locales";
import {
  EVERY_LOCALE,
  EVERY_TRANSLATION,
} from "../../domains/i18n/locale-selector";
import {
  resolveLocaleChain,
  resolveRequestedLocale,
} from "../../domains/i18n/resolve-locale";
import type { AccessRuleTarget } from "../../shared/types/access";

/** The languages an operation involves, and the one judged where it is one. */
export interface RuleLanguage {
  readonly locale?: string;
  readonly locales: readonly string[];
}

const NO_LANGUAGE: RuleLanguage = Object.freeze({ locales: Object.freeze([]) });

const ruleLanguage = new AsyncLocalStorage<RuleLanguage>();

/**
 * The language `requested` resolves to, as a read or a write resolves it: the
 * language itself where it is configured, else the default. None where the
 * site has no languages.
 */
function oneLanguage(
  cfg: SanitizedLocalizationConfig,
  requested: string | undefined
): RuleLanguage {
  const locale = resolveRequestedLocale(cfg, requested);
  return { locale, locales: [locale] };
}

/**
 * The languages a read asked for `requested` involves: every configured
 * language for a read of every translation (`all`), else the language it
 * reads, as the read resolves it, followed by each language a missing value
 * falls back to, in the order the read tries them. A value shown from a
 * fallback language is that language's content, so a rule judging the read
 * is told it. A read does not take the write selector, `*`: asked for it, a
 * read resolves it to the default, so it is judged so.
 *
 * A read that also reads each language's translation state is told every
 * language, still showing the one it reads: a translation overview
 * (`translationStatus`) reads every language's state, and a language filter
 * (`_translated` in `where`) picks its rows by another language's. Every
 * language rather than the one a filter names, so the filter is read in one
 * place only, by the query that applies it.
 */
export function readLanguagesFor(
  cfg: SanitizedLocalizationConfig | undefined,
  requested: string | undefined,
  fallbackLocale?: string | false,
  asked: { translationStatus?: boolean; where?: unknown } = {}
): RuleLanguage {
  if (!cfg) return NO_LANGUAGE;
  if (requested === EVERY_TRANSLATION) return everyLanguageOf(cfg);
  const chain = resolveLocaleChain(cfg, requested, fallbackLocale);
  const read =
    !chain || chain.length === 0
      ? oneLanguage(cfg, requested)
      : { locale: chain[0], locales: chain };
  const readsStates =
    asked.translationStatus === true ||
    (isPlainObject(asked.where) && TRANSLATED_KEY in asked.where);
  return readsStates
    ? { locale: read.locale, locales: everyLanguageOf(cfg).locales }
    : read;
}

/**
 * The languages a write asked for `requested` involves: every configured
 * language for a write to every language (`*`), else the one language it
 * writes. A write does not take the read selector, `all`.
 */
export function writeLanguagesFor(
  cfg: SanitizedLocalizationConfig | undefined,
  requested: string | undefined
): RuleLanguage {
  if (!cfg) return NO_LANGUAGE;
  if (requested === EVERY_LOCALE) return everyLanguageOf(cfg);
  return oneLanguage(cfg, requested);
}

/**
 * {@link writeLanguagesFor}, for a write that keeps the language as the
 * request names it rather than resolving it: an autosave, and discarding a
 * working draft, which deletes the draft stored under that name. A language
 * the site does not configure is not the default it would resolve to, so it
 * is told every language.
 */
export function writeAsNamedLanguagesFor(
  cfg: SanitizedLocalizationConfig | undefined,
  requested: string | undefined
): RuleLanguage {
  if (
    cfg &&
    requested !== undefined &&
    requested !== EVERY_LOCALE &&
    !cfg.locales.some(locale => locale.code === requested)
  ) {
    return everyLanguageOf(cfg);
  }
  return writeLanguagesFor(cfg, requested);
}

/** What a collection, Single or field group declares about its languages. */
interface DeclaredContent {
  slug: string;
  localized?: boolean;
  fields?: readonly { type: string }[];
}

/** The parts of the registered configuration the languages are read from. */
interface RegisteredContent {
  localization?: SanitizedLocalizationConfig;
  collections?: readonly DeclaredContent[];
  singles?: readonly DeclaredContent[];
  fieldGroups?: readonly DeclaredContent[];
}

/** The configuration the services were registered with, if any yet. */
function registeredContent(): RegisteredContent | undefined {
  try {
    if (container.has("config")) {
      return container.get<RegisteredContent>("config");
    }
  } catch {
    // The container is not initialized; the site has no languages yet.
  }
  return undefined;
}

/**
 * The site's languages as they are now (`appLocalization`): the language
 * registry's list once services are registered, so a site whose languages are
 * stored in Settings rather than declared in its configuration tells its rules
 * every one of them, and the configuration's block before then. None before
 * anything is registered.
 */
function registeredLocalization(): SanitizedLocalizationConfig | undefined {
  try {
    return appLocalization();
  } catch {
    // The container is not initialized; the site has no languages yet.
    return undefined;
  }
}

/**
 * Whether what `target` stores differs by language, as the registered
 * configuration declares it: a collection or Single the site localizes, or one
 * with a field group that is localized, whose values a read shows in the
 * language it asks for; and a field group that is localized itself.
 * `undefined` where the configuration does not declare it: one built in the
 * admin, which holds no rule that could read a language.
 */
function storedByLanguage(target: AccessRuleTarget): boolean | undefined {
  const content = registeredContent();
  const declaredIn = {
    collection: content?.collections,
    single: content?.singles,
    component: content?.fieldGroups,
  }[target.kind];
  const declared = declaredIn?.find(entity => entity.slug === target.slug);
  if (declared === undefined) return undefined;
  if (declared.localized === true) return true;
  return (
    target.kind !== "component" &&
    hasLocalizedFieldGroup(declared, content?.fieldGroups ?? [])
  );
}

/**
 * Whether `declared` has a field group that is localized, at its top level
 * only, as the read populates them. A localized one missed here is judged as
 * content the same in every language, which is told every language.
 */
function hasLocalizedFieldGroup(
  declared: DeclaredContent,
  fieldGroups: readonly DeclaredContent[]
): boolean {
  const localizedGroups = new Set(
    fieldGroups.filter(group => group.localized === true).map(g => g.slug)
  );
  return (declared.fields ?? []).some(field => {
    if (!isFieldGroupFieldType(field.type)) return false;
    const { single, many } = extractFieldGroupReferences(field);
    return [single, ...(many ?? [])].some(
      group => group !== undefined && localizedGroups.has(group)
    );
  });
}

/**
 * `language`, for a rule judging what `target` stores. Content that is the
 * same in every language is told every language, with none judged alone: a
 * language the operation is in chooses nothing in it, so a rule admitting one
 * language must not admit it for the asking. Asked for each rule as its
 * context is built, so a related row or a field group is judged by its own
 * content, not by the entry it was reached from.
 */
export function languagesOfContent(
  target: AccessRuleTarget,
  language: RuleLanguage
): RuleLanguage {
  return storedByLanguage(target) === false ? everyLanguage() : language;
}

/** {@link readLanguagesFor}, on the site's registered configuration. */
export function registeredReadLanguagesFor(
  requested: string | undefined,
  fallbackLocale?: string | false,
  asked?: { translationStatus?: boolean; where?: unknown }
): RuleLanguage {
  return readLanguagesFor(
    registeredLocalization(),
    requested,
    fallbackLocale,
    asked
  );
}

/** {@link writeLanguagesFor}, on the site's registered configuration. */
export function registeredWriteLanguagesFor(
  requested: string | undefined
): RuleLanguage {
  return writeLanguagesFor(registeredLocalization(), requested);
}

/** {@link writeAsNamedLanguagesFor}, on the site's registered configuration. */
export function registeredWriteAsNamedLanguagesFor(
  requested: string | undefined
): RuleLanguage {
  return writeAsNamedLanguagesFor(registeredLocalization(), requested);
}

/** Every language `cfg` configures, with none judged alone. */
export function everyLanguageOf(
  cfg: SanitizedLocalizationConfig | undefined
): RuleLanguage {
  return cfg
    ? { locales: cfg.locales.map(locale => locale.code) }
    : NO_LANGUAGE;
}

/** Every configured language, with none judged alone. */
export function everyLanguage(): RuleLanguage {
  return everyLanguageOf(registeredLocalization());
}

/** Runs `operation` with its rules told `language`. */
export function withRuleLanguage<T>(
  language: RuleLanguage,
  operation: () => T
): T {
  return ruleLanguage.run(language, operation);
}

/**
 * The languages the current operation involves: those it set, or every
 * configured language where it set none.
 */
export function currentRuleLanguage(): RuleLanguage {
  return ruleLanguage.getStore() ?? everyLanguage();
}
