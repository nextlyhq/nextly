/**
 * What a hook is told about languages: the language its operation is for,
 * every language it involves, and whether it moves the shared part (the
 * fields kept the same in every language).
 *
 * The languages are the ones the operation's rules are told
 * (`currentRuleLanguage`), set once where the operation enters, so a hook and
 * a rule cannot be told different languages. Whether the shared part moves is
 * known only to the write that decides it, which says so with
 * {@link withWriteParts}, and once more with {@link settleWriteParts} when
 * its hooks have made the payload it persists; a read moves nothing and says
 * nothing, even one made inside a write's hook.
 *
 * Added where a handler is called rather than where its context is built, as
 * the principal is (`withCurrentPrincipal`): contexts are built in many places
 * and handlers are called in few, and a value read at the call is the one
 * true for that call, a publish's run for one language included.
 *
 * @module hooks/hook-language
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { currentRuleLanguage } from "../auth/access/rule-language";
import { resolveLocalizedFieldNames } from "../domains/i18n/classify-fields";
import { EVERY_LOCALE } from "../domains/i18n/locale-selector";

/** Whether a write moves the shared part, as the write decided it. */
export interface WriteParts {
  readonly shared: boolean;
}

/**
 * One write's parts. Held in a frame of its own rather than as the stored
 * value, so the write can settle them once its payload is final
 * (`settleWriteParts`) for everything after that point, while what its
 * before-hooks were told stays what they were told.
 */
interface WritePartsFrame {
  parts: WriteParts;
}

const writeParts = new AsyncLocalStorage<WritePartsFrame>();

/** Runs `operation` with its hooks told whether it moves the shared part. */
export function withWriteParts<T>(parts: WriteParts, operation: () => T): T {
  return writeParts.run({ parts }, operation);
}

/**
 * Settles what the write running now moves, from the payload it persists: a
 * hook or the field rules can add or take out a field the body named, so the
 * hooks after the write and its events are told `parts` instead of what the
 * body sent. A no-op outside a write.
 */
export function settleWriteParts(parts: WriteParts): void {
  const frame = writeParts.getStore();
  if (frame !== undefined) frame.parts = parts;
}

/**
 * What a create or a delete moves: the shared part, which a create writes
 * with its language's and a delete removes with every language's.
 */
export const WHOLE_DOCUMENT: WriteParts = Object.freeze({ shared: true });

/** What a write's entity says about which of its fields are shared. */
export interface SharedPartOf {
  /**
   * Whether the entity has a lifecycle (`status: true`): only then is a
   * `status` key the lifecycle status, and otherwise a field like any other.
   */
  hasLifecycle: boolean;
  /** The entity's fields, classified as the write classifies them. */
  fields: readonly {
    name: string;
    type: string;
    localized?: boolean;
    virtual?: boolean;
    options?: unknown;
  }[];
  /** Whether the entity keeps translations at all. */
  localized: boolean;
  /** Whether each language is published on its own (`publishesPerLanguage`). */
  publishesPerLanguage: boolean;
  /** The site's default language, whose status is the shared part's. */
  defaultLocale: string | undefined;
}

/**
 * Whether an update of `body` in `locale` moves the shared part: it sets a
 * field kept the same in every language, or it names a lifecycle status the
 * shared part takes, which is every status on an entity that does not publish
 * each language on its own, and otherwise the default language's or every
 * language's. On an entity with no lifecycle a `status` key is a field like
 * any other, shared or translated as it is declared. Keys beginning with `_`
 * are instructions to the write, not values, and move nothing.
 */
export function writeMovesSharedPart(
  entity: SharedPartOf,
  body: Record<string, unknown>,
  locale: string | undefined
): boolean {
  const translated = new Set(
    resolveLocalizedFieldNames([...entity.fields], entity.localized)
  );
  const isLifecycleStatus = (key: string) =>
    entity.hasLifecycle && key === "status";
  const setsShared = Object.keys(body).some(
    key =>
      !key.startsWith("_") && !isLifecycleStatus(key) && !translated.has(key)
  );
  if (setsShared) return true;
  if (!entity.hasLifecycle || !("status" in body)) return false;
  return (
    !entity.publishesPerLanguage ||
    locale === undefined ||
    locale === EVERY_LOCALE ||
    locale === entity.defaultLocale
  );
}

/** The languages and parts a hook is told. */
export interface HookLanguage {
  /** The language the operation is for; absent for one of every language. */
  locale?: string;
  /** Every language the operation involves. */
  locales: readonly string[];
  /** Whether it moves the shared part; absent for a read. */
  shared?: boolean;
}

/**
 * What a hook called now is told about languages. `locales` is a copy of its
 * own, so a hook that changes the list it is handed changes nothing another
 * hook, a rule or an event is told.
 */
export function hookLanguage(): HookLanguage {
  const language = currentRuleLanguage();
  const parts = writeParts.getStore()?.parts;
  return {
    ...(language.locale === undefined ? {} : { locale: language.locale }),
    locales: [...language.locales],
    ...(parts === undefined ? {} : { shared: parts.shared }),
  };
}

/**
 * What an event recorded now says about languages: what a hook called at the
 * same point is told, so an event and the hooks of one change cannot name
 * different languages. `undefined` on a site without languages, where there
 * is no language to name and no part apart from the rest.
 */
export function eventLanguage(): HookLanguage | undefined {
  const language = hookLanguage();
  return language.locales.length === 0 ? undefined : language;
}

/**
 * `context` with what a hook called now is told about languages. A hook of a
 * read (`operation: "read"`) is told nothing of the shared part: a read moves
 * nothing, and one made inside a write's hook runs in that write's frame.
 */
export function withHookLanguage<C extends { operation?: unknown }>(
  context: C
): C & Partial<HookLanguage> {
  // A site without languages tells a hook nothing of them, so its context
  // keeps the shape it had: the same answer an event gives (`eventLanguage`).
  const language = eventLanguage();
  if (language === undefined) return { ...context };
  if (context.operation !== "read") return { ...context, ...language };
  return {
    ...context,
    ...(language.locale === undefined ? {} : { locale: language.locale }),
    locales: language.locales,
  };
}
