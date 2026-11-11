"use client";

/**
 * The entry form as editors will see it, drawn from the fields as they stand
 * now, pending changes included: each field at its width, hidden ones hidden,
 * conditions applied. Nothing in it can be typed into.
 *
 * It is the entry form itself (`ReadOnlyDocumentForm`), handed the same
 * definitions a save would send, so the preview and the form cannot draw a
 * field differently.
 */
import type { FieldConfig } from "nextly/config";
import { extractFieldGroupReferences } from "nextly/field-group-type";
import type { JSX } from "react";
import { useMemo } from "react";

import { ReadOnlyDocumentForm } from "@admin/components/features/entries/EntryForm/ReadOnlyDocumentForm";
import { convertToFieldDefinition } from "@admin/lib/builder";
import type { LoadedFieldGroup } from "@admin/lib/builder/outline/outline-model";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderField } from "../types";

/**
 * Hand each field-group field the fields of the field groups it uses, as the
 * server does when it serves an entry form, so the preview can draw them.
 * `seen` stops a field group that uses itself.
 */
function withFieldGroups(
  definitions: readonly FieldDefinition[],
  groups: ReadonlyMap<string, LoadedFieldGroup>,
  seen: readonly string[] = []
): FieldDefinition[] {
  return definitions.map(definition => {
    const nested = definition.fields
      ? withFieldGroups(definition.fields, groups, seen)
      : undefined;
    const refs = extractFieldGroupReferences(definition);
    const resolve = (slug: string) => {
      const group = groups.get(slug);
      return group && !seen.includes(slug)
        ? withFieldGroups(group.fields, groups, [...seen, slug])
        : [];
    };
    const resolved: Record<string, unknown> = {};
    if (refs.single !== undefined) {
      resolved.componentFields = resolve(refs.single);
    } else if (refs.many && refs.many.length > 0) {
      resolved.componentSchemas = Object.fromEntries(
        refs.many.map(slug => [
          slug,
          { label: groups.get(slug)?.label ?? slug, fields: resolve(slug) },
        ])
      );
    }
    return {
      ...definition,
      ...(nested ? { fields: nested } : {}),
      ...resolved,
    };
  });
}

export function FormPreview({
  fields,
  fieldGroups,
}: {
  /** The entity's own fields, as they stand now. */
  fields: readonly BuilderField[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
}): JSX.Element {
  const definitions = useMemo(
    () =>
      withFieldGroups(
        fields.filter(field => !field.isSystem).map(convertToFieldDefinition),
        fieldGroups
      ),
    [fields, fieldGroups]
  );
  return (
    <ReadOnlyDocumentForm
      fields={definitions as unknown as FieldConfig[]}
      values={{}}
      mode="create"
    />
  );
}
