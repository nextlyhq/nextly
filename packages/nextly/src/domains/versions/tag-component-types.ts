/**
 * Recording which component a snapshot's values came from.
 *
 * A field naming ONE component stores no type on its rows: the schema implies
 * it, so an ordinary read omits it and the column stays null. A version
 * snapshot cannot rely on that implication, because the field may name a
 * different component by the time the snapshot is restored — and with no type
 * recorded, the old component's values get pruned against the new component's
 * schema and written into it wherever a field name overlaps.
 *
 * Applied to the snapshot alone, never to the read it came from. The component
 * values a write reads back are also what the outbox event carries, and that
 * payload is documented as read shape — adding an internal marker to it would
 * put a key in every webhook that no ordinary read produces.
 *
 * @module domains/versions/tag-component-types
 */

import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors";
import type { AddressableField } from "../../shared/addressable-fields";
import { addressableFields } from "../../shared/addressable-fields";
import { storageTypeToken } from "../../shared/lib/plugin-storage";
import { extractFieldGroupReferences } from "../field-groups/storage/field-group-field-type";
import {
  clearFieldGroupType,
  readFieldGroupType,
  writeFieldGroupType,
} from "../field-groups/storage/field-group-type-key";

import type { ComponentSchemas } from "./restore-snapshot";

/**
 * Looks up a component's own fields by slug.
 *
 * Supplied by the capture site, which holds the component data service. Without
 * it the walk stops at the entity's schema and a component embedded in another
 * component goes untagged.
 */
export type ComponentFieldResolver = (
  slug: string
) => FieldConfig[] | undefined;

/** The component slug a field names, when it names exactly one. */
function singleComponentSlug(field: AddressableField): string | undefined {
  // Only the single-component shape. A dynamic zone declares a list and
  // already stores a type per row, chosen by the editor rather than implied.
  // Through the shared extractor: a migrated definition names the slug under
  // `fieldGroup`, which this key never held — an untagged value would be
  // pruned against the wrong schema at restore.
  return extractFieldGroupReferences(field).single;
}

/** The component slugs a dynamic zone allows, when the field is one. */
function dynamicZoneSlugs(field: AddressableField): string[] | undefined {
  return extractFieldGroupReferences(field).many;
}

/**
 * Tag every component value reachable from `fields` within one object.
 *
 * The single walk all three entry points share. A field naming one component,
 * a dynamic zone, and a plain container each reach nested components by a
 * different route, and splitting them into separate walks is how a component
 * ends up tagged in one shape and untagged in another.
 *
 * `seen` holds the values on the current path, so a value that somehow refers
 * back to itself terminates. It is scoped to the path rather than the whole
 * walk: the same object appearing twice as siblings is ordinary repeated data,
 * and both copies still get tagged.
 */
function tagFieldsIn(
  source: Record<string, unknown>,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };

  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const value = source[field.name];

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = tagValue(value, slug, resolve, seen);
      continue;
    }

    const zone = dynamicZoneSlugs(field);
    if (zone !== undefined) {
      out[field.name] = tagZoneRows(value, zone, resolve, seen);
      continue;
    }

    // Containers nest, so a component two levels down is still reachable.
    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = tagNestedComponentTypes(
        value,
        children as FieldConfig[],
        resolve,
        seen
      );
    }
  }

  return out;
}

/**
 * Stamp one value, or each element when the field is repeatable.
 *
 * Descends into the component's OWN fields when they can be resolved, so a
 * component embedded in another component is tagged too. Its values live in the
 * outer component's deserialized object, so the same walk reaches them.
 */
