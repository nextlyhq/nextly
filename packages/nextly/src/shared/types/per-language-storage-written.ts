/**
 * What a configuration wrote of `experimental.perLanguageStorage`, kept off the published
 * `SanitizedNextlyConfig` type. The setting chooses no layout any longer and the sanitized config
 * always says `perLanguageStorage: true`; only the start's deprecation warning needs to know
 * whether a site still writes it, so the sanitizer records that under a symbol rather than a new
 * public property. The symbol is registered (`Symbol.for`), so every copy of this module a server
 * loads reads the same one, and the property is enumerable, so a spread copy of the config keeps it.
 *
 * @internal
 * @module shared/types/per-language-storage-written
 */

const WRITTEN = Symbol.for("nextly.perLanguageStorageWritten");

/** What `config` records the configuration wrote of the setting; `undefined` where it wrote none. */
export function perLanguageStorageWritten(config: object): boolean | undefined {
  const written = (config as Record<symbol, unknown>)[WRITTEN];
  return typeof written === "boolean" ? written : undefined;
}

/** Records on `config` what the configuration wrote of the setting; nothing where it wrote none. */
export function recordPerLanguageStorageWritten<T extends object>(
  config: T,
  written: unknown
): T {
  if (typeof written === "boolean") {
    (config as Record<symbol, unknown>)[WRITTEN] = written;
  }
  return config;
}
