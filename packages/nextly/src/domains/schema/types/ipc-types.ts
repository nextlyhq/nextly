// What: shared payload types for wrapper <-> child HTTP IPC.
// Why: both sides need exact agreement on shapes. Keeping these types in a
// dedicated module (not inside either wrapper or dispatcher) prevents circular
// imports and makes it obvious this is a cross-boundary contract.

import type { FieldDefinition } from "../../../schemas/dynamic-collections.js";
import type { SchemaClassification } from "../services/schema-change-types.js";

// Sent by wrapper to child when a config change is detected. The child uses
// this to render the PendingSchemaBanner in the admin UI and to track pending
// state for API callers.
export interface PendingChangePayload {
  slug: string;
  classification: SchemaClassification;
  diff: unknown;
  ddlPreview?: string[];
  rowCounts?: Record<string, number>;
  requestedAt: string;
}

// Sent by wrapper to child after DDL succeeds and the child process is about
// to be respawned. Allows the child (before restart completes from admin
// perspective) to bump its schema version header for any in-flight requests.
export interface AppliedChangePayload {
  slug: string;
  newFields: FieldDefinition[];
  newSchemaVersion: number;
  appliedAt: string;
}

// Queued in the child by the admin apply endpoint and polled by the wrapper.
// The wrapper runs DDL in its plain-Node context where drizzle-kit/api works,
// then signals the child to respawn.
export interface ApplyRequest {
  id: string;
  slug: string;
  newFields: FieldDefinition[];
  resolutions: Record<string, unknown>;
  confirmed: true;
}

// Sent from wrapper to child after an ApplyRequest has been processed so the
// admin endpoint that was long-polling on the request can resolve.
export interface ApplyRequestResult {
  id: string;
  success: boolean;
  newSchemaVersion?: number;
  error?: string;
}
