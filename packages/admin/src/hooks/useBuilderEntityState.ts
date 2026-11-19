"use client";

/**
 * useBuilderEntityState — loading an entity into the builder once, and knowing
 * afterwards what the user has changed.
 *
 * Every builder page did this itself: the same one-shot effect, the same four
 * pieces of state, the same pair of baselines re-pinned by hand after each of
 * two kinds of save. What genuinely differs per kind is only how the server's
 * shape becomes `BuilderSettingsValues` and which of those values count toward
 * dirtiness, so those arrive as functions and the rest lives here.
 *
 * The baselines are what make the Save button honest: a field edit and a
 * settings edit are diffed against the values the page loaded with, so a change
 * and a change-back both read as clean.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";
import { convertToBuilderField } from "@admin/lib/builder";
import {
  builtInFieldsAsStored,
  choosesBuiltInUnique,
} from "@admin/lib/builder/constants";
import { collectFieldIds } from "@admin/lib/builder/field-placement";
import {
  builtInChanges,
  describeStep,
  type PendingChange,
  pendingChanges,
  type RowMark,
  rowMarks,
} from "@admin/lib/builder/pending-changes";
import type { SchemaTemplateKind } from "@admin/lib/builder/schema-templates";
import {
  type SettingChange,
  settingChanges,
} from "@admin/lib/builder/settings-changes";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderSnapshot } from "./useFieldBuilder";

export interface UseBuilderEntityStateOptions<TEntity> {
  /**
   * Which kind of entity this is, which decides the built-in fields shown above its own
   * (`builtInFieldsAsStored`): a collection's and a Single's title and slug, none for a field group,
   * whose fields of those names are its own.
   */
  kind: SchemaTemplateKind;
  /** The loaded entity, or undefined while the query is in flight. */
  entity: TEntity | undefined;
  builder: BuilderFieldsApi;
  /** The entity's field definitions, in server shape. */
  toFields: (entity: TEntity) => FieldDefinition[];
  /** The settings the page opens with. */
  toSettings: (entity: TEntity) => BuilderSettingsValues;
  /** Run once when the entity lands — resetting the metadata form, and any
   *  seeding only this kind needs. */
  onLoad: (entity: TEntity) => void;
  /**
   * What makes this entity a different one, usually its slug.
   *
   * Taken from the ENTITY rather than the route: the router renders each page
   * component without a key, so navigating from one builder to another reuses
   * the same instance and its state. Keyed on the route, a load could also fire
   * against whichever entity the query still held while the new slug's request
   * was in flight, and pin baselines from the wrong record.
   */
  identity: (entity: TEntity) => string;
  /**
   * The entity was created in the editor and is not on the server yet. Its
   * baseline is then no fields at all, so the fields it starts with are pending
   * additions, and the create itself counts as one more pending change until a
   * save brings the entity back from the server under its own identity.
   */
  unsaved?: boolean;
}

/** The Builder's pending changes, and what a person can do with them. */
export interface BuilderPendingChanges {
  /** Each field's net change since the save, by field identity. */
  changes: readonly PendingChange[];
  /** Each changed field's row marks, by field id. */
  marks: ReadonlyMap<string, ReadonlySet<RowMark>>;
  /** Each of the entity's settings changed since the save, named. */
  settingChanges: readonly SettingChange[];
  /**
   * The fields as last saved, system rows excluded: the baseline the changes
   * are counted from, and where a pending delete is shown and still holds its
   * name.
   */
  saved: readonly BuilderField[];
  canUndo: boolean;
  canRedo: boolean;
  /** Undo one step, answering with what it undid, for announcing. */
  undo: () => string | null;
  /** Redo one step, answering with what it redid, for announcing. */
  redo: () => string | null;
  /** Put back the saved fields and settings, with nothing left to undo. */
  discardAll: () => void;
  /**
   * Discard all also leaves the editor: the entity itself was never saved, so
   * discarding its changes discards it and returns to the list. That leave
   * answers the leave guard's question, so it is not asked.
   */
  discardLeaves?: boolean;
}

