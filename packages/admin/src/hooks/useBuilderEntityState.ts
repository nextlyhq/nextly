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
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";
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

export interface BuilderEntityState {
  /** Null until the entity has loaded. */
  settings: BuilderSettingsValues | null;
  setSettings: (next: BuilderSettingsValues) => void;
  /** False until the entity has been read into the builder. */
  isInitialized: boolean;
  /** Fields changed since load, plus one if any setting differs. Drives the
   *  toolbar's Save enable state. */
  unsavedCount: number;
  /** Re-pin the field baseline: the current fields are now what is saved. */
  pinFields: () => void;
  /** Re-pin the settings baseline. Called when the write lands, not when it is
   *  sent — clearing first would show a clean form over stale stored values. */
  pinSettings: (saved: BuilderSettingsValues) => void;
}

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

  const { setFields } = builder;

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
    setFields(allFields);
    setOriginalFields(allFields.filter(f => !f.isSystem));

    const loaded = toSettings(entity);
    setSettings(loaded);
    setOriginalSettings(loaded);

    setLoadedKey(currentKey);
  }, [entity, currentKey, loadedKey, setFields, toFields, toSettings, onLoad]);

  // False while a different entity's data is still on screen, so the page
  // holds its loading state rather than briefly drawing the previous record
  // under the new one's name.
  const isInitialized = currentKey !== null && loadedKey === currentKey;

  const unsavedCount = useMemo(() => {
    const fieldChanges = originalFields
      ? countDirtyFields(
          originalFields,
          builder.fields.filter(f => !f.isSystem)
        )
      : 0;
    return fieldChanges + (isDirty(originalSettings, settings) ? 1 : 0);
  }, [builder.fields, originalFields, originalSettings, settings, isDirty]);

  const pinFields = useCallback(() => {
    setOriginalFields(builder.fields.filter(f => !f.isSystem));
  }, [builder.fields]);

  const pinSettings = useCallback((saved: BuilderSettingsValues) => {
    setOriginalSettings(saved);
  }, []);

  return {
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    pinFields,
    pinSettings,
  };
}
