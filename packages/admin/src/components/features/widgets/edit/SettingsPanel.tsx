/**
 * What one reader may change about one card: its settings drawer, the one place every setting
 * of the card is changed, opened from Settings… in its menu.
 *
 * 🔴 Keyed by PLACEMENT, not by widget. The same widget can sit on a dashboard
 * twice — a "recent entries" card for posts beside one for pages — and settings
 * belong to the card the reader is looking at, not to the definition behind it.
 * Every save goes through `setConfig(placementId, …)` for that reason.
 *
 * A side drawer that is NOT modal: the dashboard behind it stays usable, read
 * and clicked, so the reader sees the card they are changing and the ones
 * around it. It draws the card as its values would draw it at the top, then
 * the settings in three sections, none folded: Content (what the card reads),
 * Display (how it shows it, the card's title first) and Size (its width).
 * Content holds only what the widget declares (`sectionOf`); Display always
 * holds the title, and Size the width wherever the drawer is given one.
 *
 * Most of the form is drawn by `FieldRenderer`, the same component the entry
 * editor uses, because a widget setting IS a field definition. A reader meets
 * the inputs they already know, and a plugin author gets a settings form
 * without writing one. A short choice, an on/off and a note's text are drawn
 * by the drawer's own controls (`DrawerSettingControls`).
 *
 * Save is the one way to keep a change, and what it does depends on where the
 * reader is (`onDone`): while customising it joins the dashboard's unsaved
 * changes, kept until the customise bar's Save, and the drawer closes; at rest
 * it is saved at once, and the drawer stays open until the save lands, saying
 * why in place when it does not. Until then the card itself is untouched.
 * Cancel, Escape and the close button discard the drawer's changes; leaving
 * the page with changes still in it asks first, as the admin's other editors
 * do.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
} from "@nextlyhq/ui";
import {
  MAX_CARD_TITLE_LENGTH,
  textLength,
  type AnyWidgetSetting,
  type GridSize,
  type WidgetSizeBounds,
} from "nextly/config";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type JSX,
} from "react";
import {
  FormProvider,
  useForm,
  useWatch,
  type UseFormReturn,
} from "react-hook-form";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { widthChoices } from "../sizes";
import { askableWith, titleAsAsked } from "../widget-as-asked";

import {
  dependentsOf,
  isContentSetting,
  sameSettingValue,
  sectionOf,
  staleContentValues,
  startingValue,
  type SettingSection,
} from "./content-settings";
import { ContentSettingControl } from "./ContentSettingControl";
import { DrawerHeader } from "./DrawerHeader";
import { drawerControlOf, WidthControl } from "./DrawerSettingControls";
import { closeFocusTo } from "./panel-close-focus";
import {
  initialValues,
  resetToDefaults,
  toStoredConfig,
  type PanelKept,
} from "./panel-values";
import { PendingRowsContext, usePendingRows } from "./pending-rows";
import { overlongMessage, overlongSetting } from "./setting-length";
import { settingRulesOf, type SettingRule } from "./setting-rules";
import { SettingEditorControl } from "./SettingEditorControl";
import {
  bringRefusedPanelForward,
  useOnePanelOpen,
} from "./settings-panel-registry";

export interface SettingsPanelProps {
  /** The card this configures, by its placement: one panel is open at a time (`useOnePanelOpen`). */
  placementId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The card being configured, for the heading a reader reads. */
  title: string;
  settings: AnyWidgetSetting[];
  /**
   * The widget whose card this configures: its Collection setting offers only the collections
   * that card can be asked of (`askableWith`), as the add panel does, and its automatic title is
   * the Title field's placeholder. Absent, every collection the server sent is offered.
   */
  widget?: DashboardWidget;
  /** What this placement has stored, if anything. */
  config: Record<string, unknown> | undefined;
  /**
   * The card's size as drawn and its widget's bounds, for the Size section's Width. Absent, the
   * drawer has no Size section.
   */
  sizing?: { size: GridSize; bounds: WidgetSizeBounds };
  /** The title the reader gave this card, as stored; absent while it is titled automatically. */
  ownTitle?: string | undefined;
  /**
   * Keep the change (Save), and say how that ended: `saved` closes the drawer, `failed` keeps it
   * open with the reason beside the form.
   */
  onDone: (kept: PanelKept, settled: DoneSettled) => void;
  /** Why Save cannot keep a change now, when it cannot; said in the panel, and Save is off. */
  blocked?: string;
  /**
   * The card as the panel's current values would draw it, at the top: handed what Save would
   * keep, and a way to empty the panel's filters, which the preview offers while they match
   * nothing.
   */
  renderPreview?: (draft: PanelKept, clearFilters: () => void) => ReactNode;
  /**
   * Open with focus on the form's first field rather than where the panel puts it, as a card's
   * empty state opens it to ask for the setting it is missing.
   */
  focusFirstField?: boolean;
  /**
   * Whether the dashboard's own leave prompt asks for this panel, as it does while customising:
   * the panel then installs no prompt of its own, so a leave is asked about once.
   */
  defersLeave?: boolean;
  /**
   * Whether a dashboard write is on its way, such as the dashboard's Save carrying this panel's
   * staged change: the panel is frozen as while its own Save saves, so nothing is changed after
   * the values the write carries were taken.
   */
  dashboardWriting?: boolean;
  /**
   * The control focus goes back to when the panel closes: the one the reader opened it from.
   * The panel is opened from a popover or a menu that is gone by then, so it cannot be left to
   * the panel to find.
   */
  returnFocusTo?: () => HTMLElement | null;
}

