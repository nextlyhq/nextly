"use client";

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

import { DataTableView } from "@nextlyhq/plugin-sdk/admin";
import type {
  DataTableSelection,
  NextlyColumn,
  RowAction,
} from "@nextlyhq/plugin-sdk/admin";
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

  // -------------------------------------------------------------------------
  // DataTable wiring (columns, selection, row actions)
  // -------------------------------------------------------------------------

  const columns = useMemo<NextlyColumn<SubmissionDocument>[]>(() => {
    const base: NextlyColumn<SubmissionDocument>[] = [
      {
        name: "id",
        header: "ID",
        cell: ({ row }) => (
          <code className="font-mono text-xs text-muted-foreground">
            {row.id.slice(0, 8)}...
          </code>
        ),
      },
      {
        name: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className="inline-flex items-center rounded-none border border-border bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">
            {row.status}
          </span>
        ),
      },
      {
        name: "submittedAt",
        header: "Submitted",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.submittedAt)}
          </span>
        ),
      },
    ];
    const fieldColumns: NextlyColumn<SubmissionDocument>[] = displayFields.map(
      field => ({
        name: `field:${field.name}`,
        header: field.label,
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm">{formatValue(row.data[field.name])}</span>
        ),
      })
    );
    return [...base, ...fieldColumns];
  }, [displayFields]);

  const selection = useMemo<DataTableSelection<SubmissionDocument>>(
    () => ({
      selectedIds: Array.from(selectedIds),
      onToggle: submission => toggleSelect(submission.id),
      onToggleAll: (rows, allChecked) => {
        const ids = rows.map(r => r.id);
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (allChecked) ids.forEach(id => next.delete(id));
          else ids.forEach(id => next.add(id));
          return next;
        });
      },
    }),
    [selectedIds, toggleSelect]
  );

  const rowActions = useCallback((): RowAction<SubmissionDocument>[] => {
    const actions: RowAction<SubmissionDocument>[] = [];
    if (onStatusChange) {
      actions.push(
        {
          id: "mark-read",
          label: "Mark Read",
          isVisible: r => r.status !== "read",
          isDisabled: r => processingIds.has(r.id),
          onSelect: r => void handleStatusChange(r.id, "read"),
        },
        {
          id: "archive",
          label: "Archive",
          isVisible: r => r.status !== "archived",
          isDisabled: r => processingIds.has(r.id),
          onSelect: r => void handleStatusChange(r.id, "archived"),
        }
      );
    }
    if (onDelete) {
      actions.push({
        id: "delete",
        label: "Delete",
        destructive: true,
        isDisabled: r => processingIds.has(r.id),
        onSelect: r => void handleDelete(r.id),
      });
    }
    return actions;
  }, [
    onStatusChange,
    onDelete,
    processingIds,
    handleStatusChange,
    handleDelete,
  ]);

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

      {/* Table (unified admin DataTable via the plugin SDK) */}
      <DataTableView<SubmissionDocument>
        columns={columns}
        rows={filteredSubmissions}
        loading={isLoading}
        selection={selection}
        rowActions={rowActions}
        onRowClick={
          onViewDetail ? submission => onViewDetail(submission) : undefined
        }
        registryKey="form-submissions"
        ariaLabel="Form submissions table"
        emptyMessage="No submissions found"
      />

      {/* Summary */}
      <div className="submission-list__summary">
        Showing {filteredSubmissions.length} of {submissions.length} submissions
      </div>
    </div>
  );
}
