/**
 * Turning a stored snapshot back into something the normal update path accepts.
 *
 * Restore deliberately writes through the same update a human edit uses, so
 * validation, hooks, component and many-to-many writes, events and the outbox
 * all run identically. That leaves one job here: decide what of a snapshot may
 * be resubmitted.
 *
 * The decision is entirely schema-driven, and the schema is more layered than a
 * flat field list suggests — a presentational group's children sit at the
 * document's top level, a container's children live inside its stored value,
 * and a component names its child schema by slug rather than carrying it. Each
 * has to be resolved, or the filter passes through keys the table no longer has
 * or strips keys it still does.
 *
 * @module domains/versions/restore-snapshot
 */

import type { FieldConfig } from "../../collections/fields/types";
import { isFieldLocalized } from "../i18n/classify-fields";

/**
 * Columns a write must never carry.
 *
 * The collection update path strips these too, but only inside its transaction
 * — long after `beforeUpdate` hooks have seen the payload. Stripping here means
 * a hook is never handed a forged `createdBy` or a stale `createdAt`. The
 * singles path strips only `id` and `createdAt`, so for that path this is the
 * only place ownership is protected at all.
 */
const IMMUTABLE_FIELDS = new Set([
  "id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "createdBy",
  "created_by",
]);

/**
 * A component's own schema, as the payload filter needs to see it.
 *
 * The localization flag is the component's, not its parent's: a component keeps
 * its values in tables of its own, so an unlocalized component embedded in a
 * localized document stores one copy of each value regardless of the parent.
 */
export interface ComponentSchemaInfo {
  fields: FieldConfig[];
  localized: boolean;
  /**
   * Whether the component's schema was actually found. A slug that no longer
   * resolves is recorded as unresolved rather than as a component with no
   * fields: the two are indistinguishable by field count, and treating a
   * missing schema as an empty one would forward its stored subtree unchecked.
   */
  resolved: boolean;
}

/** Component schemas keyed by the slug a field references them under. */
export type ComponentSchemas = Map<string, ComponentSchemaInfo>;

/** What the current schema accepts, beyond its declared fields. */
export interface RestoreSchemaContext {
  /**
   * Whether the entity has draft/published status. Turning it off drops the
   * column, so a snapshot taken while it was on still carries `status`.
   */
  hasStatus: boolean;
  /**
   * Whether the entity has a `slug` column. It is synthesized for ordinary
   * collections, but a plugin collection has one only when it declares the
   * field, so it cannot be assumed.
   */
  hasSlug: boolean;
  /** Whether the entity has a `title` column, on the same terms as `slug`. */
  hasTitle: boolean;
  /**
   * The schema of each component slug this schema references. A component field
   * names its schema rather than carrying it, so without these the walk cannot
   * see inside one.
   */
  componentSchemas?: ComponentSchemas;
  /**
   * Whether the document stores its own values per locale. Distinct from
   * `localeUnknown`: an unlocalized document can still embed a localized
   * component, so the two are decided separately.
   */
  documentLocalized?: boolean;
  /**
   * Whether this is a localized document restoring a version that does not say
   * which locale it holds. Such a snapshot took its translatable values from
   * the main row rather than any language's companion, so those values belong
   * to no locale — but its shared fields are the entity's and restore fine.
   */
  localeUnknown?: boolean;
}

export interface RestorePayloadResult {
  /** What to submit through the normal update path. */
  payload: Record<string, unknown>;
  /**
   * Snapshot keys that cannot be applied to the current schema, whether because
   * the field is gone or because resubmitting it would destroy something. Named
   * rather than silently dropped, so a restore reports what it could not bring
   * back instead of appearing to restore the document exactly.
   */
  droppedFields: string[];
}

/** A field's declared children, when it carries them inline. */
function inlineChildren(field: FieldConfig): FieldConfig[] | undefined {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) ? (nested as FieldConfig[]) : undefined;
}

/** The component slugs a field references, which name its child schema. */
function componentSlugs(field: FieldConfig): string[] {
  const one = (field as { component?: unknown }).component;
  const many = (field as { components?: unknown }).components;
  const slugs: string[] = [];
  if (typeof one === "string") slugs.push(one);
  if (Array.isArray(many)) {
    for (const slug of many) if (typeof slug === "string") slugs.push(slug);
  }
  return slugs;
}