/**
 * What a reader fills in, in the order the form lays them out: the first match is the first field.
 * A select and a switch are buttons by their roles, so they are named by them. Asked of the
 * settings alone: the card's own title, which every panel holds, is never the setting a card's
 * empty state asks for.
 */
const SETTINGS_FIELD =
  "input:not([type='hidden']), textarea, select, [role='combobox'], [role='switch'], [role='radio']";

/** How a Save ended, told back to the panel that asked. */
export interface DoneSettled {
  saved: () => void;
  failed: (message: string) => void;
}

/** The drawer's setting sections, in the order drawn, each by the name the reader reads. */
const SECTIONS: readonly { section: SettingSection; label: string }[] = [
  { section: "data", label: "Content" },
  { section: "display", label: "Display" },
];

/**
 * A copy of `values` the form may own.
 *
 * 🔴 The form must never be handed the panel's memoised baseline itself.
 * react-hook-form copies only PLAIN objects; one with no prototype, as
 * `initialValues` builds, it keeps by reference. Every keystroke then wrote
 * into the baseline, and the reset on Cancel restored the cancelled value: the
 * panel reopened on a change nothing had saved. The copy keeps the null
 * prototype, so a setting named `__proto__` stays data.
 */
function formCopy(values: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(Object.create(null), values);
}

/** The collections and fields this reader may be offered, as the panel reads them. */
type WidgetSources = ReturnType<typeof useBranding>["widgetSources"];

/**
 * The values the panel opens on, and the stored values it could not open on.
 *
 * A stored value naming a field the reader is no longer offered opens at its
 * default, and the panel says so in one line, rather than drawing a choice the
 * reader cannot make again.
 */
function usePanelBaseline(
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
 * The form's values once the card's stored settings moved from `previous` to `next` behind the
 * open panel: each value the reader left as it opened takes the card's new one, and each they
 * changed stays theirs. Judged by value, as the stored config is compared everywhere.
 */
function followBaseline(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(next)) {
    merged[name] = sameSettingValue(current[name], previous[name])
      ? next[name]
      : current[name];
  }
  return merged;
}

