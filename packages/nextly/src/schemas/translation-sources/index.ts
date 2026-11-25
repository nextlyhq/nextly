/**
 * `nextly_translation_sources`: the source text each translation was made from.
 *
 * @module schemas/translation-sources
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { TRANSLATION_SOURCES_TABLE } from "./table-name";
export type { KeptSource } from "./types";

export function translationSourcesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyTranslationSources } = loadedDialect(dialect).tables;
  return { nextlyTranslationSources };
}
