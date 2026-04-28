/**
 * Submission List Component
 *
 * Admin view for listing and managing form submissions.
 * Displays submissions in a filterable table with bulk actions.
 *
 * @module components/submissions/SubmissionList
 * @since 0.1.0
 */

"use client";

import type React from "react";
import { useState, useCallback, useMemo } from "react";

import type { SubmissionDocument, FormDocument, FormField } from "../../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the SubmissionList component.
 */
export interface SubmissionListProps {
  /** Form document containing field definitions */
  form: FormDocument;

  /** Array of submission documents to display */
  submissions: SubmissionDocument[];

  /** Whether data is currently loading */
  isLoading?: boolean;

  /** Callback when submission status is changed */
  onStatusChange?: (
    id: string,
    status: "new" | "read" | "archived"
  ) => Promise<void>;

  /** Callback when submission is deleted */
  onDelete?: (id: string) => Promise<void>;

  /** Callback when bulk delete is triggered */
  onBulkDelete?: (ids: string[]) => Promise<void>;

  /** Callback when bulk status change is triggered */
  onBulkStatusChange?: (
    ids: string[],
    status: "new" | "read" | "archived"
  ) => Promise<void>;

  /** Callback when export is triggered */
  onExport?: (format: "csv" | "json") => void;

  /** Callback when a submission is clicked for detail view */
  onViewDetail?: (submission: SubmissionDocument) => void;
}

/**
 * Status filter options.
 */
type StatusFilter = "all" | "new" | "read" | "archived";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a value for display in the table.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString();
  let str: string;
  if (typeof value === "object") {
    str = JSON.stringify(value);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value narrowed to primitive above; rule doesn't follow control flow on unknown
    str = String(value);
  }
  return str.length > 50 ? str.slice(0, 50) + "..." : str;
}

/**
 * Format a date for display.
 */
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Get status badge class name.
 */
function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "new":
      return "submission-status-badge submission-status-badge--new";
    case "read":
      return "submission-status-badge submission-status-badge--read";
    case "archived":
      return "submission-status-badge submission-status-badge--archived";
    default:
      return "submission-status-badge";
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Submission List Component
 *
 * Displays form submissions in a table with filtering, selection, and actions.
 *
 * @example
 * ```tsx
 * <SubmissionList
 *   form={form}
 *   submissions={submissions}
 *   onStatusChange={handleStatusChange}
 *   onDelete={handleDelete}
 *   onExport={handleExport}
 *   onViewDetail={handleViewDetail}
 * />
 * ```
 */