export interface BuilderEntityState {
  pending: BuilderPendingChanges;
  /** Null until the entity has loaded. */
  settings: BuilderSettingsValues | null;
  setSettings: (next: BuilderSettingsValues) => void;
  /** False until the entity has been read into the builder. */
  isInitialized: boolean;
  /** Fields changed since load, plus each setting changed. Drives the
   *  toolbar's Save enable state. */
  unsavedCount: number;
  /**
   * The id of every field in the saved baseline, nested ones included. A field
   * whose id is here has been saved, so its name no longer follows its label;
   * one added since has not. Re-pinning the fields moves the line.
   */
  savedFieldIds: ReadonlySet<string>;
  /** Re-pin the field baseline: the current fields are now what is saved. */
  pinFields: () => void;
  /** Re-pin the settings baseline. Called when the write lands, not when it is
   *  sent — clearing first would show a clean form over stale stored values. */
  pinSettings: (saved: BuilderSettingsValues) => void;
  /**
   * An unsaved entity's address moved: every state the history holds, and the
   * settings it is measured from, take the new address. No step, so Undo does
   * not take the move back and nothing pending is counted for it.
   */
  moveAddress: (address: string) => void;
}

/** One empty list, so a page with nothing loaded keeps one baseline object. */
const NO_FIELDS: readonly BuilderField[] = [];
const NO_SETTING_CHANGES: readonly SettingChange[] = [];

type SettingsUpdate =
  | BuilderSettingsValues
  | null
  | ((prev: BuilderSettingsValues | null) => BuilderSettingsValues | null);

/**
 * The settings as last written, as state for rendering, and the same value as
 * of now for the pins: a save calls them from the render it started in, in
 * either order, and the second must see what the first pinned.
 */
function useSettingsBaseline(): [
  BuilderSettingsValues | null,
  (next: SettingsUpdate) => void,
  { readonly current: BuilderSettingsValues | null },
] {
  const [baseline, setBaseline] = useState<BuilderSettingsValues | null>(null);
  const now = useRef<BuilderSettingsValues | null>(null);
  const set = useCallback((next: SettingsUpdate) => {
    now.current = typeof next === "function" ? next(now.current) : next;
    setBaseline(now.current);
  }, []);
  return [baseline, set, now];
}

/**
 * The state kept before a saved snapshot whose settings are not written yet:
 * its fields with the settings as last written, so Undo takes back only what
 * is still to land. None when its settings are the written ones.
 */
function writtenBefore(
  saved: BuilderSnapshot,
  written: BuilderSettingsValues | null
): BuilderSnapshot | undefined {
  if (written === null || saved.settings === null) return undefined;
  if (settingChanges(written, saved.settings).length === 0) return undefined;
  return { fields: saved.fields, settings: written };
}

