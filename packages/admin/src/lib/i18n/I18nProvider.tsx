"use client";

/**
 * The admin's interface language and catalogs, held for every screen, and
 * `useT()`, which a component translates its strings through.
 *
 * Outside any provider, `useT()` answers in English from the admin's own
 * catalog, so a component that renders before the provider does, such as an
 * error page, still reads correctly.
 *
 * @module lib/i18n/I18nProvider
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  BUILT_IN_CATALOGS,
  FALLBACK_INTERFACE_LANGUAGE,
  resolveInterfaceLanguage,
  translate,
  type Catalogs,
  type MessageKey,
  type MessageParams,
} from "./translate";

interface I18nValue {
  interfaceLanguage: string;
  catalogs: Catalogs;
}

const I18nContext = createContext<I18nValue>({
  interfaceLanguage: FALLBACK_INTERFACE_LANGUAGE,
  catalogs: BUILT_IN_CATALOGS,
});

/** Tells React when the browser's preferred language changes. */
function subscribeToLanguage(onChange: () => void): () => void {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

/**
 * The browser's most preferred language. The server has no browser to ask,
 * so it renders in English, and the page moves to the browser's language once
 * it is running there, without a mismatch while it hydrates.
 */
function useBrowserLanguage(): string {
  return useSyncExternalStore(
    subscribeToLanguage,
    () => navigator.language,
    () => FALLBACK_INTERFACE_LANGUAGE
  );
}

/**
 * Holds the interface language and catalogs for everything inside it.
 *
 * `interfaceLanguage` is the person's own choice, read first. Where it is
 * absent or the admin has no catalog for it, the browser's preferred language
 * is used where there is one for that, and English where there is not; a key
 * missing from the language in effect still reads its English. `catalogs`
 * defaults to the admin's own.
 */
export function I18nProvider({
  children,
  interfaceLanguage,
  catalogs = BUILT_IN_CATALOGS,
}: {
  children: ReactNode;
  interfaceLanguage?: string;
  catalogs?: Catalogs;
}): ReactNode {
  const browserLanguage = useBrowserLanguage();
  const value = useMemo(
    () => ({
      interfaceLanguage: resolveInterfaceLanguage(
        interfaceLanguage === undefined
          ? [browserLanguage]
          : [interfaceLanguage, browserLanguage],
        catalogs
      ),
      catalogs,
    }),
    [interfaceLanguage, browserLanguage, catalogs]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The translator for the interface language in effect: `t(key)`, or
 * `t(key, { name })` for a string that asks for parameters. Keys and their
 * parameters are checked against the English catalog.
 */
export function useT(): <K extends MessageKey>(
  key: K,
  ...params: MessageParams<K>
) => string {
  const { interfaceLanguage, catalogs } = useContext(I18nContext);
  return useCallback(
    <K extends MessageKey>(key: K, ...params: MessageParams<K>) =>
      translate(catalogs, interfaceLanguage, key, params[0]),
    [catalogs, interfaceLanguage]
  );
}

/**
 * @experimental The translator a plugin's admin component uses for its own
 * strings, declared in `contributes.translations`: `t("acme-shop.cart.title")`,
 * or `t(key, { count: 3 })` for a string with `{count}` in it.
 *
 * Read in the interface language in effect, then English, then the key
 * itself, as the admin's own strings are. The keys are the plugin's, so they
 * are not checked against the admin's catalog.
 */
export function usePluginTranslate(): (
  key: string,
  params?: Readonly<Record<string, string | number>>
) => string {
  const { interfaceLanguage, catalogs } = useContext(I18nContext);
  return useCallback(
    (key: string, params?: Readonly<Record<string, string | number>>) =>
      translate(catalogs, interfaceLanguage, key, params),
    [catalogs, interfaceLanguage]
  );
}

/**
 * Every interface language the admin has a catalog for, English first: what
 * a person may choose from. Read from the catalogs in effect, the admin's own
 * and every installed plugin's, so a language arrives with the catalog that
 * makes it readable.
 */
export function useInterfaceLanguages(): readonly string[] {
  const { catalogs } = useContext(I18nContext);
  return useMemo(
    () =>
      Object.keys(catalogs).sort((a, b) =>
        a === FALLBACK_INTERFACE_LANGUAGE
          ? -1
          : b === FALLBACK_INTERFACE_LANGUAGE
            ? 1
            : a.localeCompare(b)
      ),
    [catalogs]
  );
}
