// Hook for calling the schema preview API (dry-run).
// Returns the field-level diff without applying changes.
import { useMutation } from "@tanstack/react-query";

import {
  schemaApi,
  type SchemaPreviewResponse,
} from "@admin/services/schemaApi";

export function useSchemaPreview() {
  return useMutation<
    SchemaPreviewResponse,
    Error,
    { slug: string; fields: unknown[] }
  >({
    mutationFn: ({ slug, fields }) => schemaApi.preview(slug, fields),
  });
}
