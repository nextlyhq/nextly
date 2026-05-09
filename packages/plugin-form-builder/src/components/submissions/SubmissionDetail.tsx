"use client";

/**
 * Submission Detail Component
 *
 * Admin view for viewing and managing a single form submission.
 * Displays all submission data, metadata, and provides status management.
 *
 * @module components/submissions/SubmissionDetail
 * @since 0.1.0
 */

"use client";

import type React from "react";
import { useState, useCallback } from "react";

import type { SubmissionDocument, FormDocument, FormField } from "../../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the SubmissionDetail component.
 */
export interface SubmissionDetailProps {
  /** Form document containing field definitions */
  form: FormDocument;

  /** Submission document to display */
  submission: SubmissionDocument;

  /** Callback when status is changed */
  onStatusChange?: (status: "new" | "read" | "archived") => Promise<void>;

  /** Callback when notes are updated */
  onNotesUpdate?: (notes: string) => Promise<void>;

  /** Callback when back button is clicked */
  onBack?: () => void;

  /** Callback when delete is triggered */
  onDelete?: () => Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Stringify a value safely, falling back to JSON for plain objects so we
 * never render the default `[object Object]` representation.
 */
function safeString(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format a value for display based on field type.
 */
function formatFieldValue(value: unknown, field: FormField): string {
  if (value === null || value === undefined) return "-";

  switch (field.type) {
    case "checkbox":
      return value ? "Yes" : "No";

    case "select":
      if (Array.isArray(value)) {
        return value.join(", ");
      }
      return safeString(value);

    case "file":
      if (Array.isArray(value)) {
        return value.map(v => safeString(v)).join(", ");
      }
      return safeString(value);

    case "date":
      if (value instanceof Date) {
        return value.toLocaleDateString();
      }
      if (typeof value === "string") {
        return new Date(value).toLocaleDateString();
      }
      return safeString(value);

    case "time":
      return safeString(value);

    default:
      return safeString(value);
  }
}

/**
 * Format a date for display.
 */
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Get status options.
 */
const STATUS_OPTIONS: Array<{
  value: "new" | "read" | "archived";
  label: string;
}> = [
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
];

// ============================================================================
// Component
// ============================================================================

/**
 * Submission Detail Component
 *
 * Displays full submission data with status management and notes.
 *
 * @example
 * ```tsx
 * <SubmissionDetail
 *   form={form}
 *   submission={submission}
 *   onStatusChange={handleStatusChange}
 *   onNotesUpdate={handleNotesUpdate}
 *   onBack={handleBack}
 * />
 * ```
 */
export function SubmissionDetail({
  form,
  submission,
  onStatusChange,
  onNotesUpdate,
  onBack,
  onDelete,
}: SubmissionDetailProps): React.ReactElement {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [isProcessing, setIsProcessing] = useState(false);
  const [notes, setNotes] = useState(
    (submission as unknown as { notes?: string }).notes || ""
  );
  const [notesModified, setNotesModified] = useState(false);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /** Handle status change */
  const handleStatusChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (!onStatusChange) return;

      const newStatus = event.target.value as "new" | "read" | "archived";
      setIsProcessing(true);

      try {
        await onStatusChange(newStatus);
      } finally {
        setIsProcessing(false);
      }
    },
    [onStatusChange]
  );