function tagValue(
  value: unknown,
  slug: string,
  resolve?: ComponentFieldResolver,
  seen: Set<object> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => tagValue(item, slug, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  // Guarded on the value rather than the slug. A schema that refers to itself
  // — `node` holding a `node` — describes finite data of any depth, and
  // stopping at the repeated slug would tag the first two levels and leave
  // every level below them bare.
  const ownFields = resolve?.(slug);
  if (!ownFields) return taggedCopy(source, slug);

  seen.add(source);
  const inner = tagFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return taggedCopy(inner, slug);
}

/**
 * A copy of one value carrying exactly one spelling of its type.
 *
 * Spreading and then assigning the current spelling is not the same thing: a value that already
 * carries an older spelling keeps it, and the copy ends up announcing its type twice. That happens
 * whenever the value came from data an earlier release wrote — a snapshot captured before the
 * storage rename, restored and captured again — so the shape reaching a new snapshot depends on
 * how old the entry is.
 *
 * Writing through the accessor removes every spelling before adding the current one, so the
 * guarantee holds without reasoning about where the value came from.
 */
function taggedCopy(
  value: Record<string, unknown>,
  slug: string
): Record<string, unknown> {
  const tagged = { ...value };
  writeFieldGroupType(tagged, slug);
  return tagged;
}

/**
 * Descend into a dynamic zone's rows using each row's own component schema.
 *
 * A zone row already records the component the editor chose, so nothing is
 * stamped here — only the components nested inside the row are tagged. Without
 * this, a single component sitting inside a zone row keeps no record of its
 * type and a later restore prunes it against whichever component the field
 * names by then.
 */
function tagZoneRows(
  value: unknown,
  allowed: string[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => tagZoneRows(row, allowed, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  // The row's own type decides which schema its values belong to. A row whose
  // type is missing, or names a component the field does not allow, is left
  // alone rather than walked against a schema that may not describe it.
  const rowType = readFieldGroupType(source);
  if (rowType === undefined || !allowed.includes(rowType)) return source;

  const ownFields = resolve?.(rowType);
  if (!ownFields) return source;

  seen.add(source);
  const out = tagFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return out;
}

/**
 * A copy of `components` with each single-component value carrying the slug its
 * field named.
 *
 * Returns a new object; the input is what the caller hands to the outbox and
 * must not gain the marker.
 */
export function tagComponentTypes(
  components: Record<string, unknown>,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver
): Record<string, unknown> {
  // Own properties only, checked inside the shared walk. `in` also matches
  // inherited ones, so a field named `constructor` or `__proto__` would be
  // treated as captured and tagged when nothing of the sort was read back.
  return tagFieldsIn(components, fields, resolve, new Set());
}

/**
 * Tag single-component values nested inside a container's stored JSON.
 *
 * A group or repeater is one column, so a component field declared inside one
 * never appears as a key of `components` — its value rides along in the
 * container's value on the parent row. The schema still says which component it
 * names, so the same tagging applies; it just has to be reached through the
 * container.
 *
 * Returns a new value. The row this reads from is also what the outbox event
 * carries.
 */
export function tagNestedComponentTypes(
  value: unknown,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver,
  seen: Set<object> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(row =>
      tagNestedComponentTypes(row, fields, resolve, seen)
    );
  }
  if (typeof value !== "object" || value === null) return value;

  return tagFieldsIn(value as Record<string, unknown>, fields, resolve, seen);
}

/**
 * Remove the single-component `_componentType` markers a snapshot carries from a
 * document about to be served as an ordinary read — a mutation response or a
 * hook argument assembled from a working-draft snapshot.
 *
 * `tagComponentTypes` stamps a single-component value with its slug so a restore
 * can resolve the component even if the field is later retargeted, but an
 * ordinary read of a single component omits it (the schema implies the type). A
 * dynamic zone's row type is editor-chosen and part of read shape, so it is
 * kept; only the components nested inside a row are cleaned. The inverse of the
 * tag walk, sharing its field classification.
 *
 * Returns a new object; the tagged snapshot the input came from is untouched, so
 * the persisted copy keeps the markers a promote needs.
 */
export function stripSingleComponentTags(
  document: Record<string, unknown>,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver
): Record<string, unknown> {
  return stripFieldsIn(document, fields, resolve, new Set());
}

function stripFieldsIn(
  source: Record<string, unknown>,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };

  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const value = source[field.name];

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = stripSingleValue(value, slug, resolve, seen);
      continue;
    }

    const zone = dynamicZoneSlugs(field);
    if (zone !== undefined) {
      out[field.name] = stripZoneRows(value, zone, resolve, seen);
      continue;
    }

    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = stripNestedTags(
        value,
        children as FieldConfig[],
        resolve,
        seen
      );
    }
  }

  return out;
}

