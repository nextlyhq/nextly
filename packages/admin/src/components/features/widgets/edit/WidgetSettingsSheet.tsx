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
 *
 * Done is the one way to keep a change, and what it does depends on where the
 * reader is (`onDone`): while customising it joins the dashboard's unsaved
 * changes and the sheet closes; at rest it is saved at once, and the sheet
 * stays open until the save lands, saying why in place when it does not.
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
import type { AnyWidgetSetting, PublishedContentSource } from "nextly/config";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type JSX,
} from "react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";

import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { askableWith } from "../widget-as-asked";

import {
  dependentsOf,
  isContentSetting,
  isDependentSetting,
  sameSettingValue,
  staleContentValues,
  startingValue,
} from "./content-settings";
import { ContentSettingControl } from "./ContentSettingControl";
import {
  drawnSetting,
  overlongMessage,
  overlongSetting,
} from "./setting-length";

export interface WidgetSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The card being configured, for the heading a reader reads. */
  title: string;
  settings: AnyWidgetSetting[];
  /**
   * The widget whose card this configures: its Collection setting offers only the collections
   * that card can be asked of (`askableWith`), as the add panel does. Absent, it offers every
   * collection the server sent.
   */
  widget?: DashboardWidget;
  /** What this placement has stored, if anything. */
  config: Record<string, unknown> | undefined;
  /**
   * Keep the settings, as `toStoredConfig` builds them, and say how that ended: `saved` closes
   * the sheet, `failed` keeps it open with the reason beside the form.
   */
  onDone: (config: Record<string, unknown>, settled: DoneSettled) => void;
  /** Why Done cannot keep a change now, when it cannot; said in the sheet, and Done is off. */
  blocked?: string;
  /**
   * The card as the form's current values would draw it, beside the form: handed the values as
   * `toStoredConfig` builds them, which is what Done would keep.
   */
  renderPreview?: (draft: Record<string, unknown>) => ReactNode;
}

/** How a Done ended, told back to the sheet that asked. */
export interface DoneSettled {
  saved: () => void;
  failed: (message: string) => void;
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
    if (sameSettingValue(value, setting.defaultValue)) continue;
    stored[setting.name] = value;
  }
  return stored;
}

/**
 * What the form holds after "Reset to defaults".
 *
 * Every setting goes back to its declared default, its dependents with it,
 * except a Collection setting that declares no default, which Reset leaves as
 * it is. Such a setting names the card's collection: it is the card's identity
 * rather than a preference, chosen when the card was placed and changed with
 * the Collection control itself, so Reset does not undo it, and does not
 * empty it into a card of no collection at all. A Collection setting that
 * declares a default (Recently edited's "All collections") resets like any
 * other.
 *
 * A dependent goes back to its default only where the default names a field
 * it may use over the collection kept; otherwise to none, so Reset never
 * draws a choice the collection does not have.
 */
export function resetToDefaults(
  settings: readonly AnyWidgetSetting[],
  values: Record<string, unknown>,
  sources?: readonly PublishedContentSource[]
): Record<string, unknown> {
  const reset: Record<string, unknown> = Object.create(null);
  for (const setting of settings) {
    const kept =
      setting.type === "collection" &&
      setting.defaultValue === undefined &&
      Object.hasOwn(values, setting.name);
    reset[setting.name] = kept
      ? values[setting.name]
      : (setting.defaultValue ?? "");
  }
  for (const setting of settings) {
    if (isDependentSetting(setting)) {
      reset[setting.name] = startingValue(setting, reset[setting.of], sources);
    }
  }
  return reset;
}

/**
 * A copy of `values` the form may own.
 *
 * 🔴 The form must never be handed the sheet's memoised baseline itself.
 * react-hook-form copies only PLAIN objects; one with no prototype, as
 * `initialValues` builds, it keeps by reference. Every keystroke then wrote
 * into the baseline, and the reset on Cancel restored the cancelled value: the
 * sheet reopened on a change nothing had saved. The copy keeps the null
 * prototype, so a setting named `__proto__` stays data.
 */
function formCopy(values: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(Object.create(null), values);
}

/** The collections and fields this reader may be offered, as the sheet reads them. */
type WidgetSources = ReturnType<typeof useBranding>["widgetSources"];

/**
 * The values the sheet opens on, and the stored values it could not open on.
 *
 * A stored value naming a field the reader is no longer offered opens at its
 * default, and the sheet says so in one line, rather than drawing a choice the
 * reader cannot make again.
 */
