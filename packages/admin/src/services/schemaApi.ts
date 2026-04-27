// API service for schema preview/apply endpoints.
// Used by the visual schema builder save flow.
import { protectedApi } from "@admin/lib/api/protectedApi";

// Field change types returned by the preview endpoint
export interface SchemaPreviewChange {
  added: Array<{
    name: string;
    type: string;
    required: boolean;
    hasDefault: boolean;
    classification: string;
  }>;
  removed: Array<{
    name: string;
    type: string;
    rowCount: number;
    classification: string;
  }>;
  changed: Array<{
    name: string;
    from: string;
    to: string;
    rowCount: number;
    classification: string;
    reason: string;
  }>;
  unchanged: string[];
}

// A field that requires user input to resolve
export interface InteractiveField {
  name: string;
  reason: "new_required_no_default" | "nullable_to_not_null_with_nulls";
  tableRowCount: number;
  nullCount?: number;
  options: Array<"provide_default" | "mark_nullable" | "cancel">;
}

// Full response from the preview endpoint
export interface SchemaPreviewResponse {
  hasChanges: boolean;
  hasDestructiveChanges: boolean;
  classification: "safe" | "destructive" | "interactive";
  changes: SchemaPreviewChange;
  warnings: string[];
  interactiveFields: InteractiveField[];
  ddlPreview: string[];
  schemaVersion: number;
}

// Response from the apply endpoint.
// F1 PR 3: dropped the `restarting` field (single-process model means
// no child to restart). The dispatcher no longer emits it; this interface
// matches the new server shape.
export interface SchemaApplyResponse {
  success: boolean;
  message: string;
  newSchemaVersion: number;
}

// User resolution for an interactive field
export interface FieldResolution {
  action: "provide_default" | "mark_nullable" | "cancel";
  value?: string;
}

export const schemaApi = {
  // Preview schema changes (dry-run, returns diff without applying)
  preview: async (
    slug: string,
    fields: unknown[]
  ): Promise<SchemaPreviewResponse> => {
    return protectedApi.post<SchemaPreviewResponse>(
      `/collections/schema/${slug}/preview`,
      { fields }
    );
  },

  // Apply schema changes (in-place update, no server restart)
  apply: async (
    slug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>
  ): Promise<SchemaApplyResponse> => {
    return protectedApi.post<SchemaApplyResponse>(
      `/collections/schema/${slug}/apply`,
      { fields, confirmed: true, schemaVersion, resolutions }
    );
  },
};
