"use client";

/**
 * Each field's error as the Builder marks it (`builderFieldErrors`), with the server's refusals
 * of the draft's moves (`useSchemaSave`'s `refusedMoves`) among them: the page hands the refusals
 * down once, and the outline's rows and the field's settings read the errors here, rather than
 * through every component between the page and them.
 *
 * @module components/features/schema-builder/field-errors-context
 */
import { createContext, useContext, useMemo } from "react";

import {
  builderFieldErrors,
  type BuilderFieldError,
} from "@admin/lib/builder/field-validators";

import type { BuilderField } from "./types";

/** No refused move, as one constant so a page passing none keeps one value. */
export const NO_REFUSED_MOVES: ReadonlyMap<string, string> = new Map();

const RefusedMovesContext =
  createContext<ReadonlyMap<string, string>>(NO_REFUSED_MOVES);

/** Hands the Builder's parts the server's refusals of the draft's moves, by field id. */
export const RefusedMovesProvider = RefusedMovesContext.Provider;

/**
 * Every field's error, by field id, judged over the whole field tree (built-in fields included,
 * as the outline is built from) with each move the server refused: none outside a provider.
 */
export function useBuilderFieldErrors(
  fields: readonly BuilderField[]
): ReadonlyMap<string, BuilderFieldError> {
  const refusedMoves = useContext(RefusedMovesContext);
  return useMemo(
    () =>
      builderFieldErrors(
        fields.filter(field => !field.isSystem),
        fields,
        refusedMoves
      ),
    [fields, refusedMoves]
  );
}
