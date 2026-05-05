/**
 * Single Form Components
 *
 * Components for editing Single documents. The shell composes the shared
 * EntrySystemHeader / EntryMetaStrip / EntryFormSidebar primitives so the
 * Singles edit page matches the collection entry edit page in structure
 * while preserving the Singles-specific concerns (no create/delete, single
 * persistent document, status flag wiring).
 *
 * @module components/singles
 */

export {
  SingleForm,
  type SingleFormProps,
  type SingleSchema,
  type SingleDocumentData,
} from "./SingleForm";