  /** Handle notes change */
  const handleNotesChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setNotes(event.target.value);
      setNotesModified(true);
    },
    []
  );

  /** Handle notes save */
  const handleNotesSave = useCallback(async () => {
    if (!onNotesUpdate || !notesModified) return;

    setIsProcessing(true);
    try {
      await onNotesUpdate(notes);
      setNotesModified(false);
    } finally {
      setIsProcessing(false);
    }
  }, [onNotesUpdate, notes, notesModified]);

  /** Handle delete */
  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    if (!window.confirm("Are you sure you want to delete this submission?")) {
      return;
    }

    setIsProcessing(true);
    try {
      await onDelete();
    } finally {
      setIsProcessing(false);
    }
  }, [onDelete]);

  // -------------------------------------------------------------------------
  // Computed Values
  // -------------------------------------------------------------------------

  /** Get displayable fields */
  const displayFields = form.fields;

  /** Get submission data */
  const data = submission.data;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="submission-detail">
      {/* Header */}
      <div className="submission-detail__header">
        <div className="submission-detail__header-left">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="submission-detail__back-btn"
              disabled={isProcessing}
            >
              &larr; Back to List
            </button>
          )}
          <h2 className="submission-detail__title">Submission Details</h2>
        </div>

        <div className="submission-detail__header-right">
          {onStatusChange && (
            <div className="submission-detail__status-control">
              <label htmlFor="submission-status">Status:</label>
              <select
                id="submission-status"
                value={submission.status}
                onChange={e => void handleStatusChange(e)}
                disabled={isProcessing}
                className="submission-detail__status-select"
              >
                {STATUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={isProcessing}
              className="submission-detail__delete-btn"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Submission ID */}
      <div className="submission-detail__id">
        <span className="submission-detail__id-label">Submission ID:</span>
        <code className="submission-detail__id-value">{submission.id}</code>
      </div>

      {/* Form Fields Data */}
      <div className="submission-detail__section">
        <h3 className="submission-detail__section-title">Submitted Data</h3>
        <div className="submission-detail__fields">
          {displayFields.map(field => (
            <div key={field.name} className="submission-detail__field">
              <div className="submission-detail__field-label">
                {field.label}
              </div>
              <div className="submission-detail__field-value">
                {formatFieldValue(data[field.name], field)}
              </div>
            </div>
          ))}

          {displayFields.length === 0 && (
            <div className="submission-detail__empty">No fields to display</div>
          )}
        </div>
      </div>

      {/* Notes Section */}
      {onNotesUpdate && (
        <div className="submission-detail__section">
          <h3 className="submission-detail__section-title">Internal Notes</h3>
          <div className="submission-detail__notes">
            <textarea
              value={notes}
              onChange={handleNotesChange}
              placeholder="Add internal notes about this submission..."
              disabled={isProcessing}
              className="submission-detail__notes-textarea"
              rows={4}
            />
            {notesModified && (
              <button
                type="button"
                onClick={() => void handleNotesSave()}
                disabled={isProcessing}
                className="submission-detail__notes-save-btn"
              >
                Save Notes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Metadata Section */}
      <div className="submission-detail__section">
        <h3 className="submission-detail__section-title">Metadata</h3>
        <div className="submission-detail__metadata">
          <div className="submission-detail__metadata-item">
            <span className="submission-detail__metadata-label">
              Submitted At:
            </span>
            <span className="submission-detail__metadata-value">
              {formatDate(submission.submittedAt)}
            </span>
          </div>

          {submission.ipAddress && (
            <div className="submission-detail__metadata-item">
              <span className="submission-detail__metadata-label">
                IP Address:
              </span>
              <span className="submission-detail__metadata-value">
                <code>{submission.ipAddress}</code>
              </span>
            </div>
          )}

          {submission.userAgent && (
            <div className="submission-detail__metadata-item">
              <span className="submission-detail__metadata-label">
                User Agent:
              </span>
              <span className="submission-detail__metadata-value submission-detail__metadata-value--truncate">
                {submission.userAgent}
              </span>
            </div>
          )}

          <div className="submission-detail__metadata-item">
            <span className="submission-detail__metadata-label">
              Created At:
            </span>
            <span className="submission-detail__metadata-value">
              {formatDate(submission.createdAt)}
            </span>
          </div>

          <div className="submission-detail__metadata-item">
            <span className="submission-detail__metadata-label">
              Updated At:
            </span>
            <span className="submission-detail__metadata-value">
              {formatDate(submission.updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Raw Data Section (Expandable) */}
      <details className="submission-detail__raw-data">
        <summary className="submission-detail__raw-data-summary">
          View Raw JSON Data
        </summary>
        <pre className="submission-detail__raw-data-content">
          {JSON.stringify(submission.data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
