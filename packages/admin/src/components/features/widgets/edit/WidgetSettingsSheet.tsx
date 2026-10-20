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
import type { AnyWidgetSetting } from "nextly/config";
import { useCallback, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useBranding } from "@admin/context/providers/BrandingProvider";

import {
  dependentsOf,
  isContentSetting,
  staleContentValues,
} from "./content-settings";
import { ContentSettingControl } from "./ContentSettingControl";

export interface WidgetSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The card being configured, for the heading a reader reads. */
  title: string;
  settings: AnyWidgetSetting[];
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
  settings: readonly AnyWidgetSetting[],
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
  settings: readonly AnyWidgetSetting[],
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

/**
 * What the form holds after "Reset to defaults".
 *
 * Every setting goes back to its declared default, its dependents with it,
 * except a Collection setting that declares no default. That one was given its
 * value when the card was placed, from the collection group it was added from:
 * it is the card's identity rather than a preference, so resetting it would
 * turn a "Recent posts" card into a card of no collection at all. A Collection
 * setting that declares a default (Recently edited's "All collections") resets
 * like any other.
 */
export function resetToDefaults(
  settings: readonly AnyWidgetSetting[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const reset: Record<string, unknown> = Object.create(null);
  for (const setting of settings) {
    const placed =
      setting.type === "collection" &&
      setting.defaultValue === undefined &&
      Object.hasOwn(values, setting.name);
    reset[setting.name] = placed
      ? values[setting.name]
      : (setting.defaultValue ?? "");
  }
  return reset;
}

export function WidgetSettingsSheet({
  open,
  onOpenChange,
  title,
  settings,
  config,
  onSave,
}: WidgetSettingsSheetProps) {
  // The collections and fields this reader may be offered, decided on the
  // server; absent until the session-gated half of the payload arrives.
  const sources = useBranding().widgetSources;

  // A stored value naming a field the reader is no longer offered opens at
  // its default, and the sheet says so in one line, rather than drawing a
  // choice the reader cannot make again.
  const stale = useMemo(
    () =>
      staleContentValues(settings, initialValues(settings, config), sources),
    [settings, config, sources]
  );
  const defaultValues = useMemo(() => {
    const values = initialValues(settings, config);
    for (const { name } of stale) {
      const setting = settings.find(candidate => candidate.name === name);
      values[name] = setting?.defaultValue ?? "";
    }
    return values;
  }, [settings, config, stale]);

  const form = useForm({ defaultValues });

  // A filter, sort or grouping names fields of ONE collection: when a person
  // picks another collection, the settings over it go back to their defaults
  // rather than name fields the new collection may not have. Only a person's
  // change does this; a reset or the form opening names no field.
  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (name === undefined) return;
      for (const dependent of dependentsOf(settings, name)) {
        form.setValue(dependent.name, dependent.defaultValue ?? "");
      }
    });
    return () => subscription.unsubscribe();
  }, [form, settings]);

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
            {stale.map(({ name, notice }) => (
              <p
                key={name}
                role="status"
                className="text-sm text-muted-foreground"
              >
                {notice}
              </p>
            ))}
            {settings.map(setting =>
              isContentSetting(setting) ? (
                <ContentSettingControl
                  key={setting.name}
                  setting={setting}
                  sources={sources ?? []}
                />
              ) : (
                // No cast: `WidgetSetting` is assignable to `FieldConfig`,
                // and `settings.compat.test-d.ts` is what keeps that true.
                <FieldRenderer key={setting.name} field={setting} mode="edit" />
              )
            )}

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() =>
                  form.reset(resetToDefaults(settings, form.getValues()))
                }
              >
                Reset to defaults
              </Button>
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
