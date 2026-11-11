/**
 * The badges a field's row in the outline shows: what a person would
 * otherwise open the field to find out. Required, a width other than full,
 * a condition that decides whether it is shown, and a default answer.
 *
 * @module admin/components/builder/field-badges
 */
import type { AnyFormField } from "../../../types";

/** One badge: its words, and a longer description where the words are short. */
export interface FieldBadge {
  kind: "required" | "width" | "condition" | "default";
  label: string;
  /** The whole of what the badge stands for, for its tooltip. */
  title?: string;
}

/** The longest default shown in full; a longer one is cut, with its whole in the title. */
const DEFAULT_LENGTH = 24;

/** A field's options, where it has any (select, radio). */
function optionsOf(
  field: AnyFormField
): readonly { label: string; value: string }[] {
  return "options" in field && Array.isArray(field.options)
    ? field.options
    : [];
}

/**
 * A default as a person reads it: a choice's label rather than its stored
 * value, a yes or no for a checkbox, and nothing for an empty one.
 */
function defaultText(field: AnyFormField): string | undefined {
  const value: unknown =
    "defaultValue" in field ? field.defaultValue : undefined;
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value ? "Checked" : undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  return optionsOf(field).find(option => option.value === text)?.label ?? text;
}

/**
 * What a field's condition does, as its badge's tooltip says it, naming the
 * fields it reads by their labels.
 */
function conditionTitle(
  field: AnyFormField,
  labelOf: (name: string) => string
): string | undefined {
  const logic = field.conditionalLogic;
  if (logic === undefined || !logic.enabled || logic.conditions.length === 0) {
    return undefined;
  }
  const fields = logic.conditions.map(condition => labelOf(condition.field));
  const which = logic.operator === "OR" ? "any" : "all";
  const verb = logic.action === "hide" ? "Hidden" : "Shown";
  return logic.conditions.length === 1
    ? `${verb} depending on ${fields[0]}`
    : `${verb} depending on ${which} of ${fields.join(", ")}`;
}

/**
 * The badges for `field`, in the order the row shows them. `labelOf` names
 * another field by its label, for a condition's tooltip.
 */
export function fieldBadges(
  field: AnyFormField,
  labelOf: (name: string) => string = name => name
): FieldBadge[] {
  const badges: FieldBadge[] = [];
  if (field.required) badges.push({ kind: "required", label: "Required" });
  const width = field.admin?.width;
  if (width !== undefined && width !== "100%") {
    badges.push({ kind: "width", label: width, title: `${width} of the row` });
  }
  const condition = conditionTitle(field, labelOf);
  if (condition !== undefined) {
    badges.push({
      kind: "condition",
      label:
        field.conditionalLogic?.action === "hide" ? "Hidden if…" : "Shown if…",
      title: condition,
    });
  }
  const fallback = defaultText(field);
  if (fallback !== undefined) {
    const cut =
      fallback.length > DEFAULT_LENGTH
        ? `${fallback.slice(0, DEFAULT_LENGTH - 1)}…`
        : fallback;
    badges.push({
      kind: "default",
      label: `= ${cut}`,
      title: `Default: ${fallback}`,
    });
  }
  return badges;
}
