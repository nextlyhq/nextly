/**
 * Whether a default a field states can stand for it where no write validates it: as the value a
 * Single's existing row is filled with when the field is added, and as a Single's first document
 * when the default is spelled `default`, which the field payload keeps without checking.
 *
 * Only built-in types whose value needs no check beyond its form are taken: text kinds holding one
 * string, a finite number, a checkbox's boolean, a value JSON can hold, and a date naming a real
 * moment. A relationship's or upload's id may name no row; a contributed type's value is that
 * type's to validate; a password is only ever stored as a hash. None of these is taken, and a
 * value of the wrong form (text for a number) is taken as no default at all.
 */

/** The text kinds whose stated default is taken as their text. */
export const STATED_TEXT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "email",
  "code",
  "select",
  "radio",
]);

/** Whether `value`, stated as `field`'s default, is one `field` can hold as it is. */
export function statedDefaultFits(
  field: { type: string; hasMany?: unknown },
  value: unknown
): boolean {
  if (STATED_TEXT_TYPES.has(field.type)) {
    return typeof value === "string" && field.hasMany !== true;
  }
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "checkbox":
      return typeof value === "boolean";
    case "json":
      return jsonCanHold(value);
    case "date":
      return statedMoment(value) !== null;
    default:
      return false;
  }
}

/** The moment a stated date names, or null when it names none. */
export function statedMoment(value: unknown): Date | null {
  const at =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return at === null || Number.isNaN(at.getTime()) ? null : at;
}

/** Whether JSON can hold `value`: serializing it neither throws nor yields nothing. */
function jsonCanHold(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}
