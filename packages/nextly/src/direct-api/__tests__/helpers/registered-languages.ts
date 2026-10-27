/**
 * A language registry registered in the container, over a stored list the test changes the way
 * Settings on another instance would. Its interval is zero, so every unpinned refresh reads.
 */
import { container } from "../../../di/container";
import type { StoredLanguage } from "../../../domains/i18n/config/stored-languages";
import { LanguageRegistry } from "../../../domains/i18n/language-registry";

export function storedLanguage(code: string, position: number): StoredLanguage {
  return {
    code,
    label: code,
    direction: "ltr",
    fallback: "[]",
    position,
    isDefault: position === 0,
    active: true,
  };
}

export function registeredLanguages(codes: string[]) {
  let rows = codes.map(storedLanguage);
  let revision = 1;
  const registry = new LanguageRegistry({
    reader: {
      fingerprint: async () => `${rows.length}:${revision}`,
      rows: async () => rows,
    },
    ttlMs: 0,
  });
  container.registerSingleton("languageRegistry", () => registry);
  return {
    registry,
    /** The language codes the registry answers with now. */
    codes: () => registry.current()?.locales.map(locale => locale.code),
    /** Stores `next` as another instance's Settings would. */
    store(next: string[]) {
      rows = next.map(storedLanguage);
      revision += 1;
    },
  };
}
