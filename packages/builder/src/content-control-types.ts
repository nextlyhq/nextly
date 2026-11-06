/**
 * The prop types the Content tab has a control for.
 *
 * Its own module, free of React, so the inspection (`inspector.ts`) can say
 * which props are supported from this one list while the controls themselves
 * live in `content-controls.tsx`, which is typed as a record over exactly
 * these names: adding a type here without a control, or a control without a
 * type, fails to compile.
 *
 * @module content-control-types
 */

export const CONTENT_CONTROL_TYPES = [
  "text",
  "textarea",
  "url",
  "number",
  "checkbox",
  "select",
  "media",
  "icon",
  "richText",
  "array",
  "relation",
] as const;

export type ContentControlType = (typeof CONTENT_CONTROL_TYPES)[number];

/** Whether the Content tab has a control for a prop of this type. */
export function hasContentControl(type: string): type is ContentControlType {
  return (CONTENT_CONTROL_TYPES as readonly string[]).includes(type);
}