export function SubmissionList({
  form,
  submissions,
  isLoading = false,
  onStatusChange,
  onDelete,
  onBulkDelete,
  onBulkStatusChange,
  onExport,
  onViewDetail,
}: SubmissionListProps): React.ReactElement {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Computed Values
  // -------------------------------------------------------------------------

  /** Get display columns from form fields (first 3 fields) */
  const displayFields = useMemo((): FormField[] => {
    return form.fields.filter(f => f.type !== "hidden").slice(0, 3);
  }, [form.fields]);

  /** Filter submissions by status */
  const filteredSubmissions = useMemo((): SubmissionDocument[] => {
    if (filter === "all") return submissions;
    return submissions.filter(sub => sub.status === filter);
  }, [submissions, filter]);

  /** Check if all visible submissions are selected */
  const allSelected =
    filteredSubmissions.length > 0 &&
    selectedIds.size === filteredSubmissions.length &&
    filteredSubmissions.every(s => selectedIds.has(s.id));

  /** Check if some submissions are selected */
  const someSelected = selectedIds.size > 0;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /** Toggle selection for a single submission */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** Toggle selection for all visible submissions */
  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSubmissions.map(s => s.id)));
    }
  }, [allSelected, filteredSubmissions]);

  /** Handle status change for a single submission */
  const handleStatusChange = useCallback(
    async (id: string, status: "new" | "read" | "archived") => {
      if (!onStatusChange) return;

      setProcessingIds(prev => new Set(prev).add(id));
      try {
        await onStatusChange(id, status);
      } finally {
        setProcessingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [onStatusChange]
  );

  /** Handle delete for a single submission */
  const handleDelete = useCallback(
    async (id: string) => {
      if (!onDelete) return;
      if (!window.confirm("Are you sure you want to delete this submission?")) {
        return;
      }

      setProcessingIds(prev => new Set(prev).add(id));
      try {
        await onDelete(id);
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } finally {
        setProcessingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [onDelete]
  );

  /** Handle bulk delete */
  const handleBulkDelete = useCallback(async () => {
    if (!onBulkDelete || selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Are you sure you want to delete ${selectedIds.size} submission(s)?`
      )
    ) {
      return;
    }

    const ids = Array.from(selectedIds);
    ids.forEach(id => setProcessingIds(prev => new Set(prev).add(id)));

    try {
      await onBulkDelete(ids);
      setSelectedIds(new Set());
    } finally {
      setProcessingIds(new Set());
    }
  }, [onBulkDelete, selectedIds]);

  /** Handle bulk status change */
  const handleBulkStatusChange = useCallback(
    async (status: "new" | "read" | "archived") => {
      if (!onBulkStatusChange || selectedIds.size === 0) return;

      const ids = Array.from(selectedIds);
      ids.forEach(id => setProcessingIds(prev => new Set(prev).add(id)));

      try {
        await onBulkStatusChange(ids, status);
        setSelectedIds(new Set());
      } finally {
        setProcessingIds(new Set());
      }
    },
    [onBulkStatusChange, selectedIds]
  );

  /** Handle row click */
  const handleRowClick = useCallback(
    (submission: SubmissionDocument) => {
      onViewDetail?.(submission);
    },
    [onViewDetail]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="submission-list">
      {/* Toolbar */}
      <div className="submission-list__toolbar">
        <div className="submission-list__filters">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as StatusFilter)}
            className="submission-list__filter-select"
            aria-label="Filter by status"
          >
            <option value="all">All Submissions ({submissions.length})</option>
            <option value="new">
              New ({submissions.filter(s => s.status === "new").length})
            </option>
            <option value="read">
              Read ({submissions.filter(s => s.status === "read").length})
            </option>
            <option value="archived">
              Archived (
              {submissions.filter(s => s.status === "archived").length})
            </option>
          </select>
        </div>

        <div className="submission-list__actions">
          {/* Bulk Actions */}
          {someSelected && (
            <div className="submission-list__bulk-actions">
              <span className="submission-list__selected-count">
                {selectedIds.size} selected
              </span>
              {onBulkStatusChange && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleBulkStatusChange("read")}
                    className="submission-list__action-btn"
                  >
                    Mark Read
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBulkStatusChange("archived")}
                    className="submission-list__action-btn"
                  >
                    Archive
                  </button>
                </>
              )}
              {onBulkDelete && (
                <button
                  type="button"
                  onClick={() => void handleBulkDelete()}
                  className="submission-list__action-btn submission-list__action-btn--danger"
                >
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Export Actions */}
          {onExport && (
            <div className="submission-list__export-actions">
              <button
                type="button"
                onClick={() => onExport("csv")}
                className="submission-list__export-btn"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => onExport("json")}
                className="submission-list__export-btn"
              >
                Export JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="submission-list__table-container">
        <table className="submission-list__table">
          <thead>
            <tr>
              <th className="submission-list__th submission-list__th--checkbox">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all submissions"
                />
              </th>
              <th className="submission-list__th">ID</th>
              <th className="submission-list__th">Status</th>
              <th className="submission-list__th">Submitted</th>
              {displayFields.map(field => (
                <th key={field.name} className="submission-list__th">
                  {field.label}
                </th>
              ))}
              <th className="submission-list__th submission-list__th--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={5 + displayFields.length}
                  className="submission-list__loading"
                >
                  Loading submissions...
                </td>
              </tr>
            ) : filteredSubmissions.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + displayFields.length}
                  className="submission-list__empty"
                >
                  No submissions found
                </td>
              </tr>
            ) : (
              filteredSubmissions.map(submission => {
                const isSelected = selectedIds.has(submission.id);
                const isProcessing = processingIds.has(submission.id);

                return (
                  <tr
                    key={submission.id}
                    className={`submission-list__row ${
                      isSelected ? "submission-list__row--selected" : ""
                    } ${isProcessing ? "submission-list__row--processing" : ""}`}
                    onClick={() => handleRowClick(submission)}
                    style={{ cursor: onViewDetail ? "pointer" : "default" }}
                  >
                    <td
                      className="submission-list__td submission-list__td--checkbox"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(submission.id)}
                        disabled={isProcessing}
                        aria-label={`Select submission ${submission.id}`}
                      />
                    </td>
                    <td className="submission-list__td submission-list__td--id">
                      <code>{submission.id.slice(0, 8)}...</code>
                    </td>
                    <td className="submission-list__td">
                      <span className={getStatusBadgeClass(submission.status)}>
                        {submission.status}
                      </span>
                    </td>
                    <td className="submission-list__td">
                      {formatDate(submission.submittedAt)}
                    </td>
                    {displayFields.map(field => (
                      <td key={field.name} className="submission-list__td">
                        {formatValue(submission.data[field.name])}
                      </td>
                    ))}
                    <td
                      className="submission-list__td submission-list__td--actions"
                      onClick={e => e.stopPropagation()}
                    >
                      {onStatusChange && submission.status !== "read" && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleStatusChange(submission.id, "read")
                          }
                          disabled={isProcessing}
                          className="submission-list__row-action"
                          title="Mark as read"
                        >
                          Mark Read
                        </button>
                      )}
                      {onStatusChange && submission.status !== "archived" && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleStatusChange(submission.id, "archived")
                          }
                          disabled={isProcessing}
                          className="submission-list__row-action"
                          title="Archive"
                        >
                          Archive
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(submission.id)}
                          disabled={isProcessing}
                          className="submission-list__row-action submission-list__row-action--danger"
                          title="Delete"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="submission-list__summary">
        Showing {filteredSubmissions.length} of {submissions.length} submissions
      </div>
    </div>
  );
}