export function useBuilderEntityState<TEntity>({
  kind,
  entity,
  builder,
  toFields,
  toSettings,
  onLoad,
  identity,
  unsaved = false,
}: UseBuilderEntityStateOptions<TEntity>): BuilderEntityState {
  // The settings shown live in the builder's history beside the fields, so
  // Undo, Redo and Discard all take a settings change back as a field's.
  const { settings, setSettings } = builder;
  // Which entity was read in, rather than whether one was. A boolean cannot
  // tell "already loaded this" from "already loaded something", and the second
  // is what leaves a reused component showing the previous entity's fields.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Frozen copies of what the page loaded with. Both are arrays/objects rather
  // than hashes so every editable property takes part in the comparison — an
  // earlier id-only check silently missed label, width, validation and option
  // edits.
  const [originalFields, setOriginalFields] = useState<
    readonly BuilderField[] | null
  >(null);
  // The built-in rows as loaded or last saved, apart from the user's fields: the one setting of
  // theirs a person changes (a title's Unique) is measured from these (`builtInChanges`).
  const [savedBuiltIns, setSavedBuiltIns] =
    useState<readonly BuilderField[]>(NO_FIELDS);
  const [originalSettings, setOriginalSettings, baselineNow] =
    useSettingsBaseline();

  const { resetFields } = builder;

  const currentKey = entity ? identity(entity) : null;

  useEffect(() => {
    if (!entity || loadedKey === currentKey) return;

    onLoad(entity);

    // The kind's built-in fields first (none for a field group), and the entity's own after:
    // a field of a built-in's name is left out only where the kind holds that built-in, so a
    // field group's own `title` or `slug` is shown, and saved, as any other field.
    // Each built-in row as stored: a title saved unique reloads with its Unique on.
    const stored = toFields(entity);
    const builtIn = builtInFieldsAsStored(kind, stored, field =>
      convertToBuilderField(field, field.name)
    );
    const builtInNames = builtIn.map(field => field.name);
    const userFields = stored.filter(f => !builtInNames.includes(f.name));
    const allFields = [
      ...builtIn,
      ...userFields.map((field, index) =>
        convertToBuilderField(field, index, false, builtInNames)
      ),
    ];
    // A load is no edit: the fields and settings arrive with no history to
    // undo into.
    const loaded = toSettings(entity);
    resetFields(allFields, loaded);
    // Nothing of an unsaved entity is saved, so none of its fields are either.
    setOriginalFields(unsaved ? NO_FIELDS : allFields.filter(f => !f.isSystem));
    setSavedBuiltIns(builtIn);
    setOriginalSettings(loaded);

    setLoadedKey(currentKey);
  }, [
    kind,
    entity,
    currentKey,
    loadedKey,
    resetFields,
    toFields,
    toSettings,
    onLoad,
    unsaved,
    setOriginalSettings,
  ]);

  // False while a different entity's data is still on screen, so the page
  // holds its loading state rather than briefly drawing the previous record
  // under the new one's name.
  const isInitialized = currentKey !== null && loadedKey === currentKey;

  // Each changed setting, from the one comparison the count, the undo
  // announcements and the review read.
  const changedSettings = useMemo(
    () =>
      originalSettings && settings
        ? settingChanges(originalSettings, settings)
        : NO_SETTING_CHANGES,
    [originalSettings, settings]
  );
  const pending = useFieldPendingChanges(
    builder,
    originalFields,
    savedBuiltIns,
    useCallback(
      (field: BuilderField) => choosesBuiltInUnique(kind, field),
      [kind]
    ),
    originalSettings,
    changedSettings
  );
  // Derived from the change lists, so the number shown and the changes listed
  // and marked cannot disagree.
  const unsavedCount =
    pending.changes.length +
    changedSettings.length +
    // The create itself, for an entity the server does not have yet.
    (unsaved && isInitialized ? 1 : 0);

  // Derived from the same baseline the unsaved count reads, so "saved" and
  // "changed since saved" cannot disagree about which fields were saved.
  const savedFieldIds = useMemo(
    () => collectFieldIds(originalFields ?? []),
    [originalFields]
  );

  // A save is the new starting point: what was changed is now what is saved,
  // and there is nothing before it to undo into.
  const { clearHistory } = builder;
  // The fields the save sent, as this render holds them: an edit made while
  // the save was on its way stays pending against them, and undoable.
  const pinFields = useCallback(() => {
    const saved = builder.snapshot;
    setOriginalFields(saved.fields.filter(f => !f.isSystem));
    setSavedBuiltIns(saved.fields.filter(f => f.isSystem));
    // The snapshot itself, as the history holds it, so the history finds the
    // place the save was made from. Settings still to be written share this
    // history, so one step stays before it: the saved fields with the settings
    // as last written. Undo then takes back only what is yet to land, and a
    // failed settings write leaves a change it can still take back
    // (`pinSettings` closes that step once the write lands).
    clearHistory(
      saved,
      builder.historyStep,
      writtenBefore(saved, baselineNow.current)
    );
  }, [builder.snapshot, builder.historyStep, clearHistory, baselineNow]);

  // The settings landed: they are the baseline, and nothing before this place
  // in the history can be undone any more.
  const pinSettings = useCallback(
    (saved: BuilderSettingsValues) => {
      setOriginalSettings(saved);
      clearHistory(builder.snapshot, builder.historyStep);
    },
    [builder.snapshot, builder.historyStep, clearHistory, setOriginalSettings]
  );

  const { rewriteSnapshots } = builder;
  const moveAddress = useCallback(
    (address: string) => {
      rewriteSnapshots(snapshot =>
        snapshot.settings
          ? { ...snapshot, settings: { ...snapshot.settings, slug: address } }
          : snapshot
      );
      setOriginalSettings(prev => (prev ? { ...prev, slug: address } : prev));
    },
    [rewriteSnapshots, setOriginalSettings]
  );

  return {
    pending,
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    savedFieldIds,
    pinFields,
    pinSettings,
    moveAddress,
  };
}