/**
 * Component slugs a field permits, or null when it is not a component field.
 *
 * Keyed on whether the field DECLARES a component key, not on how many slugs it
 * names. A dynamic zone stripped back to `components: []` permits nothing —
 * reading that as "permits anything" admits every stored instance to a save
 * path that has no component to apply them to, so the restore reports success
 * having quietly skipped the field.
 */
function allowedComponentSlugs(field: FieldConfig): Set<string> | null {
  const one = (field as { component?: unknown }).component;
  const many = (field as { components?: unknown }).components;
  const declaresComponent = typeof one === "string" || Array.isArray(many);
  return declaresComponent ? new Set(componentSlugs(field)) : null;
}

/**
 * Whether the field selects among several components rather than naming one.
 *
 * Only this shape stores a `_componentType` per row, and only its save path
 * reconciles the incoming set against the live one.
 */
function fieldNamesMultipleComponents(field: FieldConfig): boolean {
  return Array.isArray((field as { components?: unknown }).components);
}

/**
 * Whether the field is a container that now declares no children at all.
 *
 * Distinct from a field that carries no `fields` key: a scalar has nothing to
 * prune against, while an emptied container has lost every key its stored value
 * could still match.
 */
function declaresEmptyChildList(field: FieldConfig): boolean {
  const nested = (field as { fields?: unknown }).fields;
  return Array.isArray(nested) && nested.length === 0;
}

/** A field's children, wherever the schema keeps them. */
function childrenOf(
  field: FieldConfig,
  componentSchemas?: ComponentSchemas
): FieldConfig[] {
  const inline = inlineChildren(field);
  if (inline) return inline;

  const resolved: FieldConfig[] = [];
  for (const slug of componentSlugs(field)) {
    const component = componentSchemas?.get(slug);
    if (component) resolved.push(...component.fields);
  }
  return resolved;
}

/**
 * Whether every component this field reaches has a schema behind it.
 *
 * A slug that no longer resolves leaves the filter unable to inspect the
 * subtree, so it can neither prune unknown keys from it nor see a password
 * inside it. Restoring such a value blind is the one direction that cannot be
 * undone, so the field is reported instead.
 */
function componentsAllResolve(
  fields: FieldConfig[],
  componentSchemas?: ComponentSchemas,
  seen: Set<string> = new Set()
): boolean {
  return fields.every(field => {
    const slugs = componentSlugs(field);
    for (const slug of slugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      const component = componentSchemas?.get(slug);
      if (component === undefined || !component.resolved) return false;
      if (!componentsAllResolve(component.fields, componentSchemas, seen)) {
        return false;
      }
    }

    const inline = inlineChildren(field);
    return inline ? componentsAllResolve(inline, componentSchemas, seen) : true;
  });
}

/**
 * Whether anything in this subtree stores a password.
 *
 * Capture strips password values wherever they appear, so any value holding one
 * comes back incomplete. A field that is a password *now* counts too: it may
 * not have been when the snapshot was taken, and a text field converted later
 * leaves a readable value that restoring would hash over the live credential.
 */
function containsPasswordField(
  fields: FieldConfig[],
  componentSchemas?: ComponentSchemas,
  seen: Set<string> = new Set()
): boolean {
  return fields.some(field => {
    if (field.type === "password") return true;

    // A component can reference itself through a descendant, so a slug already
    // walked is not followed again.
    const slugs = componentSlugs(field);
    if (slugs.length > 0 && slugs.every(slug => seen.has(slug))) return false;
    for (const slug of slugs) seen.add(slug);

    const children = childrenOf(field, componentSchemas);
    return children.length > 0
      ? containsPasswordField(children, componentSchemas, seen)
      : false;
  });
}

/**
 * Whether anything in this subtree stores its value per locale.
 *
 * Classification follows the same rules the write path uses, so a field the
 * companion table owns is recognised here even when the schema leaves
 * `localized` unset and the per-type default decides it.
 *
 * `ownerLocalized` is the switch of the schema that DECLARES these fields, not
 * of the document being restored. Inline children share their parent's schema
 * and so its switch, but a component's fields are governed by the component's
 * own: an unlocalized component embedded in a localized document stores one
 * copy of each value, and holding those back would refuse content that
 * restores perfectly well.
 */
