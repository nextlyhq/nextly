/**
 * Structured Field Components
 *
 * Components for complex, structured field types like repeaters,
 * groups, and blocks.
 *
 * @module components/entries/fields/structured
 * @since 1.0.0
 */

// Repeater field components
export { RepeaterInput, type RepeaterInputProps } from "./RepeaterInput";
export {
  RepeaterRow,
  type RepeaterRowProps,
  type RenderFieldFunction,
} from "./RepeaterRow";
export {
  RepeaterRowLabel,
  type RepeaterRowLabelComponentProps,
} from "./RepeaterRowLabel";

// Group field component
export { GroupInput, type GroupInputProps } from "./GroupInput";

// JSON field component
export { JsonInput, type JsonInputProps } from "./JsonInput";
// The read-only form renderer for a blocks field. It lives with the other
// structured-field controls because a page document is structured content, and
// it is exported here so FieldRenderer resolves it the same way as the rest.
