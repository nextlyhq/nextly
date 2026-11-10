/**
 * The hooks a plugin reads and writes the document being edited through, as
 * the SDK publishes them: the named values or `null` outside an editor, and
 * one field's value, whether it may be written now, and a write that answers
 * whether it was taken.
 */
import { expectTypeOf } from "vitest";

import type {
  DocumentField,
  useDocumentField,
  useDocumentValues,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<{
  values: typeof useDocumentValues;
  field: typeof useDocumentField;
  shape: DocumentField;
}>().toEqualTypeOf<{
  values: (
    paths: readonly string[]
  ) => Readonly<Record<string, unknown>> | null;
  field: (path: string) => DocumentField | null;
  shape: {
    value: unknown;
    writable: boolean;
    set: (next: unknown) => boolean;
  };
}>();
