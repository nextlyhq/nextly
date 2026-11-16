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
