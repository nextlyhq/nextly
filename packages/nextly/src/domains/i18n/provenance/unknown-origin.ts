/**
 * Recording a value whose origin was never recorded: one written before origins were, which
 * something made from it, or a review of it, now has to name by its fingerprint.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/unknown-origin
 */
import { randomUUID } from "node:crypto";

import {
  TRANSLATION_PROVENANCE_TABLE,
  type ProvenanceOrigin,
  type ProvenancePartState,
} from "../../../schemas/translation-provenance";

import type { SourceDocument, SourceTextDb } from "./source-text";

/** The value recorded: its language, field and fingerprint, and the source it is held to, if any. */
export interface UnrecordedValue {
  locale: string;
  fieldPath: string;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/**
 * Records a live value as of unknown origin, on `db`, the write's own transaction. A record made
 * for it meanwhile stands.
 */
export async function recordUnknownOrigin(
  db: Pick<SourceTextDb, "upsert">,
  document: SourceDocument,
  value: UnrecordedValue,
  now: Date
): Promise<void> {
  const { scopeKind, scopeSlug, entryId } = document;
  await db.upsert(
    TRANSLATION_PROVENANCE_TABLE,
    {
      id: randomUUID(),
      scopeKind,
      scopeSlug,
      entryId,
      ...value,
      partState: "live" satisfies ProvenancePartState,
      origin: "unknown" satisfies ProvenanceOrigin,
      engine: null,
      actorKind: null,
      actorId: null,
      actorPrincipalKind: null,
      originRowId: null,
      writtenAt: now,
    },
    {
      conflictColumns: [
        "scopeKind",
        "scopeSlug",
        "entryId",
        "locale",
        "partState",
        "fieldPath",
      ],
      updateColumns: [],
    }
  );
}