/**
 * What one step of the history did, from `before` to `after`: a field's
 * change in the fields' words, or the settings it changed, named as the
 * Builder names them.
 */
function describeSnapshotStep(
  before: BuilderSnapshot,
  after: BuilderSnapshot
): string {
  if (before.fields === after.fields && before.settings && after.settings) {
    const changed = settingChanges(before.settings, after.settings);
    return `changed the settings: ${changed.map(c => c.label).join(", ")}`;
  }
  return describeStep(before.fields, after.fields);
}

/**
 * The pending changes of a builder's fields, measured from `saved`: the net
 * change list and each row's marks, Undo and Redo answering with what they
 * did, and Discard all, which puts back the saved fields and `savedSettings`.
 */
function useFieldPendingChanges(
  builder: BuilderFieldsApi,
  saved: readonly BuilderField[] | null,
  /** The built-in rows as loaded or last saved (`builtInChanges`). */
  savedBuiltIns: readonly BuilderField[],
  /** Whether a save sends a built-in row: only those count as changes. */
  savesBuiltIn: (field: BuilderField) => boolean,
  savedSettings: BuilderSettingsValues | null,
  changedSettings: readonly SettingChange[]
): BuilderPendingChanges {
  const { fields, resetFields, undo: undoFields, redo: redoFields } = builder;
  // The net changes from what was saved, by field identity.
  // The built-in rows' own changes first, where the Builder shows those rows.
  const changes = useMemo(
    () =>
      saved
        ? [
            ...builtInChanges(savedBuiltIns, fields, savesBuiltIn),
            ...pendingChanges(saved, fields),
          ]
        : [],
    [saved, savedBuiltIns, savesBuiltIn, fields]
  );
  const marks = useMemo(
    () =>
      saved
        ? rowMarks(saved, fields, changes)
        : new Map<string, Set<RowMark>>(),
    [saved, fields, changes]
  );
  const undo = useCallback(() => {
    const step = undoFields();
    // What the step undone did, from the fields before it to those after.
    return step ? `Undid: ${describeSnapshotStep(step.to, step.from)}` : null;
  }, [undoFields]);
  const redo = useCallback(() => {
    const step = redoFields();
    return step ? `Redid: ${describeSnapshotStep(step.from, step.to)}` : null;
  }, [redoFields]);
  const discardAll = useCallback(() => {
    // The built-in rows as saved, a title's Unique included, then the saved fields; the saved
    // settings come back with them, in one fresh history.
    resetFields(
      [...savedBuiltIns, ...(saved ?? [])],
      savedSettings ?? undefined
    );
  }, [resetFields, savedBuiltIns, saved, savedSettings]);
  return {
    changes,
    marks,
    settingChanges: changedSettings,
    saved: saved ?? NO_FIELDS,
    canUndo: builder.canUndo,
    canRedo: builder.canRedo,
    undo,
    redo,
    discardAll,
  };
}
