/**
 * The preview-link table - dialect-aware barrel.
 *
 * @module schemas/preview-links
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export * from "./types";

/** Returns the Drizzle table object for recorded preview links. */
export function previewLinksTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyPreviewLinks } = loadedDialect(dialect).tables;
  return { nextlyPreviewLinks };
}
