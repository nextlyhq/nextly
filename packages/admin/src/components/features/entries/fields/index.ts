/**
 * Field Components
 *
 * Components for rendering and managing field inputs in entry forms.
 * Includes wrapper components, input components for all field types,
 * and conditional rendering logic.
 *
 * @module components/entries/fields
 * @since 1.0.0
 */

// Field infrastructure
export { FieldWrapper, type FieldWrapperProps } from "./FieldWrapper";
export { FieldRenderer, type FieldRendererProps } from "./FieldRenderer";

// Text field inputs
export { TextInput, type TextInputProps } from "./text";
export { TextareaInput, type TextareaInputProps } from "./text";

// Number field inputs
export { NumberInput, type NumberInputProps } from "./number";

// Selection field inputs
export { SelectInput, type SelectInputProps } from "./selection";
export { CheckboxInput, type CheckboxInputProps } from "./selection";
export { DateInput, type DateInputProps } from "./selection";

// Structured field inputs (arrays, groups)
export {
  ArrayInput,
  type ArrayInputProps,
  ArrayRow,
  type ArrayRowProps,
  ArrayRowLabel,
  type ArrayRowLabelComponentProps,
  type RenderFieldFunction,
  GroupInput,
  type GroupInputProps,
} from "./structured";

// Relational field inputs (relationships)
export {
  RelationshipInput,
  type RelationshipInputProps,
  type RelationshipValue,
  type SingleRelationshipValue,
  type MultiRelationshipValue,
  type PolymorphicRelationshipValue,
  RelationshipSearch,
  type RelationshipSearchProps,
  type SearchResultItem,
  RelationshipCard,
  type RelationshipCardProps,
  type RelatedItem,
} from "./relational";

// Media field inputs (uploads)
export {
  UploadInput,
  type UploadInputProps,
  UploadPreview,
  type UploadPreviewProps,
  type UploadedFile,
  UploadProgress,
  type UploadProgressProps,
} from "./media";

// Special field inputs (rich text, code, etc.)
export { RichTextInput, type RichTextInputProps } from "./special";
