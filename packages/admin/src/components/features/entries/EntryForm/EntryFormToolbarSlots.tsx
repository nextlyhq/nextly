"use client";

/**
 * Renders every installed plugin's contributed entry-form toolbar slot in the
 * entry/single form header. Generic — it iterates
 * `branding.plugins[].entryFormToolbarSlot` and renders each via `PluginSlot`;
 * no plugin is named here.
 *
 * `controllerField` is the form field a takeover field's condition watches
 * (derived generically from the collection's schema). This component owns the
 * react-hook-form access and hands the slot a plain `{ value, onChange }` pair
 * for that field, so the plugin component stays presentational and never needs
 * its own react-hook-form instance (which could resolve to a different context).
 * When `controllerField` is undefined the collection has no takeover field, so
 * the slot renders nothing to control.
 *
 * @module components/features/entries/EntryForm/EntryFormToolbarSlots
 */
import { useFormContext, useWatch } from "react-hook-form";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useBranding } from "@admin/context/providers/BrandingProvider";

export function EntryFormToolbarSlots({
  context,
  controllerField,
}: {
  context: "collection" | "single";
  controllerField?: string;
}) {
  const branding = useBranding();
  const form = useFormContext();
  // Subscribe to the controller field's value so the toolbar reflects it. Hooks
  // must run unconditionally; watch a harmless key when there's no controller.
  const watched = useWatch({
    control: form?.control,
    name: controllerField ?? "__nextly_noop__",
  });

  const slots = (branding.plugins ?? []).filter(p => p.entryFormToolbarSlot);
  if (slots.length === 0) return null;

  const value = controllerField ? watched : undefined;
  const onChange = (next: unknown) => {
    if (controllerField && form) {
      form.setValue(controllerField, next, { shouldDirty: true });
    }
  };

  return (
    <>
      {slots.map(p => (
        <PluginSlot
          key={p.name}
          path={p.entryFormToolbarSlot as string}
          props={{ context, controllerField, value, onChange }}
        />
      ))}
    </>
  );
}
