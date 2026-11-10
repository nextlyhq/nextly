/**
 * Where a field list places field groups.
 *
 * The one walk every question about which field groups a field list places derives from: who uses
 * a field group, and whether field groups place each other in a cycle. Each field is read through
 * {@link fieldGroupSlugList}, so a definition using any spelling of the reference keys, and a zone,
 * is found.
 *
 * Its own module rather than beside the extractor because it asks `typeHasNestedFields` which
 * fields are containers, and the module that answers that imports the extractor's.
 *
 * @module domains/field-groups/storage/field-group-placements
 */

import { typeHasNestedFields } from "../../../collections/fields/guards";
import {
  addressableFields,
  type AddressableField,
} from "../../../shared/addressable-fields";

import {
  fieldGroupSlugList,
  isFieldGroupFieldType,
} from "./field-group-field-type";

/** One place a field list puts a field group. */
export interface FieldGroupPlacement {
  /** The field's path from the list's top level, dotted through named groups and repeaters. */
  readonly path: string;
  /** The field groups placed there: the one a single slot names, or each a zone allows. */
  readonly slugs: readonly string[];
  /**
   * Whether the field sits at the list's own level, outside any named group or repeater. A
   * presentational group (one with no name) keeps its children at the level it sits in, so a
   * field inside one is still direct.
   */
  readonly direct: boolean;
}

/** The names from the top level down to a container, kept as links so no level copies a path. */
interface PathLink {
  readonly name: string;
  readonly parent: PathLink | undefined;
}

/** A field still to read, or the point at which a container's children have all been read. */
type Pending =
  | {
      readonly kind: "field";
      readonly field: AddressableField;
      readonly parent: PathLink | undefined;
    }
  | { readonly kind: "leave"; readonly container: object };

function pathOf(name: string, parent: PathLink | undefined): string {
  const names = [name];
  for (let link = parent; link !== undefined; link = link.parent) {
    names.push(link.name);
  }
  return names.reverse().join(".");
}

/**
 * Every place `fields` puts a field group, at any depth inside named groups and repeaters,
 * looking through presentational groups.
 *
 * Only a group or a repeater is descended (`typeHasNestedFields`): a contributed field type may
 * carry a `fields` option of its own that is not a field list. A field-group field is a leaf:
 * what the field group itself holds is that field group's own list, which a caller walks in turn
 * if it needs to.
 *
 * Iterative, so a container hierarchy of any depth an author can write is walked without one stack
 * frame per level. The levels come from `addressableFields`, which looks through presentational
 * groups and ends a cycle among them; a named container that holds itself is ended by the open set
 * below, which holds only the containers on the current path, so one container object placed at
 * two places is walked at both.
 *
 * @param fields a field list as written in config or parsed from a registry row
 */
export function fieldGroupPlacements(fields: unknown): FieldGroupPlacement[] {
  const found: FieldGroupPlacement[] = [];
  const openContainers = new WeakSet<object>();
  const pending: Pending[] = [];
  const enqueue = (list: unknown, parent: PathLink | undefined) => {
    const level = addressableFields(list);
    // Reversed so that popping reads the fields in declaration order.
    for (let i = level.length - 1; i >= 0; i--) {
      pending.push({ kind: "field", field: level[i], parent });
    }
  };
  enqueue(fields, undefined);

  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (item.kind === "leave") {
      openContainers.delete(item.container);
      continue;
    }
    const { field, parent } = item;
    // `addressableFields` emits only named fields; its type keeps `name` optional because a valid
    // config field may lack one, so the name is narrowed here rather than asserted.
    const { name, type } = field;
    if (typeof name !== "string") continue;
    if (isFieldGroupFieldType(type)) {
      const slugs = fieldGroupSlugList(field);
      if (slugs.length > 0) {
        found.push({
          path: pathOf(name, parent),
          slugs,
          direct: parent === undefined,
        });
      }
      continue;
    }
    const children = (field as { fields?: unknown }).fields;
    if (
      typeof type !== "string" ||
      !typeHasNestedFields(type) ||
      !Array.isArray(children) ||
      openContainers.has(field)
    ) {
      continue;
    }
    openContainers.add(field);
    pending.push({ kind: "leave", container: field });
    enqueue(children, { name, parent });
  }
  return found;
}