function useSheetBaseline(
  settings: readonly AnyWidgetSetting[],
  config: Record<string, unknown> | undefined,
  sources: WidgetSources
) {
  const stale = useMemo(
    () =>
      staleContentValues(settings, initialValues(settings, config), sources),
    [settings, config, sources]
  );
  const defaultValues = useMemo(() => {
    const values = initialValues(settings, config);
    for (const { name, replacement } of stale) {
      values[name] = replacement;
      // A collection reset takes the settings over it along: their values
      // name fields of the collection that is gone.
      for (const dependent of dependentsOf(settings, name)) {
        values[dependent.name] = startingValue(dependent, replacement, sources);
      }
    }
    return values;
  }, [settings, config, stale, sources]);
  return { stale, defaultValues };
}

/**
 * The sheet's form, and the only places values reach it: as it mounts, as the
 * sheet closes, and on Reset to defaults, each through `formCopy`.
 */
function useSheetForm(
  open: boolean,
  settings: readonly AnyWidgetSetting[],
  sources: WidgetSources,
  defaultValues: Record<string, unknown>
) {
  const form = useForm({ defaultValues: formCopy(defaultValues) });

  // The form keeps the values it was mounted with, and `defaultValues` changing
  // later does not replace them. So while the sheet is closed it is rebuilt
  // from the latest baseline: sources that arrive or change after mounting are
  // what it opens with, a value a notice says was reset is the value Done
  // keeps, and a change the reader cancelled is gone. Never while it stays
  // open, where it would discard the reader's edits.
  useEffect(() => {
    if (!open) form.reset(formCopy(defaultValues));
  }, [open, defaultValues, form]);

  // A filter, sort or grouping names fields of ONE collection: when a person
  // picks another collection, the settings over it go back to where they
  // start over the new one -- the default where it fits, none where it names
  // a field the new collection lacks. Only a person's change does this; a
  // reset or the form opening names no field.
  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (name === undefined) return;
      for (const dependent of dependentsOf(settings, name)) {
        form.setValue(
          dependent.name,
          startingValue(dependent, values[name], sources)
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [form, settings, sources]);

  const reset = useCallback(
    () =>
      form.reset(
        formCopy(resetToDefaults(settings, form.getValues(), sources))
      ),
    [form, settings, sources]
  );
  return { form, reset };
}

/**
 * What Done would keep, as the reader changes the form, for the preview. Held as its JSON, a
 * string that changes exactly when the draft does: the form hands every change the same values
 * object, which would not re-render anything.
 */
function useSheetDraft(
  form: UseFormReturn<Record<string, unknown>>,
  settings: readonly AnyWidgetSetting[],
  config: Record<string, unknown> | undefined
): Record<string, unknown> {
  const draftOf = useCallback(
    (values: Record<string, unknown>) =>
      JSON.stringify(toStoredConfig(settings, values, config)),
    [settings, config]
  );
  const [draftKey, setDraftKey] = useState(() => draftOf(form.getValues()));
  useEffect(() => {
    setDraftKey(draftOf(form.getValues()));
    const subscription = form.watch(values => setDraftKey(draftOf(values)));
    return () => subscription.unsubscribe();
  }, [form, draftOf]);
  return useMemo(
    () => JSON.parse(draftKey) as Record<string, unknown>,
    [draftKey]
  );
}

/** A Done in flight, why the last one did not keep the change, and closing that waits for it. */
function useSheetDone(
  props: Pick<
    WidgetSettingsSheetProps,
    "open" | "onOpenChange" | "settings" | "config" | "onDone"
  >
) {
  const { open, onOpenChange, settings, config, onDone } = props;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // A refusal belongs to the sheet it was said in: it is gone once that sheet closes.
  useEffect(() => {
    if (!open) setFailure(undefined);
  }, [open]);

  const submit = useCallback(
    (values: Record<string, unknown>) => {
      setSaving(true);
      setFailure(undefined);
      onDone(toStoredConfig(settings, values, config), {
        saved: () => {
          setSaving(false);
          onOpenChange(false);
        },
        failed: message => {
          setSaving(false);
          setFailure(message);
        },
      });
    },
    [onDone, onOpenChange, settings, config]
  );

  // Not closed mid-save, by Cancel, Escape or the overlay: the save would land anyway, and the
  // reader would be left not knowing whether it did.
  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next && saving) return;
      onOpenChange(next);
    },
    [saving, onOpenChange]
  );
  return { saving, failure, submit, changeOpen };
}

/** Why Done is off, why the last Done did not keep the change, and which stored values were reset. */
function SheetNotices({
  blocked,
  failure,
  stale,
}: {
  blocked: string | undefined;
  failure: string | undefined;
  stale: ReturnType<typeof staleContentValues>;
}) {
  return (
    <>
      {blocked === undefined ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {blocked}
        </p>
      )}
      {failure === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {stale.map(({ name, notice }) => (
        <p key={name} role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ))}
    </>
  );
}

