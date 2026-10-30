/**
 * What one reader may change about one card: its More settings panel.
 *
 * 🔴 Keyed by PLACEMENT, not by widget. The same widget can sit on a dashboard
 * twice — a "recent entries" card for posts beside one for pages — and settings
 * belong to the card the reader is looking at, not to the definition behind it.
 * Every save goes through `setConfig(placementId, …)` for that reason.
 *
 * A side panel that is NOT modal: the dashboard behind it stays usable, read
 * and clicked, so the reader sees the card they are changing and the ones
 * around it. It draws the card as its values would draw it at the top, then
 * the settings in three sections: Data (what the card reads), Display (how it
 * shows it, the card's title first) and Advanced, folded. Each section holds
 * only what the widget declares (`sectionOf`), Display aside, which always
 * holds the title.
 *
 * The form is drawn by `FieldRenderer`, the same component the entry editor
 * uses, because a widget setting IS a field definition. A reader meets the
 * inputs they already know, and a plugin author gets a settings form without
 * writing one.
 *
 * Done is the one way to keep a change, and what it does depends on where the
 * reader is (`onDone`): while customising it joins the dashboard's unsaved
 * changes and the panel closes; at rest it is saved at once, and the panel
 * stays open until the save lands, saying why in place when it does not.
 * Cancel and Escape discard the panel's changes; leaving the page with changes
 * still in it asks first, as the admin's other editors do.
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nextlyhq/ui";
import {
  MAX_CARD_TITLE_LENGTH,
  resolveWidgetSettings,
  textLength,
  type AnyWidgetSetting,
  type PublishedContentSource,
} from "nextly/config";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type JSX,
} from "react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import { FieldRenderer } from "@admin/components/features/entries/fields/FieldRenderer";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { askableWith, titleAsAsked } from "../widget-as-asked";

import {
  dependentsOf,
  isContentSetting,
  isDependentSetting,
  sameSettingValue,
  sectionOf,
  staleContentValues,
  startingValue,
  type SettingSection,
} from "./content-settings";
import { ContentSettingControl } from "./ContentSettingControl";
import {
  drawnSetting,
  overlongMessage,
  overlongSetting,
} from "./setting-length";
import { SettingEditorControl } from "./SettingEditorControl";

/** What Done keeps: the settings, as `toStoredConfig` builds them, and the card's own title. */
export interface PanelKept {
  config: Record<string, unknown>;
  /** The title the reader gave the card, trimmed; `""` titles it automatically. */
  ownTitle: string;
}

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
  /** The title the reader gave this card, as stored; absent while it is titled automatically. */
  ownTitle?: string | undefined;
  /**
   * Keep the change, and say how that ended: `saved` closes the panel, `failed` keeps it open
   * with the reason beside the form.
   */
  onDone: (kept: PanelKept, settled: DoneSettled) => void;
  /** Why Done cannot keep a change now, when it cannot; said in the panel, and Done is off. */
  blocked?: string;
  /**
   * The card as the panel's current values would draw it, at the top: handed what Done would
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

/** How a Done ended, told back to the panel that asked. */
export interface DoneSettled {
  saved: () => void;
  failed: (message: string) => void;
}

/** The panel's sections, in the order drawn, each by the name the reader reads. */
const SECTIONS: readonly { section: SettingSection; label: string }[] = [
  { section: "data", label: "Data" },
  { section: "display", label: "Display" },
  { section: "advanced", label: "Advanced" },
];

