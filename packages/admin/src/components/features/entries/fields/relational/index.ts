/**
 * Relational Field Components
 *
 * Components for relationship field inputs that allow selecting
 * related documents from other collections.
 *
 * @module components/entries/fields/relational
 * @since 1.0.0
 */

// Main relationship input component
export {
  RelationshipInput,
  type RelationshipInputProps,
  type RelationshipValue,
  type SingleRelationshipValue,
  type MultiRelationshipValue,
  type PolymorphicRelationshipValue,
} from "./RelationshipInput";

// Search component for finding related documents
export {
  RelationshipSearch,
  type RelationshipSearchProps,
  type SearchResultItem,
} from "./RelationshipSearch";

// Card component for displaying selected relationships
export {
  RelationshipCard,
  type RelationshipCardProps,
  type RelatedItem,
} from "./RelationshipCard";

// Modal for inline creation of related documents
export {
  RelationshipCreateModal,
  type RelationshipCreateModalProps,
  type CreatedEntry,
} from "./RelationshipCreateModal";

// Modal for inline editing of related documents
export {
  RelationshipQuickEdit,
  type RelationshipQuickEditProps,
} from "./RelationshipQuickEdit";

// Join field for displaying reverse relationships (virtual field)
export { JoinField, type JoinFieldProps } from "./JoinField";
