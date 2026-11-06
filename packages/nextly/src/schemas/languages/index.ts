/**
 * The site's stored content languages, per dialect.
 *
 * @module schemas/languages
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export * from "./table-name";
export * from "./types";

export function languagesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyLanguages } = loadedDialect(dialect).tables;
  return { nextlyLanguages };
}