function containsLocalizedField(
  fields: FieldConfig[],
  ownerLocalized: boolean,
  componentSchemas?: ComponentSchemas,
  seen: Set<string> = new Set()
): boolean {
  return fields.some(field => {
    const declared = (field as { localized?: unknown }).localized;
    const localized = isFieldLocalized(
      {
        type: field.type,
        name: typeof field.name === "string" ? field.name : "",
        ...(typeof declared === "boolean" ? { localized: declared } : {}),
      },
      ownerLocalized
    );
    if (localized) return true;

    // A container's own classification governs its value: a group or repeater
    // is one JSON column on the main row, so its children are stored wherever
    // it is and are not per-locale on their own account — the write path
    // classifies top-level fields only, and a text child does not make the
    // container translatable. The walk still descends, because a COMPONENT
    // nested inside a container keeps its own per-locale rows; passing `false`
    // stops the children being classified by the document's switch while
    // leaving that check intact.
    const inline = inlineChildren(field);
    if (inline) {
      return containsLocalizedField(inline, false, componentSchemas, seen);
    }

    // A component can reference itself through a descendant, so a slug already
    // walked is not followed again.
    const slugs = componentSlugs(field);
    if (slugs.length > 0 && slugs.every(slug => seen.has(slug))) return false;
    for (const slug of slugs) seen.add(slug);

    return slugs.some(slug => {
      const component = componentSchemas?.get(slug);
      return component === undefined
        ? false
        : containsLocalizedField(
            component.fields,
            component.localized,
            componentSchemas,
            seen
          );
    });
  });
}

/**
 * Fields addressable at the document's top level.
 *
 * A group with no name is presentational: it exists to lay fields out, and its
 * children are stored at this level rather than under the group. Treating it as
 * one key would drop every field inside it as unknown.
 */
function topLevelFields(fields: FieldConfig[]): Map<string, FieldConfig> {
  const byName = new Map<string, FieldConfig>();

  const walk = (list: FieldConfig[]): void => {
    for (const field of list) {
      if (typeof field.name === "string" && field.name.length > 0) {
        byName.set(field.name, field);
        continue;
      }

      // Presentational groups nest, so flattening one level would leave a
      // grandchild's key looking like a field the schema no longer has.
      if (field.type === "group") walk(inlineChildren(field) ?? []);
    }
  };

  walk(fields);
  return byName;
}

/**
 * Remove keys the current schema no longer declares from a container's stored
 * value, recursively.
 *
 * The update writes a container as one JSON value, and validation walks the
 * schema's fields rather than the value's keys — so a key removed from the
 * schema is neither rejected nor stripped. It would be written back into the
 * column and served again as though it were still part of the document.
 *
 * `storesType` says whether the write path reads `_componentType` back off this
 * value. Only a dynamic zone does; a single-component field takes the component
 * from the schema.
 */
