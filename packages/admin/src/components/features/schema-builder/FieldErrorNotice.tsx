"use client";

/**
 * What the edited field lacks that its type needs, at the top of its settings panel: the error
 * its row is marked with and the save refuses it for, read from the same map
 * (`builderFieldErrors`), judged over the same fields the outline judges, so the panel, the row
 * and the save always agree.
 */
import { type JSX, useMemo } from "react";

import { builderFieldErrors } from "@admin/lib/builder/field-validators";

import type { BuilderField } from "./types";

export function FieldErrorNotice({
  fields,
  fieldId,
}: {
  /** The whole field tree, built-in fields included, as the outline is built from. */
  fields: readonly BuilderField[];
  fieldId: string;
}): JSX.Element | null {
  const error = useMemo(
    () =>
      builderFieldErrors(
        fields.filter(field => !field.isSystem),
        fields
      ).get(fieldId),
    [fields, fieldId]
  );
  if (!error) return null;
  return (
    <div
      role="alert"
      className="border-b border-border px-4 py-2 text-sm text-destructive"
    >
      {error.message}
    </div>
  );
}
