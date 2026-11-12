/**
 * Find what references a form field by name, so destructive actions can be
 * guarded: a field that another field's conditional logic, a notification's
 * recipient/reply-to interpolation, or the form's one response per email
 * points at must not be silently deletable.
 */

import type { AnyFormField, FormNotification, FormSettings } from "../types";

/**
 * The one spelling of a field reference this plugin recognises: `{{fieldName}}`
 * with no spaces, and `\w` names.
 *
 * Exact, because the SEND path is exact — a value the admin accepts as a
 * reference and the send path does not is delivered with its braces intact,
 * straight to the mail provider. Both sides read this constant so the question
 * has one answer.
 */
export const FIELD_REF_PATTERN: RegExp = /^\{\{(\w+)\}\}$/;

/** The field named by a reference, or `null` when the value is not one. */
export function parseFieldRef(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(FIELD_REF_PATTERN);
  return match ? match[1] : null;
}

export interface FieldReference {
  /** What kind of thing holds the reference. */
  kind: "condition" | "notification" | "setting";
  /** Human label of the referrer (field label or notification name). */
  label: string;
}

/**
 * Match `{{ fieldName }}` interpolations (whitespace-tolerant), the syntax the
 * notification send path resolves recipients and reply-to values with.
 */
function templatePattern(fieldName: string, flags?: string): RegExp {
  return new RegExp(
    `\\{\\{\\s*${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`,
    flags
  );
}

function referencesInTemplate(template: string, fieldName: string): boolean {
  return templatePattern(fieldName).test(template);
}

/** What the form's settings say about one response per person. */
export type OneResponseChoice = Pick<
  FormSettings,
  "oneResponse" | "oneResponseField"
>;

/** The label a setting that refers to a field is named by. */
const ONE_RESPONSE_SETTING = "One response per person";

/**
 * The field one response per email compares, when the form takes one
 * response per email address; none otherwise.
 */
export function oneResponseEmailField(
  settings: OneResponseChoice | undefined
): string | undefined {
  return settings?.oneResponse === "email"
    ? settings.oneResponseField
    : undefined;
}

/**
 * All references to `fieldName` across the form's fields, notifications and
 * settings (the Email field one response per person compares).
 */
export function findFieldReferences(
  fieldName: string,
  fields: readonly AnyFormField[],
  notifications: readonly FormNotification[],
  settings?: OneResponseChoice
): FieldReference[] {
  const references: FieldReference[] = [];
  if (oneResponseEmailField(settings) === fieldName) {
    references.push({ kind: "setting", label: ONE_RESPONSE_SETTING });
  }

  for (const field of fields) {
    if (field.name === fieldName) continue;
    // Disabled conditional logic has no runtime effect, so it must not block
    // deletion; the dormant condition just goes stale.
    if (!field.conditionalLogic?.enabled) continue;
    const conditions = field.conditionalLogic.conditions ?? [];
    if (conditions.some(condition => condition.field === fieldName)) {
      references.push({ kind: "condition", label: field.label || field.name });
    }
  }

  for (const notification of notifications) {
    // A disabled rule has no runtime effect — like disabled conditional
    // logic above, it must not block deletion; its stale reference just
    // needs re-pointing if the rule is ever re-enabled.
    if (!notification.enabled) continue;
    // Field-sourced recipients and reply-to always carry the {{fieldName}}
    // syntax (the send path's resolveFieldRef only matches that form), so
    // one template check covers to/cc/bcc/replyTo uniformly.
    const templates = [
      notification.to,
      ...(notification.cc ?? []),
      ...(notification.bcc ?? []),
      notification.replyTo,
    ].filter((value): value is string => typeof value === "string");
    const referencedByTemplate = templates.some(template =>
      referencesInTemplate(template, fieldName)
    );
    // Send-conditions name the field directly (no interpolation syntax).
    const referencedByCondition = notification.condition?.field === fieldName;
    if (referencedByTemplate || referencedByCondition) {
      references.push({
        kind: "notification",
        label: notification.name || "Notification",
      });
    }
  }

  return references;
}

/**
 * Reference lists for every field in one pass, keyed by field name, so a
 * per-card lookup is O(1) instead of re-walking fields and notifications for
 * each card on every render.
 */
export function buildFieldReferenceMap(
  fields: readonly AnyFormField[],
  notifications: readonly FormNotification[],
  settings?: OneResponseChoice
): Map<string, FieldReference[]> {
  const map = new Map<string, FieldReference[]>();
  for (const field of fields) {
    map.set(
      field.name,
      findFieldReferences(field.name, fields, notifications, settings)
    );
  }
  return map;
}

/**
 * The fields with every condition on `from` naming `to` instead: the
 * conditions `findFieldReferences` reads, disabled ones too, so a rename never
 * leaves one pointing at a field that no longer has that name.
 */
export function renameInFieldConditions(
  fields: readonly AnyFormField[],
  from: string,
  to: string
): AnyFormField[] {
  return fields.map(field => {
    const logic = field.conditionalLogic;
    if (!logic?.conditions?.some(condition => condition.field === from)) {
      return field;
    }
    return {
      ...field,
      conditionalLogic: {
        ...logic,
        conditions: logic.conditions.map(condition =>
          condition.field === from ? { ...condition, field: to } : condition
        ),
      },
    };
  });
}

/**
 * The notifications with every reference to `from` naming `to` instead: the
 * addresses (`{{ from }}`) and the condition `findFieldReferences` reads.
 */
export function renameInNotifications(
  notifications: readonly FormNotification[],
  from: string,
  to: string
): FormNotification[] {
  const pattern = templatePattern(from, "g");
  const rename = (template: string): string =>
    template.replace(pattern, `{{${to}}}`);
  return notifications.map(notification => {
    // Stored notifications can predate the cc and bcc lists, so each part is
    // renamed only where it is there.
    const { cc, bcc } = notification as Partial<FormNotification>;
    const next: FormNotification = {
      ...notification,
      to: rename(notification.to),
    };
    if (cc) next.cc = cc.map(rename);
    if (bcc) next.bcc = bcc.map(rename);
    if (notification.replyTo !== undefined) {
      next.replyTo = rename(notification.replyTo);
    }
    if (notification.condition?.field === from) {
      next.condition = { ...notification.condition, field: to };
    }
    return next;
  });
}
