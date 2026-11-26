"use client";

/**
 * Change type… as the Builder page opens it on a field: the page hands it down once, and the
 * field's settings offer it where the field's type can change (`changeTypeOffered`), rather than
 * through every component between the page and them. Outside a provider there is none, and no
 * Change type… is offered.
 *
 * @module components/features/schema-builder/change-type-context
 */
import { createContext, useContext } from "react";

const ChangeTypeContext = createContext<
  ((fieldId: string) => void) | undefined
>(undefined);

/** Hands the Builder's parts the page's way of opening Change type… on a field. */
export const ChangeTypeProvider = ChangeTypeContext.Provider;

/** Opens Change type… on a field; undefined outside a Builder page that offers it. */
export function useOpenChangeType(): ((fieldId: string) => void) | undefined {
  return useContext(ChangeTypeContext);
}