function pruneContainerValue(
  value: unknown,
  fields: FieldConfig[],
  componentSchemas: ComponentSchemas | undefined,
  removed: string[],
  path: string,
  isComponentValue: boolean,
  storesType: boolean
): unknown {
  if (Array.isArray(value)) {
    return value.map((row, i) =>
      pruneContainerValue(
        row,
        fields,
        componentSchemas,
        removed,
        `${path}[${i}]`,
        isComponentValue,
        storesType
      )
    );
  }

  if (typeof value !== "object" || value === null) return value;

  // A dynamic zone resolves to every allowed component's fields concatenated,
  // but each row belongs to exactly one of them. Pruning against the union
  // keeps a key that this row's component has since lost merely because a
  // sibling component still declares it — and the save path, which serializes
  // against the row's own schema, then drops it without saying so.
  const rowType = (value as { _componentType?: unknown })._componentType;
  const rowSchema =
    isComponentValue && typeof rowType === "string"
      ? componentSchemas?.get(rowType)
      : undefined;
  const effectiveFields = rowSchema?.resolved ? rowSchema.fields : fields;

  const known = topLevelFields(effectiveFields);
  const out: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    // Row metadata rather than schema fields, and both are needed to write a
    // component back: the type discriminator selects the component, and the id
    // lets the save path update the existing row. Dropping the id would make a
    // restore delete and reinsert instances, taking their per-locale companion
    // rows and any other row-scoped state with them.
    //
    // Only for component instances. A group or repeater is ordinary JSON, where
    // a stale key that happens to be called `id` is exactly the kind of unknown
    // key this function exists to remove.
    if (isComponentValue && (key === "_componentType" || key === "id")) {
      // The type marker exists to record what the snapshot captured, and it has
      // already done its work above by selecting this row's schema. Carrying it
      // into the payload is only safe where the write path consumes it, which
      // is the dynamic zone alone. A single component nested in a group or
      // repeater is written as part of that container's JSON, and a marker left
      // inside would be stored verbatim and then served by ordinary reads.
      if (key === "_componentType" && !storesType) continue;
      out[key] = child;
      continue;
    }

    const field = known.get(key);
    if (!field) {
      removed.push(`${path}.${key}`);
      continue;
    }

    const grandchildren = childrenOf(field, componentSchemas);

    // A component nested in a container is checked against the components its
    // field allows, exactly as a top-level one is. Without this the snapshot's
    // recorded type is read only to pick a schema, so a value captured under a
    // component the field has since stopped naming would be pruned against the
    // new component and written into it wherever a field name overlaps.
    //
    // Only for a field that names components, and only for a value that holds
    // instances. `kept: null` means nothing survived the check, which is not
    // the same as a cleared field whose value is legitimately null.
    const allowedHere = allowedComponentSlugs(field);
    let kept = child;
    if (allowedHere !== null && !isClearedComponentValue(child)) {
      const partitioned = partitionAllowedInstances(
        child,
        allowedHere,
        `${path}.${key}`,
        fieldNamesMultipleComponents(field)
      );
      removed.push(...partitioned.rejected);
      if (partitioned.kept === null) continue;
      kept = partitioned.kept;
    }

    out[key] =
      grandchildren.length > 0
        ? pruneContainerValue(
            kept,
            grandchildren,
            componentSchemas,
            removed,
            `${path}.${key}`,
            // A nested component's instances carry the same row metadata; a
            // nested group's values do not.
            componentSlugs(field).length > 0,
            fieldNamesMultipleComponents(field)
          )
        : kept;
  }

  return out;
}

/**
 * Whether a pruned component value kept no schema field at all.
 *
 * Row metadata survives pruning by design, so a value reduced to nothing but
 * `id` and `_componentType` carried no field the current schema recognises.
 * Empty instances are legal, so this only reports a value that HAD keys and
 * lost all of them.
 */
function retainsNothing(pruned: unknown): boolean {
  const metadataOnly = (row: unknown): boolean => {
    if (typeof row !== "object" || row === null) return false;
    const keys = Object.keys(row);
    if (keys.length === 0) return false;
    return keys.every(k => k === "id" || k === "_componentType");
  };

  if (Array.isArray(pruned)) {
    return pruned.length > 0 && pruned.every(metadataOnly);
  }
  return metadataOnly(pruned);
}

/**
 * Whether a stored component value represents "no instances".
 *
 * The component write paths read exactly these shapes as an instruction to
 * delete the existing rows, so a snapshot holding one is a snapshot of a
 * cleared field. It has to survive filtering: dropping it would leave the live
 * components in place and report a restore that rolled nothing back.
 */