/**
 * The values the form opens with.
 *
 * 🔴 Built from the DECLARATION rather than from the stored config, so a
 * setting the reader has never touched still opens at its default instead of
 * blank — and a key the declaration no longer knows about does not appear as a
 * ghost field. Read through `resolveWidgetSettings`, the server's own reader,
 * so what the form shows is what the card is actually using: a stored value
 * the setting no longer accepts (a retired option, a number past a narrowed
 * bound, a value of another kind) opens at the default the card fell back to,
 * not at the value it set aside. A note's own text over its bound is the
 * exception, opened as written so it can be shortened.
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
  const resolved = resolveWidgetSettings(settings, config);
  for (const setting of settings) {
    const stored = config?.[setting.name];
    // A note over its bound is the one stale value kept as written: it is the
    // reader's own text, so they shorten it rather than lose it, and Done
    // refuses it until it fits (`overlongSetting`).
    values[setting.name] =
      setting.type === "textarea" && typeof stored === "string"
        ? stored
        : (resolved[setting.name] ?? "");
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
 * What the form holds after "Reset to defaults" of the settings in `settings`, one section's.
 *
 * Every one goes back to its declared default, its dependents with it, except a Collection
 * setting that declares no default, which Reset leaves as it is. Such a setting names the card's
 * collection: it is the card's identity rather than a preference, chosen when the card was
 * placed and changed with the Collection control itself, so Reset does not undo it, and does not
 * empty it into a card of no collection at all. A Collection setting that declares a default
 * (Recently edited's "All collections") resets like any other.
 *
 * A dependent goes back to its default only where the default names a field it may use over the
 * collection kept, read from `values` where the collection is in another section; otherwise to
 * none, so Reset never draws a choice the collection does not have.
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
      const collection = Object.hasOwn(reset, setting.of)
        ? reset[setting.of]
        : values[setting.of];
      reset[setting.name] = startingValue(setting, collection, sources);
    }
  }
  return reset;
}

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
export function collectionResetNotice(
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
  // what it opens with, a value a notice says was reset is the value Done
  // keeps, and a change the reader cancelled is gone. Never while it stays
  // open, where it would discard the reader's edits.
  useEffect(() => {
    if (open) return;
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
 * What Done would keep, as the reader changes the form, for the preview. Held as its JSON, a
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
 * panel closes, and why Done refuses it, when it is longer than a card's header holds.
 */
