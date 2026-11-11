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
import type {
  FieldGroupsLoad,
  LoadedFieldGroup,
} from "@admin/lib/builder/outline/outline-model";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderKind } from "../builder-config";
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

/**
 * The fields the entry form draws, in its order. A collection's or Single's
 * form draws its built-in fields too (title, slug); a field group has none of
 * its own, since it is drawn inside another entity's form.
 */
function formFields(
  kind: BuilderKind,
  fields: readonly BuilderField[]
): BuilderField[] {
  return kind === "field-group"
    ? fields.filter(field => !field.isSystem)
    : [...fields];
}

export function FormPreview({
  kind,
  fields,
  fieldGroups,
  fieldGroupsLoad,
}: {
  kind: BuilderKind;
  /** The entity's fields, as they stand now, its built-in ones included. */
  fields: readonly BuilderField[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  fieldGroupsLoad: FieldGroupsLoad;
}): JSX.Element {
  const definitions = useMemo(
    () =>
      withFieldGroups(
        formFields(kind, fields).map(convertToFieldDefinition),
        fieldGroups
      ),
    [kind, fields, fieldGroups]
  );
  return (
    <div className="space-y-3">
      {/* Said, so a form missing a field group's fields is not taken for the
          whole form. */}
      {fieldGroupsLoad !== "loaded" && (
        <p role="status" className="text-sm text-muted-foreground">
          {fieldGroupsLoad === "loading"
            ? "Loading the field groups this form uses…"
            : "The field groups this form uses could not be loaded, so their fields are not shown."}
        </p>
      )}
      <ReadOnlyDocumentForm
        fields={definitions as unknown as FieldConfig[]}
        values={{}}
        mode="create"
      />
    </div>
  );
}
