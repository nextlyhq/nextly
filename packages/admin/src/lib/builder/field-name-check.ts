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
  type FieldNameProblemKind,
  type FieldNameSurface,
  type SiblingClashKind,
} from "nextly/config";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";

/** How a refusal words each way two sibling names clash, wherever the Builder refuses one. */
export const CLASH_WORDS: Record<SiblingClashKind, string> = {
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
   * Whether the field becomes a column (`fieldProducesColumn`). A field that makes none carries its
   * name in no column, so a column's length does not reach it. Absent is a column, as the save
   * assumes.
   */
  producesColumn?: boolean;
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
 * The rule `name` breaks at `place` on its own, before any sibling is asked, with the panel's words
 * for it, or `null` when it breaks none. A move and a copy ask it of a name new at its place, as the
 * save does.
 */
export function nameRuleProblem(
  name: string,
  place: Omit<BuilderNamePlace, "siblingNames">
): { kind: FieldNameProblemKind; message: string } | null {
  const problem = fieldNameProblem(name, {
    surface: place.surface,
    nested: place.nested,
    lifecycleEnabled: place.lifecycleEnabled,
    ...(place.producesColumn === undefined
      ? {}
      : { producesColumn: place.producesColumn }),
  });
  return problem
    ? { kind: problem.kind, message: described(name, problem) }
    : null;
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
  const problem = nameRuleProblem(name, place);
  if (problem) return problem.message;
  for (const other of place.siblingNames) {
    const kind = siblingNameClash(name, other);
    if (kind) {
      return `${other} here already has ${CLASH_WORDS[kind]}. Choose another name.`;
    }
  }
  return null;
}

/**
 * Whether `name` is taken at `place`, so a numeric suffix should move past it: a sibling holds it,
 * or a built-in column or Draft/Published does. A name refused for its spelling or its length is
 * not taken, since no number frees it, but is still taken when a sibling holds it.
 */
export function nameIsTakenAt(name: string, place: BuilderNamePlace): boolean {
  const problem = nameRuleProblem(name, place);
  if (problem?.kind === "reserved" || problem?.kind === "lifecycle")
    return true;
  // A spelling or length problem says nothing of whether a sibling holds the name, so they are
  // asked whatever it is.
  return place.siblingNames.some(other => siblingNameClash(name, other));
}
