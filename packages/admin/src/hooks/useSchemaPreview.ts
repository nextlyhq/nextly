// Hook for calling the schema preview API (dry-run).
// Returns the field-level diff without applying changes.

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import {
  schemaApi,
  type SchemaPreviewResponse,
} from "@admin/services/schemaApi";

export function useSchemaPreview(): UseMutationResult<
  SchemaPreviewResponse,
  Error,
  {
    slug: string;
    fields: unknown[];
  },
  unknown
> {
  return useMutation<
    SchemaPreviewResponse,
    Error,
    { slug: string; fields: unknown[] }
  >({
    mutationFn: ({ slug, fields }) => schemaApi.preview(slug, fields),
  });
}