function useOwnTitle(open: boolean, stored: string | undefined) {
  const [ownTitle, setOwnTitle] = useState(stored ?? "");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (open) return;
    setOwnTitle(stored ?? "");
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

/** A Done in flight, why the last one did not keep the change, and closing that waits for it. */
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

  /** Keep `kept`, answering whether it landed, for Done and for the leave prompt's Save. */
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

/** An open panel, as the others and the dashboard ask about it. */
interface OpenPanel {
  /** Whether it holds a change Done has not kept. */
  holdsChanges: () => boolean;
  close: () => void;
  /** Ask the reader what to do with its change, and run `then` once it is kept or discarded. */
  askToLeave: (then: () => void) => void;
  /**
   * Its change as Done would keep it, `"invalid"` when Done would refuse it (the panel then
   * shows why), or `undefined` when it holds none.
   */
  stage: () => Promise<PanelKept | "invalid" | undefined>;
  /** Take focus on the first field its last refused staging named, if one was refused. */
  focusRefused: () => void;
}

/**
 * The panels open now, by placement.
 *
 * Non-modal panels do not close one another the way a modal one closes by being covered, so the
 * one rule for opening is kept here: ONE panel at a time. Another card's panel that holds nothing
 * unsaved closes for the new one; one holding a change keeps it, is brought forward asking what
 * to do with it, and the new one opens only once that is answered.
 */
const openPanels = new Map<string, OpenPanel>();
const panelListeners = new Set<() => void>();

function panelsChanged(): void {
  for (const listener of panelListeners) listener();
}

/**
 * Open the panel of `placementId` through `open`, one panel at a time: every opener of a card's
 * settings panel asks through this, so no panel opens over another holding a change.
 */
export function requestSettingsPanel(
  placementId: string,
  open: () => void
): void {
  const others = [...openPanels].filter(([id]) => id !== placementId);
  const holding = others.find(([, panel]) => panel.holdsChanges());
  if (holding !== undefined) {
    holding[1].askToLeave(open);
    return;
  }
  for (const [, panel] of others) panel.close();
  open();
}

/** One open panel's change, staged by the dashboard's prompt to be saved with the rest. */
export interface StagedPanel {
  placementId: string;
  kept: PanelKept;
}

/**
 * Every open panel's change as its Done would keep it, for the dashboard's prompt to save with
 * the rest while customising, or `"invalid"` when any panel's own checks refuse its change: that
 * panel then shows why, and nothing is to be saved until the reader fixes it or discards.
 */
export async function stagePendingPanels(): Promise<
  readonly StagedPanel[] | "invalid"
> {
  const staged: StagedPanel[] = [];
  for (const [placementId, panel] of openPanels) {
    const kept = await panel.stage();
    if (kept === "invalid") return "invalid";
    if (kept !== undefined) staged.push({ placementId, kept });
  }
  return staged;
}

/**
 * Bring forward the panel whose change the dashboard's prompt could not stage, with focus on the
 * first field it refused. Asked once that prompt has closed, after its own focus has gone back,
 * so the panel's is the focus that stays.
 */
export function bringRefusedPanelForward(): void {
  window.setTimeout(() => {
    for (const panel of openPanels.values()) panel.focusRefused();
  }, 0);
}

function subscribePanels(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => {
    panelListeners.delete(listener);
  };
}

function anyPanelHoldsChanges(): boolean {
  return [...openPanels.values()].some(panel => panel.holdsChanges());
}

/**
 * Whether an open settings panel holds a change Done has not kept: what the dashboard's own leave
 * prompt also asks about while customising, where a panel leaves the asking to it.
 */
export function useSettingsPanelHoldsChanges(): boolean {
  return useSyncExternalStore(
    subscribePanels,
    anyPanelHoldsChanges,
    () => false
  );
}

function useOnePanelOpen(
  placementId: string,
  open: boolean,
  holdsChanges: boolean,
  handlers: Pick<OpenPanel, "close" | "askToLeave" | "stage" | "focusRefused">
) {
  const changes = useRef(holdsChanges);
  changes.current = holdsChanges;
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!open) return undefined;
    openPanels.set(placementId, {
      holdsChanges: () => changes.current,
      close: () => latest.current.close(),
      askToLeave: then => latest.current.askToLeave(then),
      stage: () => latest.current.stage(),
      focusRefused: () => latest.current.focusRefused(),
    });
    panelsChanged();
    return () => {
      openPanels.delete(placementId);
      panelsChanged();
    };
  }, [open, placementId]);
  // The dashboard's leave prompt follows whether this panel holds a change as it changes.
  useEffect(() => {
    if (open) panelsChanged();
  }, [open, holdsChanges]);
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

/** Why Done is off, why the last Done did not keep the change, and which stored values were reset. */
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
}: {
  setting: AnyWidgetSetting;
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
}) {
  // A setting with its own editor is drawn by it, whatever its type.
  if (setting.editor !== undefined) {
    return (
      <SettingEditorControl
        setting={setting}
        component={setting.editor.component}
        disabled={saving}
      />
    );
  }
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
  // what keeps that true. A textarea's bound is judged on Done (`drawnSetting`).
  return <FieldRenderer field={drawnSetting(setting)} mode="edit" />;
}

/** One section's settings, each with the notice its last change left beside it. */
function SectionFields({
  settings,
  sources,
  saving,
  widget,
  resetNotices,
}: {
  settings: readonly AnyWidgetSetting[];
  sources: WidgetSources;
  saving: boolean;
  widget: DashboardWidget | undefined;
  resetNotices: Readonly<Record<string, string>>;
}) {
  return (
    <>
      {settings.map(setting => (
        <div key={setting.name} className="flex flex-col gap-1.5">
          <SettingControl {...{ setting, sources, saving, widget }} />
          {/* Polite: the reader made the change, and hears what it reset beside it. */}
          {resetNotices[setting.name] === undefined ? null : (
            <p role="status" className="text-sm text-muted-foreground">
              {resetNotices[setting.name]}
            </p>
          )}
        </div>
      ))}
    </>
  );
}

/** The card's own title, with its automatic one as the placeholder and why Done refuses it. */
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

