/**
 * What tells a field or an entity apart from another of the same label.
 *
 * A label is not unique in the Builder. Two sibling fields may share a label
 * AND a type, two fields in different containers may share a label, and two
 * collections may share a display name; a list or a message that shows only
 * the label offers a person two identical choices. What IS unique is a
 * field's name among its siblings -- so its chain of names from the top of
 * the schema, `details.subtitle`, is unique in the whole tree -- and an
 * entity's slug among entities of its kind, so its kind and slug together.
 *
 * The disambiguator is shown ALWAYS, not only when two labels collide. Shown
 * on collision alone, the same field would read one way in a list where its
 * label happens to be unique and another way where it is not, the text of one
 * item would depend on which others the list was filtered to, and a person
 * would never learn the name they meet again in the API and in code.
 *
 * The label and the place are the editor's own answer, read through the
 * comparison view's field-path formatter ("Details › Subtitle"), so a field is
 * called the same thing here as on the entry form and in a version diff.
 *
 * @module lib/builder/distinguishing-label
 */

import type { DiffPathSegment } from "nextly/api/versions-diff";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import {
  fieldNameOf,
  fieldPathLabel,
  placeOf,
  type NamedNode,
} from "@admin/components/features/versions/diff/field-path";
import type { ApiSingle } from "@admin/types/entities";

/** One field as a list or a message shows it, with what tells it apart. */
export interface DistinguishedField {
  /** The field this entry stands for. */
  field: BuilderField;
  /** Its label as the editor shows it: "Subtitle". */
  label: string;
  /**
   * Its name in the database and API, as the chain of names from the top of
   * the schema: "subtitle", or "details.subtitle" inside the group `details`.
   * Null while the field or a container above it has no name yet.
   */
  namePath: string | null;
  /** Its label after the containers it sits in, "Details › Subtitle"; null at the top. */
  place: string | null;
  /** What tells it apart: "name in the database and API: details.subtitle". */
  disambiguator: string;
  /** The whole text a person reads: place (or label), then the disambiguator. */
  text: string;
}

/**
 * Every field in the tree, depth first, each with what tells it apart.
 *
 * The whole tree is walked even when a caller shows only some of it, because a
 * field's place and name path are read from its ancestors; a caller picks the
 * entries for the fields it lists by `field.id`.
 */
export function distinguishFields(
  fields: readonly BuilderField[]
): DistinguishedField[] {
  const out: DistinguishedField[] = [];
  const walk = (
    list: readonly BuilderField[],
    ancestors: readonly BuilderField[]
  ): void => {
    for (const field of list) {
      out.push(distinguishOne(field, ancestors));
      // Any field carrying nested fields is a container, as the other tree
      // walks of this module's siblings treat it.
      if (field.fields && field.fields.length > 0) {
        walk(field.fields, [...ancestors, field]);
      }
    }
  };
  walk(fields, []);
  return out;
}

/** The entry for one field of the tree, for a message that names it. */
export function distinguishField(
  fields: readonly BuilderField[],
  fieldId: string
): DistinguishedField | undefined {
  return distinguishFields(fields).find(entry => entry.field.id === fieldId);
}

/** A field with its containers, in the shape the field-path formatter reads. */
function namedNode(
  field: BuilderField,
  ancestors: readonly BuilderField[]
): NamedNode {
  // `declaredLabel` is always set, so the formatter applies the editor's
  // label-else-readable-name rule rather than trusting a resolved label.
  const path: DiffPathSegment[] = ancestors.map(a => ({
    name: a.name || null,
    declaredLabel: a.label ?? null,
    type: a.type,
  }));
  return { name: field.name, declaredLabel: field.label ?? null, path };
}

function distinguishOne(
  field: BuilderField,
  ancestors: readonly BuilderField[]
): DistinguishedField {
  const node = namedNode(field, ancestors);
  const label = fieldNameOf(node);
  // A container with neither name nor label draws no heading and is left out
  // of the place, so the place is null when no container above is named.
  const place =
    placeOf(node.path, 0).length > 0 ? fieldPathLabel(node, 0) : null;
  const names = [...ancestors, field].map(f => f.name);
  // A just-added field has no name until its author types one; an empty
  // segment would print a path that addresses nothing.
  const namePath = names.every(n => n !== "") ? names.join(".") : null;
  const disambiguator =
    namePath === null
      ? "no name in the database and API yet"
      : `name in the database and API: ${namePath}`;
  return {
    field,
    label,
    namePath,
    place,
    disambiguator,
    text: `${place ?? label} (${disambiguator})`,
  };
}

/**
 * A collection, Single or field group as a list or a message names it.
 *
 * Callers map their own API record onto this: a collection's slug is
 * `ApiCollection.name`, a Single's and a field group's is `slug`.
 */
export type BuilderEntity = Pick<ApiSingle, "label" | "slug"> & {
  kind: BuilderKind;
};

/** One entity as shown, with what tells it apart. */
export interface DistinguishedEntity {
  /** The entity this entry stands for. */
  entity: BuilderEntity;
  /** Its display name: "Posts". */
  label: string;
  /** Its kind as a person reads it: "Collection", "Single" or "Field group". */
  kind: string;
  /** Its address, the slug: "blog_posts". */
  slug: string;
  /** What tells it apart: "Collection, slug: blog_posts". */
  disambiguator: string;
  /** The whole text a person reads: "Posts (Collection, slug: blog_posts)". */
  text: string;
}

/**
 * The word a person reads for each kind. A field group is a "component" only
 * inside the code; the screen never says that word.
 */
const KIND_WORD: Record<BuilderKind, string> = {
  collection: "Collection",
  single: "Single",
  "field-group": "Field group",
};

/** Each entity with its kind and slug, always shown for the reason fields' names are. */
export function distinguishEntities(
  entities: readonly BuilderEntity[]
): DistinguishedEntity[] {
  return entities.map(entity => {
    // A blank display name would leave the text opening on a bare bracket.
    const label = entity.label.trim() || "Untitled";
    const kind = KIND_WORD[entity.kind];
    const disambiguator = `${kind}, slug: ${entity.slug}`;
    return {
      entity,
      label,
      kind,
      slug: entity.slug,
      disambiguator,
      text: `${label} (${disambiguator})`,
    };
  });
}
