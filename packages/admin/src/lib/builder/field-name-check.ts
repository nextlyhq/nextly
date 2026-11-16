/**
 * Whether a name the Builder is about to give a field can be saved, judged by the rules the save
 * itself refuses a name by: `fieldNameProblem`, the server's field-name rule, and
 * `siblingNameClash`, its rule for two fields at one level. Both are reached through `nextly/config`
 * rather than copied, so the panel and the picker accept exactly the names a save accepts.
 *
 * Asked of a name new at its place, as the save asks it: one a field is created with, typed or
 * derived from its label, or one a saved field is renamed to. A name the field already has where it
 * is saved keeps working, whatever this would say.
 *
 * @module lib/builder/field-name-check
 */
import {
  fieldNameProblem,
  siblingNameClash,
  type FieldNameProblem,
  type FieldNameSurface,
  type SiblingClashKind,
} from "nextly/config";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";

/** How a refusal words each way two sibling names clash. */
const CLASH_WORDS: Record<SiblingClashKind, string> = {
  "same-name": "the same name",
  "same-name-ignoring-case": "the same name in other letter case",
  "same-column": "a name that becomes the same column",
};

/** The field-name rule's surface for a Builder kind. */
export function nameSurfaceOf(kind: BuilderKind): FieldNameSurface {
  return kind === "field-group" ? "fieldGroup" : kind;
}

/** Where a field's name is judged, as the Builder knows it. */
export interface BuilderNamePlace {
  surface: FieldNameSurface;
  /** Inside a group or a repeater rather than at the entity's top level. */
  nested: boolean;
  /** Whether Draft/Published is on, or turned on in the settings this save carries. */
  lifecycleEnabled: boolean;
  /**
   * The names the other fields at the same level hold, the field's own left out. A field deleted
   * but not yet saved still holds its name, so its name is among them.
   */
  siblingNames: readonly string[];
}

/** The rule's answer, in the panel's words: what is wrong and what to do. */
function described(name: string, problem: FieldNameProblem): string {
  switch (problem.kind) {
    case "spelling":
      return "Use lowercase letters, digits and underscores, starting with a letter.";
    case "column-too-long":
      return "Too long: a field's column may have at most 63 characters.";
    case "reserved":
      return `${name} is a built-in column here. Choose another name.`;
    case "lifecycle":
      return `${name} belongs to Draft/Published, which is on. Choose another name, or turn Draft/Published off and save that first.`;
  }
}

/**
 * Why `name` cannot be saved at `place`, in words for the person, or `null` when it can. An empty
 * name has its own answer, since a field needs one.
 */
export function builderNameProblem(
  name: string,
  place: BuilderNamePlace
): string | null {
  if (name === "") return "A field needs a name.";
  const problem = fieldNameProblem(name, {
    surface: place.surface,
    nested: place.nested,
    lifecycleEnabled: place.lifecycleEnabled,
  });
  if (problem) return described(name, problem);
  for (const other of place.siblingNames) {
    const kind = siblingNameClash(name, other);
    if (kind) {
      return `${other} here already has ${CLASH_WORDS[kind]}. Choose another name.`;
    }
  }
  return null;
}

/**
 * Whether `name` can be made savable by a numeric suffix: it is refused only for being taken, by a
 * sibling or as a built-in or lifecycle name. A name refused for its spelling or its length stays
 * refused whatever number follows it.
 */
export function nameIsTakenAt(name: string, place: BuilderNamePlace): boolean {
  const problem = fieldNameProblem(name, {
    surface: place.surface,
    nested: place.nested,
    lifecycleEnabled: place.lifecycleEnabled,
  });
  if (problem)
    return problem.kind === "reserved" || problem.kind === "lifecycle";
  return place.siblingNames.some(other => siblingNameClash(name, other));
}
