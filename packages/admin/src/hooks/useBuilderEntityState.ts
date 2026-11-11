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
import type { FieldDefinition } from "@admin/types/collection";

export interface UseBuilderEntityStateOptions<TEntity> {
  /** The loaded entity, or undefined while the query is in flight. */
  entity: TEntity | undefined;
  builder: BuilderFieldsApi;
  /** The entity's field definitions, in server shape. */
  toFields: (entity: TEntity) => FieldDefinition[];
  /** The settings the page opens with. */
  toSettings: (entity: TEntity) => BuilderSettingsValues;
  /** Whether two settings snapshots differ enough to enable Save. */
  isDirty: (
    original: BuilderSettingsValues | null,
    current: BuilderSettingsValues | null
  ) => boolean;
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
}

/** The Builder's pending changes, and what a person can do with them. */
export interface BuilderPendingChanges {
  /** Each field's net change since the save, by field identity. */
  changes: readonly PendingChange[];
  /** Each changed field's row marks, by field id. */
  marks: ReadonlyMap<string, ReadonlySet<RowMark>>;
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
}

export interface BuilderEntityState {
  pending: BuilderPendingChanges;
  /** Null until the entity has loaded. */
  settings: BuilderSettingsValues | null;
  setSettings: (next: BuilderSettingsValues) => void;
  /** False until the entity has been read into the builder. */
  isInitialized: boolean;
  /** Fields changed since load, plus one if any setting differs. Drives the
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
}

/** One empty list, so a page with nothing loaded keeps one baseline object. */
const NO_FIELDS: readonly BuilderField[] = [];

export function useBuilderEntityState<TEntity>({
  entity,
  builder,
  toFields,
  toSettings,
  isDirty,
  onLoad,
  identity,
}: UseBuilderEntityStateOptions<TEntity>): BuilderEntityState {
  const [settings, setSettings] = useState<BuilderSettingsValues | null>(null);
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
    // A load is no edit: the fields arrive with no history to undo into.
    resetFields(allFields);
    setOriginalFields(allFields.filter(f => !f.isSystem));

    const loaded = toSettings(entity);
    setSettings(loaded);
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
  ]);

  // False while a different entity's data is still on screen, so the page
  // holds its loading state rather than briefly drawing the previous record
  // under the new one's name.
  const isInitialized = currentKey !== null && loadedKey === currentKey;

  // The settings are put back by this hook, which holds their baseline; the
  // fields by the pending changes, which hold theirs.
  const resetSettings = useCallback(() => {
    if (originalSettings) setSettings(originalSettings);
  }, [originalSettings]);
  const pending = useFieldPendingChanges(
    builder,
    originalFields,
    resetSettings
  );
  // Derived from the change list, so the number shown and the changes listed
  // and marked cannot disagree.
  const unsavedCount =
    pending.changes.length + (isDirty(originalSettings, settings) ? 1 : 0);

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
    const saved = builder.fields;
    setOriginalFields(saved.filter(f => !f.isSystem));
    clearHistory(saved);
  }, [builder.fields, clearHistory]);

  const pinSettings = useCallback((saved: BuilderSettingsValues) => {
    setOriginalSettings(saved);
  }, []);

  return {
    pending,
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    savedFieldIds,
    pinFields,
    pinSettings,
  };
}

/**
 * The pending changes of a builder's fields, measured from `saved`: the net
 * change list and each row's marks, Undo and Redo answering with what they
 * did, and Discard all, which also runs `resetSettings`.
 */
function useFieldPendingChanges(
  builder: BuilderFieldsApi,
  saved: readonly BuilderField[] | null,
  resetSettings: () => void
): BuilderPendingChanges {
  const { fields, resetFields, undo: undoFields, redo: redoFields } = builder;
  // The net changes from what was saved, by field identity.
  const changes = useMemo(
    () => (saved ? pendingChanges(saved, fields) : []),
    [saved, fields]
  );
  const marks = useMemo(
    () => (saved ? rowMarks(saved, fields) : new Map<string, Set<RowMark>>()),
    [saved, fields]
  );
  const undo = useCallback(() => {
    const step = undoFields();
    // What the step undone did, from the fields before it to those after.
    return step ? `Undid: ${describeStep(step.to, step.from)}` : null;
  }, [undoFields]);
  const redo = useCallback(() => {
    const step = redoFields();
    return step ? `Redid: ${describeStep(step.from, step.to)}` : null;
  }, [redoFields]);
  const discardAll = useCallback(() => {
    // The builder's own system rows stay as they are: they are never changed.
    resetFields([...fields.filter(f => f.isSystem), ...(saved ?? [])]);
    resetSettings();
  }, [resetFields, fields, saved, resetSettings]);
  return {
    changes,
    marks,
    saved: saved ?? NO_FIELDS,
    canUndo: builder.canUndo,
    canRedo: builder.canRedo,
    undo,
    redo,
    discardAll,
  };
}