/** Whether a setting's value is a choice the reader made, rather than none. */
function holdsChoice(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** Names read as a list: "Filter", "Filter and Sort", "Filter, Sort and Fields". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * What the panel says beside a Collection setting a reader just changed: the settings over it
 * that the change reset, by their labels, or nothing when it reset none that held a choice.
 */
function collectionResetNotice(
  reset: readonly AnyWidgetSetting[]
): string | undefined {
  if (reset.length === 0) return undefined;
  return `Changing the collection reset ${listOf(
    reset.map(setting => setting.label ?? setting.name)
  )}`;
}

/**
 * The panel's form, and the only places values reach it: as it mounts, as the
 * panel closes, and on a section's Reset to defaults, each through `formCopy`.
 * With what each Collection setting's last change reset, for the notice beside
 * it.
 */
function usePanelForm(
  open: boolean,
  settings: readonly AnyWidgetSetting[],
  sources: WidgetSources,
  defaultValues: Record<string, unknown>
) {
  const form = useForm({ defaultValues: formCopy(defaultValues) });
  const [resetNotices, setResetNotices] = useState<
    Readonly<Record<string, string>>
  >({});

  // The form keeps the values it was mounted with, and `defaultValues` changing
  // later does not replace them. So while the panel is closed it is rebuilt
  // from the latest baseline: sources that arrive or change after mounting are
  // what it opens with, a value a notice says was reset is the value Save
  // keeps, and a change the reader cancelled is gone. Never while it stays
  // open, where it would discard the reader's edits.
  //
  // While it is open, the card can still change behind it (the panel is not modal, so its quick
  // setting saves at once): a setting the reader has not touched here follows the card, and one
  // they changed keeps their change, so Save never puts back a value the card has moved on from.
  const lastBaseline = useRef(defaultValues);
  useEffect(() => {
    const previous = lastBaseline.current;
    lastBaseline.current = defaultValues;
    if (open) {
      if (previous !== defaultValues) {
        form.reset(
          formCopy(followBaseline(form.getValues(), previous, defaultValues))
        );
      }
      return;
    }
    form.reset(formCopy(defaultValues));
    setResetNotices({});
  }, [open, defaultValues, form]);

  // A filter, sort or grouping names fields of ONE collection: when a person
  // picks another collection, the settings over it go back to where they
  // start over the new one -- the default where it fits, none where it names
  // a field the new collection lacks -- and the panel names the ones that
  // held a choice. Only a person's change does this; a reset or the form
  // opening names no field.
  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (name === undefined) return;
      const dependents = dependentsOf(settings, name);
      if (dependents.length === 0) return;
      const reset = dependents.filter(dependent => {
        const before: unknown = values[dependent.name];
        const next = startingValue(dependent, values[name], sources);
        form.setValue(dependent.name, next);
        return holdsChoice(before) && !sameSettingValue(before, next);
      });
      const notice = collectionResetNotice(reset);
      setResetNotices(previous => {
        const { [name]: _replaced, ...rest } = previous;
        return notice === undefined ? rest : { ...rest, [name]: notice };
      });
    });
    return () => subscription.unsubscribe();
  }, [form, settings, sources]);

  // One section's settings back to their defaults; the rest of the form as it is. The form's
  // own baseline is kept, so the panel still knows what it opened with.
  const resetSection = useCallback(
    (section: SettingSection) => {
      const values = form.getValues();
      const reset = resetToDefaults(
        settings.filter(setting => sectionOf(setting) === section),
        values,
        sources
      );
      form.reset(formCopy({ ...values, ...reset }), {
        keepDefaultValues: true,
      });
    },
    [form, settings, sources]
  );
  return { form, resetSection, resetNotices };
}

/**
 * What Save would keep, as the reader changes the form, for the preview. Held as its JSON, a
 * string that changes exactly when the draft does: the form hands every change the same values
 * object, which would not re-render anything.
 */
function usePanelDraft(
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

/**
 * The card's own title as the panel holds it: the stored one when it opens, back to it when the
 * panel closes, and why Save refuses it, when it is longer than a card's header holds.
 */
function useOwnTitle(open: boolean, stored: string | undefined) {
  const [ownTitle, setOwnTitle] = useState(stored ?? "");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // The stored title the panel last took up, so a title stored behind the open panel replaces
  // the field only while the reader has not changed it there.
  const taken = useRef(stored ?? "");
  useEffect(() => {
    const next = stored ?? "";
    const previous = taken.current;
    taken.current = next;
    if (open) {
      setOwnTitle(current => (current === previous ? next : current));
      return;
    }
    setOwnTitle(next);
    setProblem(undefined);
  }, [open, stored]);
  /** Why the title cannot be kept, said beside it, or `undefined` when it can. */
  const check = useCallback(() => {
    const found =
      textLength(ownTitle.trim()) > MAX_CARD_TITLE_LENGTH
        ? `A title can be at most ${MAX_CARD_TITLE_LENGTH} characters.`
        : undefined;
    setProblem(found);
    return found;
  }, [ownTitle]);
  // A change answers the refusal it was made for, so the refusal goes with it.
  const change = useCallback((next: string) => {
    setOwnTitle(next);
    setProblem(undefined);
  }, []);
  return { ownTitle, setOwnTitle: change, problem, check };
}

/**
 * The card's width as the drawer holds it: the drawn one when it opens, the reader's choice
 * while it is open, and back to the drawn one when it closes. `undefined` where the drawer has
 * no Size section.
 */
function useDraftWidth(open: boolean, drawn: number | undefined) {
  const [w, setW] = useState(drawn);
  // Back to the card's own width whenever the drawer closes or the card's width moves while it
  // is closed; never while it is open, where it would undo the reader's choice.
  useEffect(() => {
    if (!open) setW(drawn);
  }, [open, drawn]);
  return [w, setW] as const;
}

/** A Save in flight, why the last one did not keep the change, and closing that waits for it. */
function usePanelDone(
  props: Pick<SettingsPanelProps, "open" | "onOpenChange" | "onDone">
) {
  const { open, onOpenChange, onDone } = props;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // A refusal belongs to the panel it was said in: it is gone once that panel closes.
  useEffect(() => {
    if (!open) setFailure(undefined);
  }, [open]);

  /** Keep `kept`, answering whether it landed, for Save and for the leave prompt's Save. */
  const submit = useCallback(
    (kept: PanelKept): Promise<boolean> =>
      new Promise(resolve => {
        setSaving(true);
        setFailure(undefined);
        onDone(kept, {
          saved: () => {
            setSaving(false);
            onOpenChange(false);
            resolve(true);
          },
          failed: message => {
            setSaving(false);
            setFailure(message);
            resolve(false);
          },
        });
      }),
    [onDone, onOpenChange]
  );

  // Not closed mid-save, by Cancel or Escape: the save would land anyway, and the reader would
  // be left not knowing whether it did.
  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next && saving) return;
      onOpenChange(next);
    },
    [saving, onOpenChange]
  );
  return { saving, failure, submit, changeOpen };
}

