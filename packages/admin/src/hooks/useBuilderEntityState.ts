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
import { useCallback, useEffect, useMemo, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";
import {
  convertToBuilderField,
  DEFAULT_SYSTEM_FIELDS,
  SYSTEM_FIELD_NAMES,
} from "@admin/lib/builder";
import { collectFieldIds } from "@admin/lib/builder/field-placement";
import {
  describeStep,
  type PendingChange,
  pendingChanges,
  type RowMark,
  rowMarks,
} from "@admin/lib/builder/pending-changes";
import {
  type SettingChange,
  settingChanges,
} from "@admin/lib/builder/settings-changes";
import type { FieldDefinition } from "@admin/types/collection";

import type { BuilderSnapshot } from "./useFieldBuilder";

export interface UseBuilderEntityStateOptions<TEntity> {
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

export function useBuilderEntityState<TEntity>({
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
  const [originalSettings, setOriginalSettings] =
    useState<BuilderSettingsValues | null>(null);

  const { resetFields } = builder;

  const currentKey = entity ? identity(entity) : null;

  useEffect(() => {
    if (!entity || loadedKey === currentKey) return;

    onLoad(entity);

    const userFields = toFields(entity).filter(
      f => !SYSTEM_FIELD_NAMES.includes(f.name)
    );
    const allFields = [
      ...DEFAULT_SYSTEM_FIELDS,
      ...userFields.map((field, index) => convertToBuilderField(field, index)),
    ];
    // A load is no edit: the fields and settings arrive with no history to
    // undo into.
    const loaded = toSettings(entity);
    resetFields(allFields, loaded);
    // Nothing of an unsaved entity is saved, so none of its fields are either.
    setOriginalFields(unsaved ? NO_FIELDS : allFields.filter(f => !f.isSystem));
    setOriginalSettings(loaded);

    setLoadedKey(currentKey);
  }, [
    entity,
    currentKey,
    loadedKey,
    resetFields,
    toFields,
    toSettings,
    onLoad,
    unsaved,
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
    // The snapshot itself, as the history holds it, so the history finds the
    // place the save was made from.
    clearHistory(saved, builder.historyStep);
  }, [builder.snapshot, builder.historyStep, clearHistory]);

  const pinSettings = useCallback((saved: BuilderSettingsValues) => {
    setOriginalSettings(saved);
  }, []);

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
    [rewriteSnapshots]
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
  savedSettings: BuilderSettingsValues | null,
  changedSettings: readonly SettingChange[]
): BuilderPendingChanges {
  const { fields, resetFields, undo: undoFields, redo: redoFields } = builder;
  // The net changes from what was saved, by field identity.
  const changes = useMemo(
    () => (saved ? pendingChanges(saved, fields) : []),
    [saved, fields]
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
    // The builder's own system rows stay as they are: they are never changed.
    // The saved settings come back with the fields, in one fresh history.
    resetFields(
      [...fields.filter(f => f.isSystem), ...(saved ?? [])],
      savedSettings ?? undefined
    );
  }, [resetFields, fields, saved, savedSettings]);
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
