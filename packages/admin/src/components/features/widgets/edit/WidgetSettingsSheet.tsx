/**
 * What one reader may change about one card.
 *
 * 🔴 Keyed by PLACEMENT, not by widget. The same widget can sit on a dashboard
 * twice — a "recent entries" card for posts beside one for pages — and settings
 * belong to the card the reader is looking at, not to the definition behind it.
 * Every save goes through `setConfig(placementId, …)` for that reason.
 *
 * The form is drawn by `FieldRenderer`, the same component the entry editor
 * uses, because a widget setting IS a field definition. A reader meets the
 * inputs they already know, and a plugin author gets a settings form without
 * writing one.
 */
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import type { WidgetSetting } from "nextly/config";
import { useCallback, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";

export interface WidgetSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The card being configured, for the heading a reader reads. */
  title: string;
  settings: WidgetSetting[];
  /** What this placement has stored, if anything. */
  config: Record<string, unknown> | undefined;
  onSave: (config: Record<string, unknown>) => void;
}

/**
 * The values the form opens with.
 *
 * 🔴 Built from the DECLARATION rather than from the stored config, so a
 * setting the reader has never touched still opens at its default instead of
 * blank — and a key the declaration no longer knows about does not appear as a
 * ghost field. This mirrors `resolveWidgetSettings` on purpose: what the form
 * shows is what the card is actually using.
 */
export function initialValues(
  settings: readonly WidgetSetting[],
  config: Record<string, unknown> | undefined
): Record<string, unknown> {
  /*
   * 🔴 Prototype-free, because the KEYS are setting names a plugin chose. On a
   * `{}` dictionary `__proto__` is not data: assigning it invokes the legacy
   * prototype setter, so a setting of that name never reached the form and
   * opened blank instead of at its default. `resolveWidgetSettings` is
   * prototype-free for the same reason, and this function exists to mirror it.
   */
  const values: Record<string, unknown> = Object.create(null);
  for (const setting of settings) {
    const stored = config?.[setting.name];
    values[setting.name] = stored ?? setting.defaultValue ?? "";
  }
  return values;
}

/**
 * What to store, given what the form holds.
 *
 * 🔴 A value equal to its declared default is DROPPED rather than written. The
 * stored config is the reader's departure from the author's intent, so writing
 * the default back would pin today's default forever — a card would stop
 * following a later change to it, silently, and only for readers who happened
 * to open the panel.
 */
export function toStoredConfig(
  settings: readonly WidgetSetting[],
  values: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
): Record<string, unknown> {
  const stored: Record<string, unknown> = Object.create(null);

  /*
   * 🔴 A stored key the declaration does not know is CARRIED, not dropped.
   * `resolveWidgetSettings` keeps such a key deliberately — a plugin that
   * renames a setting or is uninstalled must not cost a reader the values they
   * chose, because reinstalling it restores them. This form is built from the
   * DECLARATION, so it never sees those keys; rebuilding the config from it
   * alone, and writing that back over the whole `config`, discarded exactly
   * what the reading layer went out of its way to preserve. Opening the panel
   * and pressing Save was enough to lose them.
   */
  const declared = new Set(settings.map(setting => setting.name));
  for (const key of Object.keys(existing ?? {})) {
    if (!declared.has(key)) stored[key] = existing?.[key];
  }

  for (const setting of settings) {
    /*
     * 🔴 Read through `hasOwn`, not by indexing. `values` comes back from the
     * form, and on an ordinary object `values["__proto__"]` answers
     * `Object.prototype` rather than `undefined` — so a setting of that name
     * passed both guards below and was written to storage as the prototype
     * object, for a field the reader never filled in.
     */
    if (!Object.hasOwn(values, setting.name)) continue;
    const value = values[setting.name];
    if (value === undefined || value === "") continue;
    if (value === setting.defaultValue) continue;
    stored[setting.name] = value;
  }
  return stored;
}

export function WidgetSettingsSheet({
  open,
  onOpenChange,
  title,
  settings,
  config,
  onSave,
}: WidgetSettingsSheetProps) {
  const defaultValues = useMemo(
    () => initialValues(settings, config),
    [settings, config]
  );

  const form = useForm({ defaultValues });

  const submit = useCallback(
    (values: Record<string, unknown>) => {
      onSave(toStoredConfig(settings, values, config));
      onOpenChange(false);
    },
    [onSave, onOpenChange, settings, config]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title} settings</SheetTitle>
          <SheetDescription>
            These apply to this card only. Another copy of the same widget keeps
            its own.
          </SheetDescription>
        </SheetHeader>

        <FormProvider {...form}>
          <form
            // `handleSubmit` answers with a promise and `onSubmit` expects
            // nothing back, so the result is voided deliberately rather than
            // handed to an attribute that would ignore it silently.
            onSubmit={event => {
              void form.handleSubmit(submit)(event);
            }}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            {settings.map(setting => (
              // No cast: `WidgetSetting` is assignable to `FieldConfig`, and
              // `settings.compat.test-d.ts` is what keeps that true.
              <FieldRenderer key={setting.name} field={setting} mode="edit" />
            ))}

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}
