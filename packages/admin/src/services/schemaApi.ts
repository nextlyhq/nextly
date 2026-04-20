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

// Response from the apply endpoint
export interface SchemaApplyResponse {
  success: boolean;
  restarting: boolean;
  message: string;
  newSchemaVersion: number;
}

// User resolution for an interactive field
export interface FieldResolution {
  action: "provide_default" | "mark_nullable" | "cancel";
  value?: string;
}

// What: shape of the pending schema change exposed by the wrapper.
// Why: the admin UI's PendingSchemaBanner polls this to know when a
// code-first edit is waiting for confirmation (only populated when running
// under `nextly dev` wrapper). null when no change is pending or when
// running plain `next dev`.
export interface PendingSchemaChangeResponse {
  pending: {
    slug: string;
    classification: "safe" | "destructive" | "interactive";
    diff: SchemaPreviewChange;
    ddlPreview?: string[];
    rowCounts?: Record<string, number>;
    receivedAt: string;
  } | null;
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

  // Fetch the wrapper's current pending schema change, if any.
  getPending: async (): Promise<PendingSchemaChangeResponse> => {
    return protectedApi.get<PendingSchemaChangeResponse>(
      `/admin-meta/schema-pending`
    );
  },
};
