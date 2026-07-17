/**
 * Find what references a form field by name, so destructive actions can be
 * guarded: a field that another field's conditional logic or a notification's
 * recipient/reply-to interpolation points at must not be silently deletable.
 */

import type { FormField, FormNotificationItem } from "../types";

export interface FieldReference {
  /** What kind of thing holds the reference. */
  kind: "condition" | "notification";
  /** Human label of the referrer (field label or notification name). */
  label: string;
}

/**
 * Match `{{ fieldName }}` interpolations (whitespace-tolerant), the syntax the
 * notification send path resolves recipients and reply-to values with.
 */
function referencesInTemplate(template: string, fieldName: string): boolean {
  const pattern = new RegExp(
    `\\{\\{\\s*${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`
  );
  return pattern.test(template);
}

/** All references to `fieldName` across the form's fields and notifications. */
export function findFieldReferences(
  fieldName: string,
  fields: readonly FormField[],
  notifications: readonly FormNotificationItem[]
): FieldReference[] {
  const references: FieldReference[] = [];

  for (const field of fields) {
    if (field.name === fieldName) continue;
    const conditions = field.conditionalLogic?.conditions ?? [];
    if (conditions.some(condition => condition.field === fieldName)) {
      references.push({ kind: "condition", label: field.label || field.name });
    }
  }

  for (const notification of notifications) {
    // Field-sourced recipients always carry the {{fieldName}} syntax (the
    // send path's resolveFieldRef only matches that form), so one template
    // check covers to/cc/bcc uniformly.
    const templates = [
      notification.to,
      ...(notification.cc ?? []),
      ...(notification.bcc ?? []),
    ].filter((value): value is string => typeof value === "string");
    if (templates.some(template => referencesInTemplate(template, fieldName))) {
      references.push({
        kind: "notification",
        label: notification.name || "Notification",
      });
    }
  }

  return references;
}