/** A section's heading and its "Reset to defaults" link, named for the section it resets. */
function SectionHeading({
  id,
  label,
  saving,
  onReset,
}: {
  id: string;
  label: string;
  saving: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 id={id} className="text-sm font-semibold text-foreground">
        {label}
      </h3>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0"
        disabled={saving}
        aria-label={`Reset ${label} to defaults`}
        onClick={onReset}
      >
        Reset to defaults
      </Button>
    </div>
  );
}

/**
 * One section of the panel. Advanced is folded until the reader opens it; Data and Display are
 * open.
 */
function PanelSection({
  section,
  label,
  saving,
  onReset,
  children,
}: {
  section: SettingSection;
  label: string;
  saving: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const id = useId();
  if (section !== "advanced") {
    return (
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <SectionHeading {...{ id, label, saving, onReset }} />
        {children}
      </section>
    );
  }
  return (
    <Collapsible asChild>
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <CollapsibleTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start px-0 font-semibold"
          >
            {label}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={saving}
              aria-label={`Reset ${label} to defaults`}
              onClick={onReset}
            >
              Reset to defaults
            </Button>
          </div>
          {children}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/** Cancel and Done, with Done off while saving or when it cannot keep a change. */
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
    <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
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

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const { open, title, settings, config, blocked, renderPreview } = props;
  // The collections and fields this reader may be offered, decided on the
  // server; absent until the session-gated half of the payload arrives.
  const sources = useBranding().widgetSources;
  const { stale, defaultValues } = usePanelBaseline(settings, config, sources);
  const { form, resetSection, resetNotices } = usePanelForm(
    open,
    settings,
    sources,
    defaultValues
  );
  const draft = usePanelDraft(form, settings, config);
  const own = useOwnTitle(open, props.ownTitle);
  const { saving, failure, submit, changeOpen } = usePanelDone(props);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldsRef = useRef<HTMLFieldSetElement>(null);

  // What Done would keep, against what the panel opened on: the leave prompt asks only when the
  // two differ, and another card's panel opening closes this one only when they do not.
  const opened = useMemo(
    () => toStoredConfig(settings, defaultValues, config),
    [settings, defaultValues, config]
  );
  const kept: PanelKept = useMemo(
    () => ({ config: draft, ownTitle: own.ownTitle.trim() }),
    [draft, own.ownTitle]
  );
  const holdsChanges =
    !sameSettingValue(draft, opened) ||
    kept.ownTitle !== (props.ownTitle ?? "");
  // Another card's settings asked for while this panel holds a change: what to open once the
  // reader has answered this panel's prompt.
  const [leaving, setLeaving] = useState<(() => void) | undefined>(undefined);
  // Set by a refused staging, and cleared by the next one.
  const refused = useRef(false);

  /**
   * What Done would keep from `values`, or `undefined` when the panel's own checks refuse it,
   * each refusal said beside its field. The one reading of a panel's change, for Done and for the
   * dashboard's prompt staging it.
   */
  const keepable = (values: Record<string, unknown>): PanelKept | undefined => {
    // A note over its bound is refused here, by the counter the layout write uses, rather than
    // by the server after Done; so is a title too long for a card's header.
    const overlong = overlongSetting(settings, values);
    if (overlong) {
      form.setError(overlong.name, {
        type: "maxLength",
        message: overlongMessage(overlong.maxLength),
      });
      return undefined;
    }
    if (own.check() !== undefined) return undefined;
    return {
      config: toStoredConfig(settings, values, config),
      ownTitle: own.ownTitle.trim(),
    };
  };

  /** Done: the form's checks first, then the change kept. */
  const done = (values: Record<string, unknown>) => {
    const kept = keepable(values);
    if (kept !== undefined) void submit(kept);
  };

  /**
   * This panel's change as Done would keep it, for the dashboard's prompt to save with the rest:
   * judged by the same checks, the form's rules included, so a change Done would refuse is never
   * staged. Refused, the panel shows why and takes focus on the first field it refuses.
   */
  const stage = async (): Promise<PanelKept | "invalid" | undefined> => {
    refused.current = false;
    if (!holdsChanges) return undefined;
    const valid = await form.trigger(undefined, { shouldFocus: true });
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

  useOnePanelOpen(props.placementId, open, holdsChanges, {
    close: () => changeOpen(false),
    askToLeave: then => setLeaving(() => then),
    stage,
    focusRefused,
  });

  const automatic = props.widget
    ? titleAsAsked(props.widget, draft, sources).title
    : title;
  const bySection = (section: SettingSection) =>
    settings.filter(setting => sectionOf(setting) === section);

  /** Every Filter setting emptied, as the reader's own change, so Done keeps it. */
  const clearFilters = () => {
    for (const setting of settings) {
      if (setting.type === "filter") {
        form.setValue(setting.name, "", { shouldDirty: true });
      }
    }
  };

  return (
    <UnsavedChangesGuard
      isDirty={open && holdsChanges}
      // Installed only while the panel is open: a closed panel holds nothing to lose. And not
      // while customising, where the dashboard's own prompt asks for it, so a leave is asked once.
      disabled={!open || props.defersLeave === true}
      onSave={() => submit(kept)}
    >
      <LeavePrompt
        open={leaving !== undefined}
        title={title}
        saving={saving}
        onKeep={() => setLeaving(undefined)}
        onDiscard={() => {
          const then = leaving;
          setLeaving(undefined);
          changeOpen(false);
          then?.();
        }}
        onSave={() => {
          const then = leaving;
          void submit(kept).then(landed => {
            setLeaving(undefined);
            if (landed) then?.();
          });
        }}
      />
      <Sheet open={open} onOpenChange={changeOpen} modal={false}>
        <SheetContent
          side="right"
          // 480 to 560 pixels from the small breakpoint up, the whole width below it. A column
          // whose own overflow is hidden, so the area below the header takes the height that is
          // left and scrolls inside it.
          className="flex w-full flex-col overflow-hidden sm:w-[520px] sm:min-w-[480px] sm:max-w-[560px]"
          // Not modal: the dashboard behind stays usable, so a click on it is the reader using
          // it, never a request to throw the panel's changes away.
          onInteractOutside={event => event.preventDefault()}
          onCloseAutoFocus={event => {
            const target = props.returnFocusTo?.();
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          {...(props.focusFirstField
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
            : {})}
        >
          <SheetHeader>
            <SheetTitle>{title} settings</SheetTitle>
            <SheetDescription>
              These apply to this card only. Another copy of the same widget
              keeps its own.
            </SheetDescription>
          </SheetHeader>

          <FormProvider {...form}>
            <form
              ref={formRef}
              // `handleSubmit` answers with a promise and `onSubmit` expects
              // nothing back, so the result is voided deliberately rather than
              // handed to an attribute that would ignore it silently.
              onSubmit={event => {
                void form.handleSubmit(done)(event);
              }}
              className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4"
            >
              {renderPreview ? renderPreview(kept, clearFilters) : null}
              <PanelNotices {...{ blocked, failure, stale }} />
              {/* Frozen while Done saves: the save carries the values Done was pressed on, so a
                  field changed after it would be dropped without a word when the panel closes.
                  A disabled fieldset disables every control inside it, the custom ones too. */}
              <fieldset
                ref={fieldsRef}
                disabled={saving}
                className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
              >
                {SECTIONS.map(({ section, label }) => {
                  const inSection = bySection(section);
                  // Display holds every card's title; the others only what the widget declares.
                  if (section !== "display" && inSection.length === 0) {
                    return null;
                  }
                  return (
                    <PanelSection
                      key={section}
                      section={section}
                      label={label}
                      saving={saving}
                      onReset={() => {
                        resetSection(section);
                        if (section === "display") own.setOwnTitle("");
                      }}
                    >
                      {section === "display" ? (
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
                        widget={props.widget}
                        resetNotices={resetNotices}
                      />
                    </PanelSection>
                  );
                })}
              </fieldset>
              <PanelActions
                saving={saving}
                blocked={blocked}
                onCancel={() => changeOpen(false)}
              />
            </form>
          </FormProvider>
        </SheetContent>
      </Sheet>
    </UnsavedChangesGuard>
  );
}
