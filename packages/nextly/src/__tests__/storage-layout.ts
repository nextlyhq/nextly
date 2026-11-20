/**
 * The storage layout the test suites run on.
 *
 * Every installation keeps its translatable fields per language, and nothing a site configures
 * changes that. Most suites, though, were written while the earlier layout (translatable values on
 * the main tables) was the default, and a site chose per-language storage with
 * `experimental.perLanguageStorage`. They run as they always ran: on the earlier layout, through
 * the test-only hook (`setPerLanguageStorage`), with a boot that passes `perLanguageStorage: true`
 * to `createTestNextly` getting per-language storage, as that setting gave it then.
 *
 * A suite written for per-language storage as every installation now runs it calls
 * `perLanguageStorageSuite()` once at its top: it runs on per-language storage, as production does,
 * and the setting it may pass is ignored, as production ignores it.
 *
 * `setup.ts` applies this at the start of every test file and before each test. A follow-up moves
 * the older suites to per-language storage and removes the hook with the earlier layout's code.
 *
 * @module __tests__/storage-layout
 */
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../domains/i18n/per-language-storage";

/**
 * Whether the running test file opted into per-language storage, and the layout its tests start on:
 * the file's, or the one its latest boot asked for. On `globalThis`, as the hook is.
 */
const harness = globalThis as {
  __nextly_testPerLanguageSuite?: boolean;
  __nextly_testLayoutPerLanguage?: boolean;
};

/** Puts `perLanguage` in force and remembers it as the layout the file's tests start on. */
function useLayout(perLanguage: boolean): void {
  harness.__nextly_testLayoutPerLanguage = perLanguage;
  if (perLanguage) _resetPerLanguageStorage();
  else setPerLanguageStorage(false);
}

/**
 * Called once at the top of a suite written for per-language storage as every installation runs
 * it: its tests run on per-language storage, and a `perLanguageStorage` passed to
 * `createTestNextly` is ignored, as production ignores the setting.
 */
export function perLanguageStorageSuite(): void {
  harness.__nextly_testPerLanguageSuite = true;
  useLayout(true);
}

/** `setup.ts`, at the start of each test file: the earlier layout until the file opts in. */
export function startTestFile(): void {
  harness.__nextly_testPerLanguageSuite = false;
  useLayout(false);
}

/**
 * `setup.ts`, before each test: the layout its file or its file's latest boot chose, whatever the
 * test before it set through the hook. A suite booted once for all its tests keeps its boot's.
 */
export function startTest(): void {
  useLayout(harness.__nextly_testLayoutPerLanguage === true);
}

/**
 * `setup.ts`, around `createTestNextly`: the layout a boot of an older suite asks for with
 * `perLanguageStorage`, as the setting chose it when that suite was written. A suite that opted in
 * keeps per-language storage whatever it passes.
 */
export function layoutForBoot(perLanguageStorage: unknown): void {
  if (harness.__nextly_testPerLanguageSuite === true) return;
  if (perLanguageStorage === true) useLayout(true);
  else if (perLanguageStorage === false) useLayout(false);
}
