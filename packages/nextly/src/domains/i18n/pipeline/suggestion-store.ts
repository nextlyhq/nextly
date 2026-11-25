/**
 * The open suggestions, kept and taken: one for each text of a document in one language, apart from
 * the document until a person accepts it.
 *
 * Nothing here asks who may do it, or writes a document: that is each operation's to decide.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/suggestion-store
 */

import { randomUUID } from "node:crypto";

import type {
  TransactionContext,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../../auth/request-actor";
import { NextlyError } from "../../../errors";
import {
  TRANSLATION_SUGGESTIONS_TABLE,
  type StoredSuggestionValue,
  type SuggestionOrigin,
} from "../../../schemas/translation-suggestions";
import { parsedValue } from "../../../shared/lib/json-column-value";
import { isPlainObject } from "../../../shared/lib/plain-copy";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";

import type { SuggestedDocument } from "./suggestion-rows";
import {
  parseUnitAddress,
  unitField,
  unitKey,
  type UnitAddress,
} from "./unit-address";

/** The text a suggestion is for: one of a document's, in one language. */
export interface SuggestedText {
  document: SuggestedDocument;
  targetLocale: string;
  address: UnitAddress;
}

/** A suggested translation, as it is submitted. */
export interface SuggestedTranslation {
  value: unknown;
  origin: SuggestionOrigin;
  engine?: string;
  model?: string;
  sourceLocale: string;
  /** A sha256 of the source text it was made from, in hex. */
  sourceFingerprint: string;
}

/** An open suggestion. */
export interface OpenSuggestion extends SuggestedText, SuggestedTranslation {
  /** Another for each suggestion, so a newer one in its place is never taken for it. */
  id: string;
  createdAt: Date;
}

/** A row as it is read; its JSON columns are text on some databases. */
interface StoredSuggestion extends SuggestedDocument {
  id: string;
  targetLocale: string;
  sourceLocale: string;
  unitAddress: unknown;
  value: unknown;
  origin: SuggestionOrigin;
  engine: string | null;
  model: string | null;
  sourceFingerprint: string;
  createdAt: Date;
}

const COLUMNS = [
  "id",
  "scopeKind",
  "scopeSlug",
  "entryId",
  "targetLocale",
  "sourceLocale",
  "unitAddress",
  "value",
  "origin",
  "engine",
  "model",
  "sourceFingerprint",
  "createdAt",
];

/** A row as an open suggestion; undefined for one whose address names no text. */
function suggestionOf(row: StoredSuggestion): OpenSuggestion | undefined {
  const address = parseUnitAddress(parsedValue(row.unitAddress));
  const stored = parsedValue(row.value);
  if (address === null || !isPlainObject(stored)) return undefined;
  const { scopeKind, scopeSlug, entryId } = row;
  return {
    id: row.id,
    document: { scopeKind, scopeSlug, entryId },
    targetLocale: row.targetLocale,
    address,
    value: stored.value,
    origin: row.origin,
    ...(row.engine === null ? {} : { engine: row.engine }),
    ...(row.model === null ? {} : { model: row.model }),
    sourceLocale: row.sourceLocale,
    sourceFingerprint: row.sourceFingerprint,
    createdAt: row.createdAt,
  };
}

/** The rows of one document, in one language where it is named. */
function documentConditions(
  { scopeKind, scopeSlug, entryId }: SuggestedDocument,
  targetLocale?: string
): WhereCondition[] {
  return [
    { column: "scopeKind", op: "=", value: scopeKind },
    { column: "scopeSlug", op: "=", value: scopeSlug },
    { column: "entryId", op: "=", value: entryId },
    ...(targetLocale === undefined
      ? []
      : [{ column: "targetLocale", op: "=" as const, value: targetLocale }]),
  ];
}

/** Who submitted a suggestion, as its row keeps it: a plugin-defined person by kind alone. */
function submittedBy(actor: RequestActor | undefined): {
  createdByKind: string | null;
  createdById: string | null;
  createdByPrincipalKind: string | null;
} {
  const principal = actor?.type === "principal";
  return {
    createdByKind: actor?.type ?? null,
    createdById: principal ? null : (actor?.id ?? null),
    createdByPrincipalKind: principal ? (actor.principal?.kind ?? null) : null,
  };
}

/** What a suggestion is kept through: each call in a transaction of its own. */
export interface SuggestionStoreDb {
  transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

/** What runs in the transaction that keeps a suggestion, on each try of it. */
export interface KeepingSteps {
  /** Before it is written; what it throws keeps nothing. */
  before?: (tx: TransactionContext) => Promise<void>;
  /** After it took the place of the one the text had. */
  onReplaced?: (tx: TransactionContext) => Promise<void>;
}

/**
 * Keeps a suggestion for a text, in the place of the one the text had, and answers its id. Two
 * submitted at once for one text leave one: whichever is written second takes the other's place,
 * as it would have a moment later.
 */
export async function keepSuggestion(
  db: SuggestionStoreDb,
  text: SuggestedText,
  suggestion: SuggestedTranslation,
  by: RequestActor | undefined,
  now: Date = new Date(),
  { before, onReplaced }: KeepingSteps = {}
): Promise<string> {
  const id = randomUUID();
  const key = unitKey(text.address);
  const where = {
    and: [
      ...documentConditions(text.document, text.targetLocale),
      { column: "unitKey", op: "=" as const, value: key },
    ],
  };
  const stored: StoredSuggestionValue = { value: suggestion.value };
  const said = {
    id,
    fieldPath: unitField(text.address),
    unitAddress: text.address,
    value: stored,
    origin: suggestion.origin,
    engine: suggestion.engine ?? null,
    model: suggestion.model ?? null,
    sourceLocale: suggestion.sourceLocale,
    sourceFingerprint: suggestion.sourceFingerprint,
    ...submittedBy(by),
    createdAt: now,
  };
  const keep = () =>
    db.transaction(async tx => {
      await before?.(tx);
      const replaced = await tx.updateCount(
        TRANSLATION_SUGGESTIONS_TABLE,
        said,
        where
      );
      if (replaced > 0) {
        await onReplaced?.(tx);
        return;
      }
      await tx.insert(TRANSLATION_SUGGESTIONS_TABLE, {
        ...text.document,
        targetLocale: text.targetLocale,
        unitKey: key,
        ...said,
      });
    });
  try {
    await keep();
  } catch (error) {
    // Another was kept between the two statements: it is there to replace now. Tried in a
    // transaction of its own, since a refused insert ends the first one.
    if (!isUniqueViolation(error)) throw error;
    await keep();
  }
  return id;
}

/** A document's open suggestions in one language, each by its text's key. */
export async function openSuggestions(
  db: Pick<TransactionContext, "select">,
  document: SuggestedDocument,
  targetLocale: string
): Promise<Map<string, OpenSuggestion>> {
  const rows = await db.select<StoredSuggestion>(
    TRANSLATION_SUGGESTIONS_TABLE,
    {
      columns: COLUMNS,
      where: { and: documentConditions(document, targetLocale) },
    }
  );
  return new Map(
    rows.flatMap(row => {
      const suggestion = suggestionOf(row);
      return suggestion === undefined
        ? []
        : [[unitKey(suggestion.address), suggestion] as const];
    })
  );
}

/**
 * Takes an open suggestion out, on `tx`: what accepting and dismissing it both end in. Refused where
 * it is not there any more, so of two people who take it at once one does, and an accept whose
 * suggestion was replaced since it was shown writes nothing.
 */
export async function takeSuggestion(
  tx: Pick<TransactionContext, "delete">,
  { document, id }: Pick<OpenSuggestion, "document" | "id">
): Promise<void> {
  const taken = await tx.delete(TRANSLATION_SUGGESTIONS_TABLE, {
    and: [
      ...documentConditions(document),
      { column: "id", op: "=", value: id },
    ],
  });
  if (taken === 1) return;
  throw NextlyError.conflict({
    reason: "state",
    message:
      "This suggestion was replaced or taken since it was shown. Reload it and try again.",
    logContext: { reason: "suggestion-gone", ...document, id },
  });
}
