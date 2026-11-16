/**
 * The entities created in the Schema Builder and not saved yet.
 *
 * Create adds pending changes rather than writing to the server, so a new
 * entity lives here, and nowhere on the server, from Create until its save, its
 * Discard all, or a confirmed leave of its editor. The store is a module-level
 * value, so it belongs to the browser tab: a reload or a second tab starts
 * without it, and the leave guard asks before a reload drops it.
 *
 * Components read it through `useUnsavedEntity` (`useSyncExternalStore`), so an
 * editor re-renders when its entity is added or removed.
 *
 * @module lib/builder/unsaved-entities
 */
import { useMemo, useSyncExternalStore } from "react";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import type { PendingAddress } from "@admin/services/addressCheckApi";
import type { FieldDefinition } from "@admin/types/collection";

import { toSnakeName } from "./field-transformers";

/** An entity created in the dialog and not saved yet. */
export interface UnsavedEntity {
  kind: BuilderKind;
  /**
   * Which entity this is, given when it is added and kept when its address
   * changes, so an editor knows it for the same entity under its new address.
   */
  token: string;
  /** The API address the dialog checked; the entity's key until it is saved. */
  address: string;
  /** What the dialog set, the baseline of the entity's settings. */
  settings: BuilderSettingsValues;
  /**
   * The fields it starts with (the starting field, if one was chosen), in the
   * server's shape, as the editor loads a saved entity's.
   */
  fields: FieldDefinition[];
  /**
   * The entity whose field picker made it, for a field group made there: that
   * entity's save creates it, and its Discard all lets it go. Absent for one
   * made from its own create page, whose editor's first save creates it.
   */
  ownedBy?: { kind: BuilderKind; address: string };
}

/**
 * A field group as the new-entity dialog set it, not saved yet: named by the
 * dialog's address (or the name's snake_case form when the address is blank),
 * with no fields, which are added in its editor.
 */
export function unsavedFieldGroupFrom(
  values: BuilderSettingsValues,
  ownedBy?: UnsavedEntity["ownedBy"]
): Omit<UnsavedEntity, "token"> {
  const singularName = values.singularName.trim();
  const address = values.slug?.trim() || toSnakeName(singularName);
  return {
    kind: "field-group",
    address,
    settings: { ...values, singularName, slug: address },
    fields: [],
    ...(ownedBy ? { ownedBy } : {}),
  };
}

/** The address check's name for each kind. */
const CHECK_KIND: Record<BuilderKind, PendingAddress["kind"]> = {
  collection: "collection",
  single: "single",
  "field-group": "fieldGroup",
};

// One entry per kind and address. A new Map replaces the old on every change,
// so `useSyncExternalStore` sees a changed snapshot exactly when the store
// changes.
let entities: ReadonlyMap<string, UnsavedEntity> = new Map();
const listeners = new Set<() => void>();
/** The token the next entity added takes. */
let nextToken = 1;

function keyOf(kind: BuilderKind, address: string): string {
  return `${kind}:${address}`;
}

function replace(next: ReadonlyMap<string, UnsavedEntity>): void {
  entities = next;
  for (const listener of listeners) listener();
}

/**
 * Holds a created entity. Returns false, keeping the one already held, when an
 * entity of that kind already waits under the address: the dialog's check
 * refuses such an address before Create, so a second one here is a caller's
 * mistake that must not replace the first entity's work.
 */
export function addUnsavedEntity(
  entity: Omit<UnsavedEntity, "token">
): boolean {
  const key = keyOf(entity.kind, entity.address);
  if (entities.has(key)) return false;
  const next = new Map(entities);
  next.set(key, { ...entity, token: `unsaved-${nextToken++}` });
  replace(next);
  return true;
}

/**
 * Moves an unsaved entity to a new address, its settings' address with it,
 * keeping its token; the field groups its picker made name it as their owner
 * under the new address. Returns false, changing nothing, when no entity of that
 * kind waits under `from` or one already waits under `to`: the settings check
 * the new address against every other unsaved entity first, so either is a
 * caller's mistake that must not lose an entity's work.
 */
