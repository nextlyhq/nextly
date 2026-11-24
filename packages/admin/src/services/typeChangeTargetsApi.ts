/**
 * The Schema Builder's type picker asks the server what each other type would do to a saved
 * field's values (`type-change-targets`, on each kind's schema routes).
 *
 * @module services/typeChangeTargetsApi
 */
import { protectedApi } from "@admin/lib/api/protectedApi";
import type { FieldDefinition } from "@admin/types/collection";

import type { ListResponse } from "../lib/api/response-types";

/** One type a saved field may be changed to, as the server judges it (`type-change-targets`). */
export interface TypeChangeTarget {
  type: string;
  /** Why the save refuses the change whatever the values hold; null where it does not. */
  blocked: string | null;
  /** For a change a translation rule of the save refuses, the save's own words. */
  refusal: { code: string; reason: string; steps: string[] } | null;
  /** What the change can do to the field's values; null where it is blocked. */
  outcome: "keeps" | "converts" | "may-lose" | null;
}

/** A type the picker offers, and the field as the change to it would be saved. */
export interface TypeChangeCandidate {
  type: string;
  field: FieldDefinition;
}

/** The settings a field was saved with that decide the answer, as the page loaded them. */
export interface SavedFieldSettings {
  hasMany: boolean;
  unique: boolean;
  /** Undefined where the saved definition does not say. */
  localized: boolean | undefined;
  /** The values of its options. */
  options: readonly string[];
  /** The rules its values are held to, Required among them. */
  validation: Readonly<Record<string, unknown>>;
  /** What is stated on the field itself that the Builder carries as it is, a rule among them. */
  own: Readonly<Record<string, unknown>>;
}

/** The saved field the picker asks about: where it is saved, its type there, and what is offered. */
export interface TypeChangeQuestion {
  /** Its holders' names, then its own, as saved. */
  path: readonly string[];
  /** Its type as the page knows it saved: an answer about another is refused. */
  type: string;
  /** Its settings as the page knows them saved: an answer about others is refused. */
  saved: SavedFieldSettings;
  /** Each type the picker offers, with the field the change to it would save. */
  candidates: readonly TypeChangeCandidate[];
}

/**
 * What each candidate type would do to the saved field the picker asks about (`question`), of the
 * entity at `address` (`/collections/schema/posts`).
 */
export async function typeChangeTargetsAt(
  address: string,
  question: TypeChangeQuestion
): Promise<TypeChangeTarget[]> {
  const result = await protectedApi.post<ListResponse<TypeChangeTarget>>(
    `${address}/type-change-targets`,
    {
      field: [...question.path],
      type: question.type,
      saved: { ...question.saved },
      candidates: question.candidates.map(candidate => ({ ...candidate })),
    }
  );
  return result.items;
}