function isClearedComponentValue(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

/**
 * Split a component value into the instances the schema still permits and the
 * ones it does not.
 *
 * Returns `kept: null` when nothing survives, so the caller drops the field
 * entirely rather than submitting an empty set — which the save path would read
 * as "remove everything".
 */
function partitionAllowedInstances(
  value: unknown,
  allowed: Set<string> | null,
  path: string,
  requiresType: boolean
): { kept: unknown; rejected: string[] } {
  if (allowed === null) return { kept: value, rejected: [] };

  const typeOf = (row: unknown): string | undefined =>
    typeof row === "object" && row !== null
      ? (row as { _componentType?: string })._componentType
      : undefined;

  // A row keeps its place when its type is allowed, or when this field stores
  // no type at all. Where a type IS required, a row without one cannot be
  // saved and its absence would take the live instances with it.
  const admits = (type: string | undefined): boolean =>
    type === undefined ? !requiresType : allowed.has(type);

  const describe = (type: string | undefined): string =>
    type === undefined ? "no component type" : type;

  if (Array.isArray(value)) {
    const rejected: string[] = [];
    const kept = value.filter((row, i) => {
      const type = typeOf(row);
      if (admits(type)) return true;
      rejected.push(`${path}[${i}] (${describe(type)})`);
      return false;
    });
    return kept.length > 0 ? { kept, rejected } : { kept: null, rejected };
  }

  const type = typeOf(value);
  if (!admits(type)) {
    return { kept: null, rejected: [`${path} (${describe(type)})`] };
  }
  return { kept: value, rejected: [] };
}

/**
 * Build the update payload for restoring `snapshot`.
 *
 * Unknown keys are removed here because nothing downstream does it. Validation
 * walks the schema's *fields* rather than the payload's keys, so it ignores a
 * key the schema no longer has, and the update then builds its SET clause
 * straight from those keys — a snapshot taken before a field was renamed or
 * removed would reach the database naming a column that does not exist.
 */
export function buildRestorePayload(
  snapshot: unknown,
  fields: FieldConfig[],
  context: RestoreSchemaContext = {
    hasStatus: true,
    hasSlug: true,
    hasTitle: true,
  }
): RestorePayloadResult {
  if (typeof snapshot !== "object" || snapshot === null) {
    return { payload: {}, droppedFields: [] };
  }

  const known = topLevelFields(fields);
  const { componentSchemas } = context;

  /** System columns that exist only when the entity actually has them. */
  const systemColumns = new Map<string, boolean>([
    ["status", context.hasStatus],
    ["slug", context.hasSlug],
    ["title", context.hasTitle],
  ]);

  const payload: Record<string, unknown> = {};
  const droppedFields: string[] = [];

  for (const [key, value] of Object.entries(snapshot)) {
    if (IMMUTABLE_FIELDS.has(key)) continue;

    const field = known.get(key);

    if (!field) {
      // A system column exists only when the entity has it; naming one it does
      // not have would fail the whole restore in the raw SET clause.
      const systemColumnExists = systemColumns.get(key);
      if (systemColumnExists !== true) {
        droppedFields.push(key);
        continue;
      }

      // A localized entity keeps draft/published state per locale as well as at
      // entity level, and a version that names no locale carries the entity's.
      // Writing it would resolve to some locale and publish or retract that
      // language from state that was never its own.
      // A localized entity keeps draft/published state per locale as well as at
      // entity level, and a version that names no locale carries the entity's.
      // Writing it would resolve to some locale and publish or retract that
      // language from state that was never its own.
      //
      // Only when the DOCUMENT is localized. An unlocalized document reaches
      // this branch too — its locale is unknown because it embeds a localized
      // component — but its status is a shared main-row value that needs no
      // locale, and holding it back would refuse a rollback it could apply.
      if (
        context.localeUnknown &&
        context.documentLocalized !== false &&
        key === "status"
      ) {
        droppedFields.push(key);
        continue;
      }

      payload[key] = value;
      continue;
    }

    // Nothing that stores a password is resubmitted, at any depth: the
    // snapshot's copy has it stripped, and the update replaces a container
    // whole, which would wipe the stored credential.
    if (containsPasswordField([field], componentSchemas)) {
      droppedFields.push(key);
      continue;
    }

    // Values stored per locale cannot be placed without knowing which locale
    // they belong to, so they are reported rather than written into whichever
    // one the update happens to resolve. Shared fields are unaffected. The
    // document is localized whenever its locale is the unknown one, so the
    // entity's own switch is on for this walk.
    if (
      context.localeUnknown &&
      containsLocalizedField(
        [field],
        context.documentLocalized ?? true,
        componentSchemas
      )
    ) {
      droppedFields.push(key);
      continue;
    }

    // A component whose schema no longer resolves cannot be inspected, so it
    // can neither be pruned of keys the component has since lost nor checked
    // for a credential. Reported rather than forwarded blind.
    if (!componentsAllResolve([field], componentSchemas)) {
      droppedFields.push(key);
      continue;
    }

    // A dynamic zone's allowed component list can change. The save path skips
    // an instance whose type is no longer allowed and then deletes the live
    // instances that were not in the incoming set — so resubmitting a snapshot
    // of only-removed types would clear the field rather than leaving it alone.
    const allowed = allowedComponentSlugs(field);
    const isComponentField = allowed !== null;
    const children = childrenOf(field, componentSchemas);

    // A component field is partitioned even when its schema resolves to no
    // children: a component may legitimately declare none. Gating the partition
    // on children alone would let those fields through unchecked.
    if (isComponentField || children.length > 0) {
      // A cleared field is restored as-is, so the update path removes the live
      // rows. Filtering cannot tell that from a value that lost every instance,
      // and the two need opposite outcomes.
      //
      // Except when the field permits no component at all: the save path has no
      // branch for an empty allowlist, so the clear would never be applied and
      // the live rows would survive a restore that reported success.
      if (isComponentField && isClearedComponentValue(value)) {
        if (allowed.size === 0) {
          droppedFields.push(key);
          continue;
        }
        payload[key] = value;
        continue;
      }

      const removed: string[] = [];
      const { kept, rejected } = partitionAllowedInstances(
        value,
        allowed,
        key,
        // A dynamic zone selects each row's component by its stored type. The
        // save path skips a row that has none and then deletes every live
        // instance the incoming set did not name, so an undiscriminated row —
        // which is exactly what this field's snapshots hold from when it named
        // a single component — would clear the zone.
        fieldNamesMultipleComponents(field)
      );
      droppedFields.push(...rejected);

      if (kept === null) {
        droppedFields.push(key);
        continue;
      }

      if (children.length === 0) {
        payload[key] = kept;
        droppedFields.push(...removed);
        continue;
      }

      const pruned = pruneContainerValue(
        kept,
        children,
        componentSchemas,
        removed,
        key,
        isComponentField,
        fieldNamesMultipleComponents(field)
      );

      // Only a dynamic zone stores `_componentType`; a single-component field
      // is read back without one, so its instances cannot be checked against
      // the allowed list above. If the field was retargeted at a different
      // component since, every key of the old value is unknown to the new
      // schema — which is what this detects, rather than pruning the old
      // component's values into the new component's shape.
      if (isComponentField && retainsNothing(pruned)) {
        droppedFields.push(key);
        continue;
      }

      payload[key] = pruned;
      droppedFields.push(...removed);
      continue;
    }

    // A container whose children have all been removed declares no key its
    // stored value could match. Validation walks fields rather than the value's
    // keys, so forwarding it would write the removed nested keys straight back
    // into the JSON column.
    if (declaresEmptyChildList(field)) {
      droppedFields.push(key);
      continue;
    }

    payload[key] = value;
  }

  return { payload, droppedFields };
}

/**
 * Whether any payload key carries component values.
 *
 * Components keep their own per-locale rows, so a document that is not
 * localized itself still needs a write locale when its payload reaches one.
 */
export function payloadTouchesComponents(
  payload: Record<string, unknown>,
  fields: FieldConfig[]
): boolean {
  const known = topLevelFields(fields);

  // A field naming component slugs is the signal by itself, so the resolved
  // schemas are not needed: the walk only has to reach fields declared inline.
  const hasComponent = (list: FieldConfig[]): boolean =>
    list.some(field => {
      if (componentSlugs(field).length > 0) return true;
      const inline = inlineChildren(field);
      return inline ? hasComponent(inline) : false;
    });

  return Object.keys(payload).some(key => {
    const field = known.get(key);
    return field === undefined ? false : hasComponent([field]);
  });
}

/**
 * Whether a restore has no locale to write a document's per-locale values into.
 *
 * A localized snapshot holds one locale's values, so applying it requires
 * knowing which. A version records none either because it predates the locale
 * being captured or because the write that produced it touched only shared
 * fields. Neither can be placed, so the per-locale part of such a snapshot is
 * left alone while its shared fields restore normally.
 */
export function restoreLocaleIsUnknown(
  storesPerLocaleContent: boolean,
  versionLocale: string | null
): boolean {
  return storesPerLocaleContent && versionLocale === null;
}

/**
 * Whether restoring this schema can put content into a specific language.
 *
 * True when the document keeps its own translations, and also when it merely
 * embeds a component that keeps its own — component tables are per-locale
 * regardless of their parent, so a document that is not localized itself still
 * has content that cannot be placed without a locale.
 */
export function schemaStoresPerLocaleContent(
  documentIsLocalized: boolean,
  fields: FieldConfig[],
  componentSchemas?: ComponentSchemas
): boolean {
  if (documentIsLocalized) return true;
  return containsLocalizedField(fields, false, componentSchemas);
}
