"use client";

/**
 * The outline of the fields a builder page is editing, with the field groups
 * it uses: built once per page, and read by both the outline and the
 * settings panel, so the two answer every question about a row alike.
 */
import { useMemo } from "react";

import { useOutlineFieldGroups } from "@admin/hooks/useOutlineFieldGroups";
import {
  buildOutline,
  type LoadedFieldGroup,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import type { BuilderField } from "../types";

export function useBuilderOutline(
  fields: readonly BuilderField[],
  entityReadOnly: boolean
): {
  outline: readonly OutlineNode[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
} {
  const fieldGroups = useOutlineFieldGroups(fields);
  const outline = useMemo(
    () => buildOutline(fields, { entityReadOnly, fieldGroups }),
    [fields, entityReadOnly, fieldGroups]
  );
  return { outline, fieldGroups };
}