export function renameUnsavedEntity(
  kind: BuilderKind,
  from: string,
  to: string
): boolean {
  const held = entities.get(keyOf(kind, from));
  if (!held || entities.has(keyOf(kind, to))) return false;
  const next = new Map(entities);
  next.delete(keyOf(kind, from));
  next.set(keyOf(kind, to), {
    ...held,
    address: to,
    settings: { ...held.settings, slug: to },
  });
  // The field groups its picker made move with it: its save still creates them, and its
  // Discard all still lets them go.
  for (const [key, entity] of next) {
    if (entity.ownedBy?.kind === kind && entity.ownedBy.address === from) {
      next.set(key, { ...entity, ownedBy: { kind, address: to } });
    }
  }
  replace(next);
  return true;
}

/** Lets an entity go: saved, discarded, or its editor left. */
export function removeUnsavedEntity(kind: BuilderKind, address: string): void {
  const key = keyOf(kind, address);
  // Removing what is not held changes nothing, so readers are not told.
  if (!entities.has(key)) return;
  const next = new Map(entities);
  next.delete(key);
  replace(next);
}

/** The unsaved entity of that kind under the address, if one waits. */
export function unsavedEntity(
  kind: BuilderKind,
  address: string
): UnsavedEntity | undefined {
  return entities.get(keyOf(kind, address));
}

/** Each entity's address, as the address check names its kind. */
function addressesOf(
  held: ReadonlyMap<string, UnsavedEntity>
): PendingAddress[] {
  return [...held.values()].map(entity => ({
    kind: CHECK_KIND[entity.kind],
    address: entity.address,
  }));
}

/**
 * Every unsaved entity's address, as the server's address check takes its
 * `pendingCreates`: each holds its address until it is saved or discarded.
 */
export function unsavedAddresses(): PendingAddress[] {
  return addressesOf(entities);
}

/** `held` without the address of the entity of `kind` under `address`. */
function besides(
  held: readonly PendingAddress[],
  kind: BuilderKind,
  address: string
): PendingAddress[] {
  return held.filter(
    other => !(other.kind === CHECK_KIND[kind] && other.address === address)
  );
}

/**
 * Every unsaved entity's address but the one of `kind` under `address`: what
 * that entity's own address is checked against, so it is not used against
 * itself.
 */
export function unsavedAddressesBesides(
  kind: BuilderKind,
  address: string
): PendingAddress[] {
  return besides(addressesOf(entities), kind, address);
}

/** Calls `listener` on every change to the store; returns its unsubscribe. */
export function subscribeUnsavedEntities(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The unsaved entity of that kind under the address, kept current. */
export function useUnsavedEntity(
  kind: BuilderKind,
  address: string
): UnsavedEntity | undefined {
  return useSyncExternalStore(
    subscribeUnsavedEntities,
    () => unsavedEntity(kind, address),
    () => undefined
  );
}

const NOTHING_HELD: ReadonlyMap<string, UnsavedEntity> = new Map();

/** The store's snapshot, kept current: a new Map exactly when the store changes. */
function useHeld(): ReadonlyMap<string, UnsavedEntity> {
  return useSyncExternalStore(
    subscribeUnsavedEntities,
    () => entities,
    () => NOTHING_HELD
  );
}

/**
 * Every unsaved entity's address, kept current, for the dialog's address
 * check. Derived from the store's own snapshot, so the list is a new value
 * exactly when the store changes.
 */
export function useUnsavedAddresses(): readonly PendingAddress[] {
  const held = useHeld();
  return useMemo(() => addressesOf(held), [held]);
}

/** Every unsaved entity of `kind`, in the order made, kept current. */
export function useUnsavedEntitiesOf(
  kind: BuilderKind
): readonly UnsavedEntity[] {
  const held = useHeld();
  return useMemo(
    () => [...held.values()].filter(entity => entity.kind === kind),
    [held, kind]
  );
}

/** `unsavedAddressesBesides`, kept current. */
export function useUnsavedAddressesBesides(
  kind: BuilderKind,
  address: string
): readonly PendingAddress[] {
  const held = useUnsavedAddresses();
  return useMemo(() => besides(held, kind, address), [held, kind, address]);
}
