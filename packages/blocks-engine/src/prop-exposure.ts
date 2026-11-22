/**
 * Which exposure type edits a prop: the one mapping from a prop's declared
 * field type to the control an author edits it with. Shared by the component
 * exposure planners and the binding rules, which derive their prop kinds from
 * it.
 *
 * @module prop-exposure
 */
import type { PropSchema } from "./block";
import type { ExposedPropertyType } from "./document";
import { isPlainRecord } from "./plain-record";
import { RICH_TEXT_PROP_TYPE } from "./rich-text";

/**
 * The exposure type that edits a prop of this schema, or `undefined` for none.
 *
 * By the prop's declared field type: a text field is edited as text, rich text
 * as rich text, a media reference as an image, a URL as a link, and a select
 * as a select. Anything else (a number, a checkbox, a list) has no exposure
 * control, so it is not offered.
 *
 * An image exposes the MEDIA prop, the value the image control writes as its
 * source of truth; the block resolves its address from that, so one exposure
 * drives one path.
 *
 * @experimental Settles when the component editor that uses it ships.
 */
export function exposureTypeForProp(
  schema: PropSchema | undefined
): Exclude<ExposedPropertyType, "visibility"> | undefined {
  switch (schema?.type) {
    case "text":
    case "textarea":
    case "email":
      return "text";
    case RICH_TEXT_PROP_TYPE:
      return "richText";
    case "media":
      return "image";
    case "url":
      return "link";
    case "select":
      return "select";
    default:
      return undefined;
  }
}

/**
 * The values a select prop declares, as stored strings or `{ value }` records.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function choicesOfProp(schema: PropSchema): readonly string[] {
  const options: unknown = schema.options;
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options as unknown[]) {
    if (typeof option === "string") values.push(option);
    else if (isPlainRecord(option) && typeof option.value === "string") {
      values.push(option.value);
    }
  }
  return values;
}

/**
 * Whether a select prop can render every one of `choices`: each is one it
 * declares, or it declares none and takes any. A choice it lacks reaches the
 * block as written, which it can't draw, so a field or a setting offering one
 * may not fill it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function choicesFitProp(
  choices: readonly string[],
  schema: PropSchema
): boolean {
  const allowed = choicesOfProp(schema);
  return (
    allowed.length === 0 || choices.every(choice => allowed.includes(choice))
  );
}