/**
 * What the panel asks when another card's settings are opened while it holds a change: the
 * admin's own leave prompt, in its words and with its three choices.
 */
function LeavePrompt({
  open,
  title,
  saving,
  onDiscard,
  onKeep,
  onSave,
}: {
  open: boolean;
  title: string;
  saving: boolean;
  onDiscard: () => void;
  onKeep: () => void;
  onSave: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={next => (next ? null : onKeep())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
          <AlertDialogDescription>
            {`You have unsaved changes to ${title} that will be lost if you open another card's settings.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onDiscard} disabled={saving}>
            Discard Changes
          </AlertDialogAction>
          <AlertDialogCancel>Keep Editing</AlertDialogCancel>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Why Save is off, why the last Save did not keep the change, and which stored values were reset. */
function PanelNotices({
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

/** The control for one setting: its own editor, a content setting's control, or `FieldRenderer`. */
function SettingControl({
  setting,
  sources,
  saving,
  widget,
  opened,
  rule,
}: {
  setting: AnyWidgetSetting;
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
  /** The setting's value as the drawer opened on it: the card's own, for a choice to keep. */
  opened: unknown;
  /** What it does beside the card's other settings as the drawer holds them now. */
  rule: SettingRule | undefined;
}) {
  // A setting with its own editor is drawn by it, whatever its type.
  if (setting.editor !== undefined) {
    return (
      <SettingEditorControl
        setting={setting}
        component={setting.editor.component}
        disabled={saving}
        sources={sources}
      />
    );
  }
  // A short choice, an on/off or a note's text: the drawer's own controls.
  const own = drawerControlOf(setting, saving, opened, rule);
  if (own !== undefined) return own;
  if (isContentSetting(setting)) {
    return (
      <ContentSettingControl
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
    );
  }
  // No cast: `WidgetSetting` is assignable to `FieldConfig`, and `settings.compat.test-d.ts` is
  // what keeps that true.
  return <FieldRenderer field={setting} mode="edit" />;
}

/**
 * What a change of collection reset, said beside the Collection setting. Polite: the reader made
 * the change, and hears what it reset beside it. The region is drawn, empty, from the moment the
 * setting is, and the notice fills it: a live region that arrives already holding its words is
 * not reliably said. Empty, it is taken out of the flow (`sr-only`), so it holds no space under
 * the control; it stays in the accessibility tree either way.
 */
function ResetNotice({
  setting,
  notice,
}: {
  setting: AnyWidgetSetting;
  notice: string | undefined;
}) {
  if (setting.type !== "collection") return null;
  return (
    <p
      role="status"
      className={
        notice === undefined ? "sr-only" : "text-sm text-muted-foreground"
      }
      data-testid={`setting-reset-notice-${setting.name}`}
    >
      {notice}
    </p>
  );
}

/** One section's settings, each with the notice its last change left beside it. */
function SectionFields({
  settings,
  sources,
  saving,
  widget,
  resetNotices,
  baseline,
}: {
  settings: readonly AnyWidgetSetting[];
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
  resetNotices: Readonly<Record<string, string>>;
  /** The values the drawer opened on (`usePanelBaseline`), by setting name. */
  baseline: Readonly<Record<string, unknown>>;
}) {
  // The card's settings as the drawer holds them now, for its rules: one setting's choices follow
  // another's as the reader changes it.
  const values = useWatch() as Record<string, unknown> | undefined;
  const rules = settingRulesOf(widget?.id);
  const ruled = settings.map(setting => ({
    setting,
    rule: rules?.(setting.name, values ?? {}, sources ?? []),
  }));
  return (
    <>
      {ruled.map(({ setting, rule }) =>
        rule?.hidden === true ? null : (
          <div key={setting.name} className="flex flex-col gap-1.5">
            <SettingControl
              {...{ setting, sources, saving, widget, rule }}
              opened={baseline[setting.name]}
            />
            <ResetNotice
              setting={setting}
              notice={resetNotices[setting.name]}
            />
          </div>
        )
      )}
    </>
  );
}

/** The card's own title, with its automatic one as the placeholder and why Save refuses it. */
function TitleField({
  value,
  automatic,
  problem,
  onChange,
}: {
  value: string;
  automatic: string;
  problem: string | undefined;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Title</Label>
      <Input
        id={id}
        data-card-title=""
        value={value}
        placeholder={automatic}
        aria-describedby={
          problem === undefined ? hintId : `${hintId} ${problemId}`
        }
        aria-invalid={problem !== undefined}
        onChange={event => onChange(event.target.value)}
      />
      <p id={hintId} className="text-sm text-muted-foreground">
        Leave it empty to title the card from its settings.
      </p>
      {problem === undefined ? null : (
        <p id={problemId} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/** How every section's heading is drawn: small, muted, the drawer's own label style. */
const SECTION_HEADING_CLASS =
  "text-xs font-semibold tracking-wide text-muted-foreground";

/**
 * A section's heading and, where it has settings to reset, its "Reset to defaults" link, named
 * for the section it resets.
 */
function SectionHeading({
  id,
  label,
  saving,
  onReset,
}: {
  id: string;
  label: string;
  saving: boolean;
  onReset?: () => void;
}) {
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <h3 id={id} className={SECTION_HEADING_CLASS}>
        {label}
      </h3>
      {onReset ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          // In the text's own colour, underlined: the link variant's primary colour falls under
          // 4.5:1 on the drawer when a brand colour replaces the default primary.
          className="h-auto p-0 text-xs text-foreground underline"
          disabled={saving}
          aria-label={`Reset ${label} to defaults`}
          onClick={onReset}
        >
          Reset to defaults
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One section of the drawer, open, below a rule that parts it from the one above: the sections
 * read as one column, nothing folded.
 */
function PanelSection({
  label,
  saving,
  onReset,
  children,
}: {
  label: string;
  saving: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <SectionHeading
        {...{ id, label, saving }}
        {...(onReset ? { onReset } : {})}
      />
      {children}
    </section>
  );
}

/** Cancel and Save, with Save off while saving or when it cannot keep a change. */
function PanelActions({
  saving,
  blocked,
  onCancel,
}: {
  saving: boolean;
  blocked: string | undefined;
  onCancel: () => void;
}) {
  return (
    // At the drawer's foot, below the part that scrolls, so Cancel and Save are always in reach.
    <div className="flex shrink-0 flex-row justify-end gap-2 border-t border-border bg-background px-5 py-3">
      <Button
        type="button"
        variant="outline"
        disabled={saving}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={saving || blocked !== undefined}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/** Where focus goes as the panel opens, when it opens on its first field, and as it closes. */
function panelFocus(
  props: Pick<SettingsPanelProps, "focusFirstField" | "returnFocusTo">,
  fieldsRef: RefObject<HTMLFieldSetElement | null>
) {
  return {
    onCloseAutoFocus: closeFocusTo(props.returnFocusTo),
    ...(props.focusFirstField
      ? {
          onOpenAutoFocus: (event: Event) => {
            const first = [
              ...(fieldsRef.current?.querySelectorAll<HTMLElement>(
                SETTINGS_FIELD
              ) ?? []),
            ].find(field => !field.hasAttribute("data-card-title"));
            // Where there is no field to land on, the panel's own choice stands.
            if (!first) return;
            event.preventDefault();
            first.focus();
          },
        }
      : {}),
  };
}

/**
 * Showing what a check refused: focus lands on the first refused field, once it is drawn as
 * refused.
 */
function useRevealRefused(fieldsRef: RefObject<HTMLFieldSetElement | null>) {
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (asked === 0) return undefined;
    const timer = window.setTimeout(() => {
      fieldsRef.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [asked, fieldsRef]);
  /** Show the settings a check refused: focus moves to the first. */
  const reveal = useCallback(() => {
    setAsked(count => count + 1);
  }, []);
  return { reveal };
}

/**
 * Keeping the drawer's change: Save, staging it for the dashboard's prompt, focus on what a
 * refused staging named, and emptying its filters. One reading of the change (`keepable`) for
 * Save and for staging, so a change Save would refuse is never staged.
 */
function usePanelKeeping(args: {
  settings: readonly AnyWidgetSetting[];
  config: Record<string, unknown> | undefined;
  form: UseFormReturn<Record<string, unknown>>;
  own: ReturnType<typeof useOwnTitle>;
  submit: (kept: PanelKept) => Promise<boolean>;
  holdsChanges: boolean;
  fieldsRef: RefObject<HTMLFieldSetElement | null>;
  /** Show the settings a check refused (`useRevealRefused`). */
  reveal: () => void;
  /** The size the reader chose in the drawer, kept with the rest (`PanelKept`'s `resize`). */
  resize: PanelKept["resize"];
}) {
  const { settings, config, form, own, submit, holdsChanges, fieldsRef } = args;
  const { reveal } = args;
  // Set by a refused staging, and cleared by the next one.
  const refused = useRef(false);

  /** What Save would keep from `values`, or `undefined` when a check refuses it, said in place. */
  const keepable = (values: Record<string, unknown>): PanelKept | undefined => {
    // A note over its bound is refused here, by the counter the layout write uses, rather than
    // by the server after Save; so is a title too long for a card's header.
    const overlong = overlongSetting(settings, values);
    if (overlong) {
      form.setError(overlong.name, {
        type: "maxLength",
        message: overlongMessage(overlong.maxLength),
      });
      reveal();
      return undefined;
    }
    if (own.check() !== undefined) {
      reveal();
      return undefined;
    }
    return {
      config: toStoredConfig(settings, values, config),
      ownTitle: own.ownTitle.trim(),
      ...(args.resize === undefined ? {} : { resize: args.resize }),
    };
  };

  /** Save: the form's checks first, then the change kept. */
  const done = (values: Record<string, unknown>) => {
    const kept = keepable(values);
    if (kept !== undefined) void submit(kept);
  };

  /**
   * This panel's change as Save would keep it, for the dashboard's prompt to save with the rest:
   * judged by the same checks, the form's rules included. Refused, the panel shows why.
   */
  const stage = async (): Promise<PanelKept | "invalid" | undefined> => {
    refused.current = false;
    if (!holdsChanges) return undefined;
    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) reveal();
    const kept = valid ? keepable(form.getValues()) : undefined;
    if (kept !== undefined) return kept;
    refused.current = true;
    return "invalid";
  };

  // Kept until the next staging rather than spent here: a Save's prompt hands focus back after
  // the save answered, so the panel is asked again once it has, and must still know.
  const focusRefused = () => {
    if (!refused.current) return;
    fieldsRef.current
      ?.querySelector<HTMLElement>("[aria-invalid='true']")
      ?.focus();
  };

  /**
   * Every Filter setting emptied, as the reader's own change, so Save keeps it: to no conditions
   * rather than to unset, so a filter the widget sets by default is cleared too.
   */
  const clearFilters = () => {
    for (const setting of settings) {
      if (setting.type === "filter") {
        form.setValue(setting.name, {}, { shouldDirty: true });
      }
    }
  };
  /**
   * Save the panel's change from a prompt, judged by Save's own checks: `true` once kept, or with
   * nothing to keep; `false`, keeping the reader in the panel, when a check refuses it.
   */
  const saveChecked = async (): Promise<boolean> => {
    const staged = await stage();
    if (staged === "invalid") {
      bringRefusedPanelForward();
      return false;
    }
    return staged === undefined ? true : submit(staged);
  };
  /** Save's refusal by the form's own rules: the refused settings shown, by name. */
  const refusedOnDone = () => reveal();
  return {
    done,
    refusedOnDone,
    stage,
    focusRefused,
    clearFilters,
    saveChecked,
  };
}

/**
 * The prompt another card's settings open behind, while this panel holds a change, and what its
 * choices do: Discard closes this panel and opens the other; Save opens it once the save lands.
 */
function PanelLeavePrompt({
  leaving,
  setLeaving,
  title,
  saving,
  changeOpen,
  save,
}: {
  leaving: (() => void) | undefined;
  setLeaving: (then: (() => void) | undefined) => void;
  title: string;
  saving: boolean;
  changeOpen: (open: boolean) => void;
  /** Keep the panel's change by Save's own checks, answering whether it was kept. */
  save: () => Promise<boolean>;
}) {
  return (
    <LeavePrompt
      open={leaving !== undefined}
      title={title}
      saving={saving}
      onKeep={() => setLeaving(undefined)}
      onDiscard={() => {
        setLeaving(undefined);
        changeOpen(false);
        leaving?.();
      }}
      onSave={() => {
        void save().then(landed => {
          setLeaving(undefined);
          if (landed) leaving?.();
        });
      }}
    />
  );
}

/**
 * The drawer's sections, in order, none folded: Content where the widget declares any, Display
 * always (it holds the title), and Size where the drawer is given the card's width.
 */
function PanelSections({
  settings,
  sources,
  saving,
  widget,
  resetNotices,
  resetSection,
  own,
  automatic,
  size,
  baseline,
}: {
  settings: readonly AnyWidgetSetting[];
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
  resetNotices: Readonly<Record<string, string>>;
  /** The values the drawer opened on, by setting name. */
  baseline: Readonly<Record<string, unknown>>;
  resetSection: (section: SettingSection) => void;
  own: ReturnType<typeof useOwnTitle>;
  automatic: string;
  /** The card's width as the drawer holds it, its choices, and a way to choose another. */
  size:
    | {
        w: number;
        choices: readonly number[];
        bounds: WidgetSizeBounds;
        onSelect: (w: number) => void;
      }
    | undefined;
}) {
  return (
    <>
      {SECTIONS.map(({ section, label }) => {
        const inSection = settings.filter(
          setting => sectionOf(setting) === section
        );
        // Display holds every card's title; Content only what the widget declares.
        if (section !== "display" && inSection.length === 0) return null;
        const isDisplay = section === "display";
        return (
          <PanelSection
            key={section}
            label={label}
            saving={saving}
            onReset={() => {
              resetSection(section);
              if (isDisplay) own.setOwnTitle("");
            }}
          >
            {isDisplay ? (
              <TitleField
                value={own.ownTitle}
                automatic={automatic}
                problem={own.problem}
                onChange={own.setOwnTitle}
              />
            ) : null}
            <SectionFields
              settings={inSection}
              sources={sources}
              saving={saving}
              widget={widget}
              resetNotices={resetNotices}
              baseline={baseline}
            />
          </PanelSection>
        );
      })}
      {size === undefined ? null : (
        <PanelSection label="Size" saving={saving}>
          <WidthControl
            value={size.w}
            choices={size.choices}
            minW={size.bounds.min.w}
            maxW={size.bounds.max.w}
            disabled={saving}
            onSelect={size.onSelect}
          />
        </PanelSection>
      )}
    </>
  );
}

/**
 * What the panel holds: the reader's sources, its form and what it opened on, the card's own
 * title, Save's progress, what Save would keep, and whether that differs from what it opened on.
 */
function usePanelState(props: SettingsPanelProps) {
  const { open, settings, config } = props;
  // The collections and fields this reader may be offered, decided on the
  // server; absent until the session-gated half of the payload arrives.
  const sources = useBranding().widgetSources;
  const { stale, defaultValues } = usePanelBaseline(settings, config, sources);
  const formState = usePanelForm(open, settings, sources, defaultValues);
  const draft = usePanelDraft(formState.form, settings, config);
  const own = useOwnTitle(open, props.ownTitle);
  const drawnW = props.sizing?.size.w;
  const [w, setW] = useDraftWidth(open, drawnW);
  const doneState = usePanelDone(props);
  // Rows begun and not finished write nothing to the draft, so they are counted on their own.
  const pendingRows = usePendingRows();

  // What Save would keep, against what the panel opened on: the leave prompt asks only when the
  // two differ, and another card's panel opening closes this one only when they do not.
  const opened = useMemo(
    () => toStoredConfig(settings, defaultValues, config),
    [settings, defaultValues, config]
  );
  // By the size's numbers and the bounds, not the sizing object, which the caller may build anew.
  const drawnH = props.sizing?.size.h;
  const bounds = props.sizing?.bounds;
  const resize = useMemo(
    () =>
      drawnW === undefined || drawnH === undefined || bounds === undefined
        ? undefined
        : resizeOf({ size: { w: drawnW, h: drawnH }, bounds }, w),
    [drawnW, drawnH, bounds, w]
  );
  const kept: PanelKept = useMemo(
    () => ({
      config: draft,
      ownTitle: own.ownTitle.trim(),
      ...(resize === undefined ? {} : { resize }),
    }),
    [draft, own.ownTitle, resize]
  );
  const holdsChanges =
    !sameSettingValue(draft, opened) ||
    kept.ownTitle !== (props.ownTitle ?? "") ||
    resize !== undefined ||
    pendingRows.anyPending;
  return {
    sources,
    stale,
    // What the drawer opened on, held apart from the form, whose own defaults a reset replaces.
    baseline: defaultValues,
    ...formState,
    draft,
    own,
    w,
    setW,
    resize,
    ...doneState,
    // Frozen while Save saves, or while a dashboard write carries what the panel staged.
    saving: doneState.saving || props.dashboardWriting === true,
    kept,
    holdsChanges,
    reportPendingRow: pendingRows.report,
  };
}

/** The panel's Title placeholder: the title the card would have automatically. */
function automaticTitleOf(
  widget: DashboardWidget | undefined,
  draft: Record<string, unknown>,
  sources: WidgetSources,
  fallback: string
): string {
  return widget ? titleAsAsked(widget, draft, sources).title : fallback;
}

/**
 * The size the reader chose in the drawer, held against the card's own: its new width with the
 * height it has, and its widget's bounds; `undefined` while the width is the card's own.
 */
function resizeOf(
  sizing: SettingsPanelProps["sizing"],
  w: number | undefined
): PanelKept["resize"] {
  if (sizing === undefined || w === undefined || w === sizing.size.w) {
    return undefined;
  }
  return { size: { w, h: sizing.size.h }, bounds: sizing.bounds };
}

/**
 * The Size section's width: the drawer's own, its choices within the widget's bounds, read
 * against the width the card is drawn at (so a stored width outside them is offered until the
 * reader picks another), and a way to choose one. `undefined` where the drawer has no Size.
 */
function sizeSection(
  sizing: SettingsPanelProps["sizing"],
  w: number | undefined,
  setW: (w: number) => void
) {
  if (sizing === undefined || w === undefined) return undefined;
  return {
    w,
    choices: widthChoices(sizing.bounds, sizing.size.w),
    bounds: sizing.bounds,
    onSelect: setW,
  };
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { open, title, settings, config, blocked, renderPreview } = props;
  const state = usePanelState(props);
  const { sources, stale, form, resetSection, resetNotices, draft, own } =
    state;
  const { saving, failure, submit, changeOpen, kept, holdsChanges } = state;
  const formRef = useRef<HTMLFormElement>(null);
  const fieldsRef = useRef<HTMLFieldSetElement>(null);
  // Another card's settings asked for while this panel holds a change: what to open once the
  // reader has answered this panel's prompt.
  const [leaving, setLeaving] = useState<(() => void) | undefined>(undefined);
  const refusal = useRevealRefused(fieldsRef);
  const keeping = usePanelKeeping({
    settings,
    config,
    form,
    own,
    submit,
    holdsChanges,
    fieldsRef,
    reveal: refusal.reveal,
    resize: state.resize,
  });
  useOnePanelOpen(props.placementId, open, holdsChanges, {
    close: () => changeOpen(false),
    askToLeave: then => setLeaving(() => then),
    stage: keeping.stage,
    focusRefused: keeping.focusRefused,
  });
  const automatic = automaticTitleOf(props.widget, draft, sources, title);
  const size = sizeSection(props.sizing, state.w, state.setW);

  return (
    <UnsavedChangesGuard
      isDirty={open && holdsChanges}
      // Installed only while the panel is open: a closed panel holds nothing to lose. And not
      // while customising, where the dashboard's own prompt asks for it, so a leave is asked once.
      disabled={!open || props.defersLeave === true}
      onSave={keeping.saveChecked}
      // A Save the prompt could not make keeps the reader in the panel, on what it refused.
      onCancel={bringRefusedPanelForward}
    >
      <PanelLeavePrompt
        {...{ leaving, title, saving, changeOpen }}
        save={keeping.saveChecked}
        setLeaving={next => setLeaving(() => next)}
      />
      <Sheet open={open} onOpenChange={changeOpen} modal={false}>
        <SheetContent
          side="right"
          // 440 pixels from the small breakpoint up, the whole width below it. No padding of its
          // own: the header, the part that scrolls and the actions each pad themselves, so the
          // rules between them run edge to edge. Its own overflow is hidden, so the part below
          // the header takes the height that is left and scrolls inside it.
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:w-[440px] sm:max-w-[440px]"
          // Not modal: the dashboard behind stays usable, so a click on it is the reader using
          // it, never a request to throw the drawer's changes away.
          onInteractOutside={event => event.preventDefault()}
          data-testid="widget-settings-drawer"
          {...panelFocus(props, fieldsRef)}
        >
          <DrawerHeader title={title} saving={saving} />

          {/* Its controls say here which rows they hold unfinished, which `holdsChanges` counts. */}
          <PendingRowsContext.Provider value={state.reportPendingRow}>
            <FormProvider {...form}>
              <form
                ref={formRef}
                // `handleSubmit` answers with a promise and `onSubmit` expects
                // nothing back, so the result is voided deliberately rather than
                // handed to an attribute that would ignore it silently.
                onSubmit={event => {
                  void form.handleSubmit(
                    keeping.done,
                    keeping.refusedOnDone
                  )(event);
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
                  {renderPreview?.(kept, keeping.clearFilters)}
                  <PanelNotices {...{ blocked, failure, stale }} />
                  {/* Frozen while Save saves: the save carries the values Save was pressed on, so
                    a field changed after it would be dropped without a word when the drawer
                    closes. A disabled fieldset disables every control inside it, the custom ones
                    too. */}
                  <fieldset
                    ref={fieldsRef}
                    disabled={saving}
                    className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
                  >
                    <PanelSections
                      {...{
                        settings,
                        sources,
                        saving,
                        resetNotices,
                        resetSection,
                      }}
                      {...{ own, automatic, size }}
                      baseline={state.baseline}
                      widget={props.widget}
                    />
                  </fieldset>
                </div>
                <PanelActions
                  saving={saving}
                  blocked={blocked}
                  onCancel={() => changeOpen(false)}
                />
              </form>
            </FormProvider>
          </PendingRowsContext.Provider>
        </SheetContent>
      </Sheet>
    </UnsavedChangesGuard>
  );
}