/** Strip the marker off a single-component value, descending into its own fields. */
function stripSingleValue(
  value: unknown,
  slug: string,
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripSingleValue(item, slug, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  const ownFields = resolve?.(slug);
  if (!ownFields) {
    const bare = { ...source };
    clearFieldGroupType(bare);
    return bare;
  }

  seen.add(source);
  const inner = stripFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  const out = { ...inner };
  clearFieldGroupType(out);
  return out;
}

/** Keep a zone row's own editor-chosen type; clean single components inside it. */
function stripZoneRows(
  value: unknown,
  allowed: string[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => stripZoneRows(row, allowed, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  const rowType = readFieldGroupType(source);
  if (rowType === undefined || !allowed.includes(rowType)) return source;

  const ownFields = resolve?.(rowType);
  if (!ownFields) return source;

  seen.add(source);
  const out = stripFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return out;
}

/** Reach single components nested inside a group or repeater's stored JSON. */
function stripNestedTags(
  value: unknown,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => stripNestedTags(row, fields, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  return stripFieldsIn(value as Record<string, unknown>, fields, resolve, seen);
}

/**
 * Every component schema the fields reach, keyed by slug.
 *
 * Resolved to a fixed point so a component embedded in another component is
 * included. The map doubles as the visited set, so a schema that references
 * itself terminates.
 *
 * An UNKNOWN component is simply absent from the map, which stops the walk
 * there rather than failing the write. A lookup that ERRORS is different and
 * propagates: it says nothing about whether the component exists, and treating
 * it as absent would write a snapshot whose nested values carry no type — the
 * exact state a later restore prunes against the wrong schema. Better to fail
 * the save, which the caller can retry, than to store a version that restores
 * incorrectly.
 */
export async function resolveComponentFieldMap(
  fields: FieldConfig[],
  getComponentFields: (slug: string) => Promise<FieldConfig[] | null>
): Promise<Map<string, FieldConfig[]>> {
  const resolved = new Map<string, FieldConfig[]>();

  // Iterative, with a visited set, for the same two reasons the addressable-
  // fields walk is: a config whose group contains itself overflowed the call
  // stack here, and a list wider than the engine's argument limit threw out of
  // `push(...slugsIn(children))`. This runs BEFORE the tagging walk on the
  // save path, so hardening only that one left both failures reachable one
  // function earlier — a throw here reports a failed save for one that
  // succeeded, since it happens after the row is written.
  const slugsIn = (list: readonly unknown[]): string[] => {
    const found: string[] = [];
    const pending: unknown[] = [];
    for (let i = list.length - 1; i >= 0; i--) pending.push(list[i]);
    const walked = new WeakSet<object>();

    while (pending.length > 0) {
      const field = pending.pop();
      if (typeof field !== "object" || field === null) continue;
      if (walked.has(field)) continue;
      walked.add(field);

      for (const slug of componentSlugsOn(field)) found.push(slug);

      const children = (field as { fields?: unknown }).fields;
      if (!Array.isArray(children)) continue;
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    return found;
  };

  let pending = slugsIn(fields);
  while (pending.length > 0) {
    const batch = pending.filter(slug => !resolved.has(slug));
    if (batch.length === 0) break;

    await Promise.all(
      batch.map(async slug => {
        // Not caught: an unknown component already comes back as null, so
        // anything thrown here is an operational failure and is the caller's
        // to handle. See the note above.
        const own = await getComponentFields(slug);
        if (own) resolved.set(slug, own);
      })
    );

    pending = batch.flatMap(slug => slugsIn(resolved.get(slug) ?? []));
  }

  return resolved;
}

/**
 * Rehydrate JSON date strings in a working-draft snapshot to Date objects,
 * in place.
 *
 * A working-draft snapshot is stored as JSON, so a `date` field — at the top
 * level or nested in a single or dynamic-zone component — comes back as an ISO
 * string, while a live read hands the hooks a Drizzle-decoded Date. Walking
 * `addressableFields` flattens unnamed presentational groups (matching the type
 * tagger), so a date or component declared inside one is still reached. A
 * dynamic-zone instance carries its own `_componentType`; a single component
 * takes the field's declared slug.
 */
export function rehydrateSnapshotDates(
  value: Record<string, unknown>,
  fields: FieldConfig[],
  componentSchemas: ComponentSchemas | null
): void {
  for (const field of addressableFields(fields)) {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string" || !(name in value)) continue;

    // A timestamp-backed plugin type serializes to a string too, so resolve the
    // storage primitive rather than matching the literal `date` type token.
    if (storageTypeToken(field) === "date") {
      const raw = value[name];
      if (typeof raw === "string") {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) value[name] = parsed;
      }
      continue;
    }

    // Both reference spellings: a migrated definition's dates would
    // otherwise stay ISO strings inside a live Date-shaped read.
    const { single, many } = extractFieldGroupReferences(field);
    if (single === undefined && many === undefined) continue;

    const compValue = value[name];
    const instances = Array.isArray(compValue)
      ? compValue
      : compValue != null
        ? [compValue]
        : [];
    for (const instance of instances) {
      if (instance === null || typeof instance !== "object") continue;
      const rec = instance as Record<string, unknown>;
      const tagged = readFieldGroupType(rec);
      const slug = tagged ?? single;
      const compFields = slug ? componentSchemas?.get(slug)?.fields : undefined;
      if (compFields) {
        rehydrateSnapshotDates(rec, compFields, componentSchemas);
      }
    }
  }
}

/**
 * Strip password values out of a snapshot, following component REFERENCES.
 *
 * Recursion is bounded by the DATA, not by the schema. A component schema may
 * reference itself, so expanding the schema ahead of time either loops forever
 * or has to stop at some depth -- and stopping is what leaks: the values below
 * the cut-off keep their passwords. A snapshot is finite, so walking it
 * terminates on its own and every level present gets stripped.
 *
 * Leaf work is delegated to `stripPasswordFieldValues`, so "what counts as a
 * password field", including inline groups and repeaters, has one definition
 * rather than two that would drift.
 */
/**
 * The component slugs one field names, from either shape it can name them in.
 *
 * Separate from the walk that finds them because it answers a different
 * question: this reads one field, the walk decides which fields to read.
 */
function componentSlugsOn(field: object): string[] {
  const found: string[] = [];
  // Through the shared extractor: a password-strip walk that misses a
  // migrated definition's slugs leaves the plaintext inside the snapshot.
  const { single, many } = extractFieldGroupReferences(field);
  if (single !== undefined) found.push(single);
  if (many !== undefined) found.push(...many);
  return found;
}

/** What a descent needs beyond the field it is looking at. */
interface StripContext {
  entry: Record<string, unknown>;
  componentFields: Map<string, FieldConfig[]>;
  strip: (entry: Record<string, unknown>, fields: FieldConfig[]) => void;
  onUnresolvedComponent: (slug: string) => void;
  openContainers: WeakSet<object>;
}

/**
 * Descend through an unnamed container into the level it sits in.
 *
 * The only descent here that recurses on the SAME value with a different field
 * list, and so the only one that can loop: a container whose `fields` reaches
 * itself recurses forever. `openContainers` holds what is currently open ON
 * THIS PATH and is released on the way out, so a container shared by several
 * rows is still walked once per row — a set that only ever grew would walk the
 * first row and leave every later row's password in the snapshot.
 */
function stripThroughUnnamed(field: unknown, ctx: StripContext): void {
  const nested = (field as { fields?: unknown }).fields;
  if (!Array.isArray(nested)) return;
  if (typeof field !== "object" || field === null) return;
  if (ctx.openContainers.has(field)) return;

  ctx.openContainers.add(field);
  stripPasswordsThroughComponents(
    ctx.entry,
    nested as FieldConfig[],
    ctx.componentFields,
    ctx.strip,
    ctx.onUnresolvedComponent,
    ctx.openContainers
  );
  ctx.openContainers.delete(field);
}

/**
 * Descend through a field that REFERENCES one or more component schemas.
 *
 * Separate from the walk because it decides which schema a value is judged
 * against, which the walk itself does not: a dynamic-zone row carries its own
 * type tag and must be judged by that alone, while an untagged one falls back
 * to the union of every candidate.
 */
function stripThroughComponentRef(
  name: string,
  slugs: readonly string[],
  ctx: StripContext
): void {
  const { entry, componentFields, strip, onUnresolvedComponent } = ctx;
  const fieldsFor = (slug: string): FieldConfig[] => {
    const resolved = componentFields.get(slug);
    if (resolved === undefined) {
      onUnresolvedComponent(slug);
      return [];
    }
    return resolved;
  };

  // A dynamic-zone row carries its OWN `_componentType`, so judge it
  // against that component's schema rather than the union of every
  // candidate. The union is safe against leaks but not against damage:
  // where two alternatives share a field name and only one declares it a
  // password, unioning deletes that field from rows of the OTHER
  // alternative, quietly emptying a legitimate value out of the recovery
  // point. The tag is present, so there is no reason to guess.
  const rows = entry[name];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      // ASKED, not read. The storage migration renames this key inside
      // stored JSON, so a snapshot written under the other spelling would
      // read as untyped -- and an untyped row falls back to the union,
      // which is exactly the over-stripping this per-row selection exists
      // to avoid. The accessor tries both spellings in the migration's own
      // order.
      const tagged =
        row && typeof row === "object"
          ? readFieldGroupType(row as Record<string, unknown>)
          : undefined;
      const rowFields =
        typeof tagged === "string" && slugs.includes(tagged)
          ? fieldsFor(tagged)
          : // Untagged rows fall back to the union: without a tag there is
            // nothing to select on, and over-stripping beats leaking.
            slugs.flatMap(fieldsFor);
      stripPasswordsThroughComponents(
        row,
        rowFields,
        componentFields,
        strip,
        onUnresolvedComponent,
        new WeakSet()
      );
    }
    return;
  }

  const inner: FieldConfig[] = slugs.flatMap(fieldsFor);
  stripPasswordsThroughComponents(
    entry[name],
    inner,
    componentFields,
    strip,
    onUnresolvedComponent,
    new WeakSet()
  );
}

export function stripPasswordsThroughComponents(
  value: unknown,
  fields: FieldConfig[],
  componentFields: Map<string, FieldConfig[]>,
  strip: (entry: Record<string, unknown>, fields: FieldConfig[]) => void,
  /**
   * Called with a slug the map does not carry. `resolveComponentFieldMap`
   * records a component only when the lookup RETURNED fields, so an unknown
   * slug is simply absent -- and treating absence as "no fields" would descend
   * into that value stripping nothing, leaving any password inside it in the
   * snapshot. Absence is missing information, never permission, so the caller
   * decides and the default refuses.
   */
  onUnresolvedComponent: (slug: string) => void = slug => {
    throw NextlyError.internal({
      logContext: { reason: "unresolved-component-schema", slug },
    });
  },
  /**
   * The unnamed containers currently open ON THIS PATH, so a container whose
   * `fields` reaches itself terminates. Defaulted because no caller outside
   * this walk supplies it, and released on the way out rather than accumulated:
   * a set that only grew would walk the first row of a repeater and leave every
   * later row's password in the snapshot.
   */
  openContainers: WeakSet<object> = new WeakSet()
): void {
  if (!value || typeof value !== "object") return;

  // An array is a repeater or a dynamic zone: each row is its own document
  // against the same field list.
  if (Array.isArray(value)) {
    for (const row of value) {
      stripPasswordsThroughComponents(
        row,
        fields,
        componentFields,
        strip,
        onUnresolvedComponent
      );
    }
    return;
  }

  const entry = value as Record<string, unknown>;
  // Direct fields first, which removes the passwords declared at THIS level.
  strip(entry, fields);

  for (const field of fields) {
    const name = (field as { name?: unknown }).name;

    // An UNNAMED field is presentational -- a layout group with no key of its
    // own -- so its children's values live at THIS level rather than nested
    // under it. Skipping it because it has no name would leave a password
    // declared inside it, or inside a component it references, untouched at
    // the parent level. Recurse into the same entry with the child list.
    if (typeof name !== "string") {
      stripThroughUnnamed(field, {
        entry,
        componentFields,
        strip,
        onUnresolvedComponent,
        openContainers,
      });
      continue;
    }

    if (!(name in entry)) continue;

    // The same reading the resolver does. Two functions deciding which
    // components a field names is two functions that can disagree about it.
    const slugs = componentSlugsOn(field);
    if (slugs.length > 0) {
      stripThroughComponentRef(name, slugs, {
        entry,
        componentFields,
        strip,
        onUnresolvedComponent,
        openContainers,
      });
      continue;
    }

    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      stripPasswordsThroughComponents(
        entry[name],
        children as FieldConfig[],
        componentFields,
        strip,
        onUnresolvedComponent,
        new WeakSet()
      );
    }
  }
}

/**
 * Rewrite component REFERENCES into the container shapes a field walker
 * already understands, carrying the referenced component's own fields.
 *
 * A `component` field is a reference: its schema lives under another slug, so
 * a walker looking only at the field list sees `{ type: "component" }` and has
 * nothing to descend into. Expanding it into a `group` (and a dynamic zone
 * into a `repeater`) lets one existing walker handle inline containers and
 * referenced ones alike, instead of a second walker that would have to agree
 * with the first about what a password field is.
 *
 * A dynamic zone becomes the UNION of its candidate components' fields. A
 * per-instance `_componentType` would let each row be judged against its own
 * schema, but resolving that here would duplicate the tagging logic above. For
 * the redaction this exists for, the union errs the safe way: it can only
 * strip a value some OTHER candidate component happens to name the same, never
 * miss one the actual component declares.
 *
 * `seen` breaks reference cycles. A component that reaches itself would
 * otherwise expand forever, and a schema is free to be recursive.
 */
export function expandComponentFields(
  fields: FieldConfig[],
  componentFields: Map<string, FieldConfig[]>,
  seen: ReadonlySet<string> = new Set()
): FieldConfig[] {
  const expandUnder = (
    slugs: string[],
    type: "group" | "repeater",
    field: FieldConfig
  ) => {
    const next = new Set(seen);
    const inner: FieldConfig[] = [];
    for (const slug of slugs) {
      if (next.has(slug)) continue;
      next.add(slug);
      inner.push(...(componentFields.get(slug) ?? []));
    }
    return {
      ...(field as unknown as Record<string, unknown>),
      type,
      fields: expandComponentFields(inner, componentFields, next),
    } as unknown as FieldConfig;
  };

  return fields.map(field => {
    const { single, many } = extractFieldGroupReferences(field);
    if (single !== undefined) return expandUnder([single], "group", field);

    if (many !== undefined) {
      return expandUnder(many, "repeater", field);
    }

    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      return {
        ...(field as unknown as Record<string, unknown>),
        fields: expandComponentFields(
          children as FieldConfig[],
          componentFields,
          seen
        ),
      } as unknown as FieldConfig;
    }
    return field;
  });
}
