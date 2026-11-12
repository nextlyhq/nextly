/**
 * How a stored notification reads, whatever shape it was saved in. The admin
 * and the send path both read notifications through this module, so a rule
 * saved before several recipients, several conditions or per-notification
 * attachments existed means the same thing to each.
 *
 * - Recipients: a team notification's `recipients` list, or its single `to`
 *   address as one, as notifications were saved before.
 * - Conditions: `conditions` (a match, all or any, and a list), or the single
 *   `condition` as a list of one under all.
 * - Attachments: `attachFields`, the names of the form's file fields whose
 *   files go with this notification, or, for a rule saved before it, exactly
 *   the file fields marked to attach to notification emails, so nothing extra
 *   is ever attached on upgrade.
 *
 * @module utils/notification-model
 */
import type {
  AnyFormField,
  ConditionalLogicCondition,
  FormNotification,
} from "../types";

import { evaluateSingleCondition } from "./evaluate-conditions";

/** How several conditions combine: all must hold, or any one. */
export type ConditionMatch = "all" | "any";

/** A notification's send conditions, as read. */
export interface NotificationConditions {
  match: ConditionMatch;
  list: ConditionalLogicCondition[];
}

/**
 * Split typed addresses into a list: separated by commas, semicolons,
 * spaces or new lines, each trimmed, blanks and repeats dropped.
 */
export function parseAddressList(text: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim();
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    list.push(address);
  }
  return list;
}

/**
 * A team notification's addresses: its list, or the single address it was
 * saved with. Trimmed, blanks dropped.
 */
export function teamAddressesOf(notification: FormNotification): string[] {
  const stored = Array.isArray(notification.recipients)
    ? notification.recipients
    : typeof notification.to === "string"
      ? [notification.to]
      : [];
  return stored
    .map(address => (typeof address === "string" ? address.trim() : ""))
    .filter(Boolean);
}

/** A notification's conditions, as a match and a list. */
export function conditionsOf(
  notification: FormNotification
): NotificationConditions {
  const stored = notification.conditions;
  if (stored && Array.isArray(stored.list)) {
    return {
      match: stored.match === "any" ? "any" : "all",
      list: stored.list.filter(isCondition),
    };
  }
  return {
    match: "all",
    list: notification.condition ? [notification.condition] : [],
  };
}

function isCondition(value: unknown): value is ConditionalLogicCondition {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { field?: unknown }).field === "string" &&
    typeof (value as { comparison?: unknown }).comparison === "string"
  );
}

/**
 * Whether a notification sends for these answers: every condition holds
 * (all) or one does (any). One with no conditions always sends.
 */
export function conditionsMet(
  conditions: NotificationConditions,
  data: Record<string, unknown>
): boolean {
  if (conditions.list.length === 0) return true;
  const holds = (condition: ConditionalLogicCondition) =>
    evaluateSingleCondition(condition, data);
  return conditions.match === "any"
    ? conditions.list.some(holds)
    : conditions.list.every(holds);
}

/**
 * The file fields whose files go with a notification, by name: its own
 * choice, or for a rule saved before it, the fields marked to attach.
 */
export function attachFieldsOf(
  notification: FormNotification,
  fields: readonly AnyFormField[]
): string[] {
  if (Array.isArray(notification.attachFields)) {
    return notification.attachFields.filter(
      (name): name is string => typeof name === "string"
    );
  }
  return fieldsMarkedToAttach(fields);
}

/**
 * The file fields marked to attach to notification emails, by name: what
 * every email carried before each notification chose its own.
 */
export function fieldsMarkedToAttach(
  fields: ReadonlyArray<{ type?: unknown; name?: unknown }>
): string[] {
  return fields
    .filter(
      field =>
        field.type === "file" &&
        (field as { attachToEmail?: unknown }).attachToEmail === true &&
        typeof field.name === "string"
    )
    .map(field => field.name as string);
}

/** The media ids a submission holds under the named file fields. */
export function attachmentsFrom(
  fieldNames: readonly string[],
  data: Record<string, unknown>
): Array<{ mediaId: string }> {
  const attachments: Array<{ mediaId: string }> = [];
  for (const name of fieldNames) {
    const value = data[name];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string" && item) {
        attachments.push({ mediaId: item });
      }
    }
  }
  return attachments;
}
