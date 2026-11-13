/**
 * `nextly_translation_provenance`: where each translated value came from.
 *
 * @module schemas/translation-provenance
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { TRANSLATION_PROVENANCE_TABLE } from "./table-name";
export type {
  ProvenanceOrigin,
  ProvenancePartState,
  ProvenanceScopeKind,
} from "./types";

export function translationProvenanceTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyTranslationProvenance } = loadedDialect(dialect).tables;
  return { nextlyTranslationProvenance };
}
