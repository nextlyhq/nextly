"use client";

/**
 * Renders every installed plugin's contributed schema-builder slot above the
 * field list in the collection/single builders. Generic — it iterates
 * `branding.plugins[].schemaBuilderSlot` and renders each via `PluginSlot`; no
 * plugin is named here. A plugin's slot component receives the builder's field
 * list + setter so it can add builder-time controls (e.g. an editor-choice
 * toggle) that mutate the fields.
 *
 * @module components/features/schema-builder/SchemaBuilderSlots
 */
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";

export interface SchemaBuilderSlotField {
  id: string;
  name?: string;
  type?: string;
}

export function SchemaBuilderSlots<T extends SchemaBuilderSlotField>({
  fields,
  setFields,
  disabled,
  context,
}: {
  fields: T[];
  setFields: (fields: T[]) => void;
  disabled?: boolean;
  context: "collection" | "single";
}) {
  const branding = useBranding();
  const slots = (branding.plugins ?? []).filter(p => p.schemaBuilderSlot);
  if (slots.length === 0) return null;
  return (
    <>
      {slots.map(p => (
        <PluginSlot
          key={p.name}
          path={p.schemaBuilderSlot as string}
          props={{ fields, setFields, disabled, context }}
        />
      ))}
    </>
  );
}
