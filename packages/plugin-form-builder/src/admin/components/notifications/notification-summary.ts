/**
 * How a notification is described in a sentence: who it goes to, when, and
 * by which message. The list's rows and the page's header say the same thing
 * through these, so a notification never reads two ways.
 *
 * @module admin/components/notifications/notification-summary
 */
import type {
  AnyFormField,
  ConditionalLogicCondition,
  FormNotification,
} from "../../../types";
import { optionLabels } from "../../../utils/export-formats";
import { parseFieldRef } from "../../../utils/field-references";
import {
  conditionsOf,
  teamAddressesOf,
} from "../../../utils/notification-model";

import type { TemplateOption } from "./notification-sources";

/** A comparison as a sentence reads it. */
export const COMPARISON_WORDS: Record<
  ConditionalLogicCondition["comparison"],
  string
> = {
  equals: "is",
  notEquals: "is not",
  contains: "contains",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  greaterThan: "is more than",
  lessThan: "is less than",
};

/** Comparisons that take no value. */
export const VALUELESS: ReadonlySet<ConditionalLogicCondition["comparison"]> =
  new Set(["isEmpty", "isNotEmpty"]);

function fieldNamed(
  fields: readonly AnyFormField[],
  name: string
): AnyFormField | undefined {
  return fields.find(each => each.name === name);
}

function labelOf(fields: readonly AnyFormField[], name: string): string {
  return fieldNamed(fields, name)?.label || name;
}

/** Who a notification goes to, in a few words. */
export function recipientSummary(
  notification: FormNotification,
  fields: readonly AnyFormField[]
): string {
  if (notification.recipientType === "field") {
    const field = parseFieldRef(notification.to);
    return field === null
      ? "The person who submitted"
      : `The person who submitted (${labelOf(fields, field)})`;
  }
  const addresses = teamAddressesOf(notification);
  if (addresses.length === 0) return "No address yet";
  return addresses.join(", ");
}

/**
 * A condition's value as a sentence ends with it, with a leading space: an
 * option by its label, read the way a submission's answers are, so a
 * condition on a choice reads "is In person" rather than the stored
 * `in_person`.
 */
function valueText(value: unknown, field: AnyFormField | undefined): string {
  if (typeof value === "string" || typeof value === "number") {
    const options = field && "options" in field ? field.options : undefined;
    return options?.length
      ? ` ${optionLabels({ options }, String(value))}`
      : ` ${value}`;
  }
  if (typeof value === "boolean") return value ? " checked" : " not checked";
  return "";
}

/** When a notification sends, in a few words. */
export function whenSummary(
  notification: FormNotification,
  fields: readonly AnyFormField[]
): string {
  const { match, list } = conditionsOf(notification);
  if (list.length === 0) return "Every submission";
  if (list.length === 1) {
    const [condition] = list;
    const value = VALUELESS.has(condition.comparison)
      ? ""
      : valueText(condition.value, fieldNamed(fields, condition.field));
    return `Only when ${labelOf(fields, condition.field)} ${COMPARISON_WORDS[condition.comparison]}${value}`;
  }
  return `Only when ${match === "any" ? "any" : "all"} of ${list.length} conditions hold`;
}

/** The message a notification sends, by name, or undefined for none. */
export function messageOf(
  notification: FormNotification,
  templates: readonly TemplateOption[]
): TemplateOption | undefined {
  if (!notification.templateSlug) return undefined;
  return templates.find(each => each.slug === notification.templateSlug);
}