/** One control per setting: a content setting's own control, any other through `FieldRenderer`. */
function SheetFields({
  settings,
  sources,
  saving,
  widget,
}: {
  settings: readonly AnyWidgetSetting[];
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
}) {
  // Frozen while Done saves: the save carries the values Done was pressed on, so a field changed
  // after it would be dropped without a word when the sheet closes, and one changed before a
  // refusal would leave the form saying something other than what was refused. A disabled
  // fieldset disables every control inside it, the custom ones included.
  return (
    <fieldset
      disabled={saving}
      className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
    >
      {settings.map(setting =>
        isContentSetting(setting) ? (
          <ContentSettingControl
            key={setting.name}
            setting={setting}
            sources={sources ?? []}
            {...(widget === undefined || setting.type !== "collection"
              ? {}
              : {
                  offers: (collection: string) =>
                    askableWith(
                      widget,
                      { [setting.name]: collection },
                      sources ?? undefined
                    ),
                })}
          />
        ) : (
          // No cast: `WidgetSetting` is assignable to `FieldConfig`,
          // and `settings.compat.test-d.ts` is what keeps that true. A
          // textarea's bound is judged on Done (`drawnSetting`).
          <FieldRenderer
            key={setting.name}
            field={drawnSetting(setting)}
            mode="edit"
          />
        )
      )}
    </fieldset>
  );
}

/** Reset to defaults, Cancel and Done, with Done off while saving or when it cannot keep a change. */
function SheetActions({
  saving,
  blocked,
  onReset,
  onCancel,
}: {
  saving: boolean;
  blocked: string | undefined;
  onReset: () => void;
  onCancel: () => void;
}) {
  return (
    <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
      <Button
        type="button"
        variant="ghost"
        className="mr-auto"
        disabled={saving}
        onClick={onReset}
      >
        Reset to defaults
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={saving}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={saving || blocked !== undefined}>
        {saving ? "Saving…" : "Done"}
      </Button>
    </SheetFooter>
  );
}

export function WidgetSettingsSheet(
  props: WidgetSettingsSheetProps
): JSX.Element {
  const { open, title, settings, config, blocked, renderPreview } = props;
  // The collections and fields this reader may be offered, decided on the
  // server; absent until the session-gated half of the payload arrives.
  const sources = useBranding().widgetSources;
  const { stale, defaultValues } = useSheetBaseline(settings, config, sources);
  const { form, reset } = useSheetForm(open, settings, sources, defaultValues);
  const draft = useSheetDraft(form, settings, config);
  const { saving, failure, submit, changeOpen } = useSheetDone(props);

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent
        side="right"
        // Wider with a preview, so the card and the form sit side by side on a wide screen; on a
        // narrow one the preview stacks above the form. A column whose own overflow is hidden, so
        // the area below the header takes the height that is left and scrolls inside it: the
        // sheet's base is not a flex box, and without this a tall form ran past the screen.
        className={
          renderPreview
            ? "flex w-full flex-col overflow-hidden sm:max-w-md lg:max-w-4xl"
            : "flex w-full flex-col overflow-hidden sm:max-w-md"
        }
      >
        <SheetHeader>
          <SheetTitle>{title} settings</SheetTitle>
          <SheetDescription>
            These apply to this card only. Another copy of the same widget keeps
            its own.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row lg:overflow-hidden">
          {renderPreview ? (
            <div className="px-4 lg:w-1/2 lg:shrink-0 lg:overflow-y-auto">
              {renderPreview(draft)}
            </div>
          ) : null}
          <FormProvider {...form}>
            <form
              // `handleSubmit` answers with a promise and `onSubmit` expects
              // nothing back, so the result is voided deliberately rather than
              // handed to an attribute that would ignore it silently.
              onSubmit={event => {
                void form.handleSubmit(values => {
                  // A note over its bound is refused here, by the counter the
                  // layout write uses, rather than by the server after Done.
                  const overlong = overlongSetting(settings, values);
                  if (overlong) {
                    form.setError(overlong.name, {
                      type: "maxLength",
                      message: overlongMessage(overlong.maxLength),
                    });
                    return;
                  }
                  submit(values);
                })(event);
              }}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
            >
              <SheetNotices {...{ blocked, failure, stale }} />
              <SheetFields
                settings={settings}
                sources={sources}
                saving={saving}
                widget={props.widget}
              />
              <SheetActions
                saving={saving}
                blocked={blocked}
                onReset={reset}
                onCancel={() => changeOpen(false)}
              />
            </form>
          </FormProvider>
        </div>
      </SheetContent>
    </Sheet>
  );
}
