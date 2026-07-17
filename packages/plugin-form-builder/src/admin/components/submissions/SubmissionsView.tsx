"use client";

/**
 * Submissions View
 *
 * The submissions list, replacing the generic collection table via the
 * List-view override. Submission data is stored keyed by field name, so
 * when one form is selected the table shows real per-field columns; across
 * all forms (where fields differ) it falls back to generic columns with a
 * data summary. Spam is a first-class status tab — flagged submissions are
 * reviewable and recoverable, never invisible.
 *
 * @module admin/components/submissions/SubmissionsView
 */

import {
  DataTableView,
  type NextlyColumn,
  type RowAction,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import { ChevronLeft, ChevronRight, Columns3, Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FormField } from "../../../types";
import { formatExportValue } from "../../../utils/export-formats";

import { SubmissionSheet } from "./SubmissionSheet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  id: string;
  form: string | { id: string; name?: string };
  data: Record<string, unknown>;
  status: string;
  spamReason?: string | null;
  notes?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  submittedAt?: string | null;
  editedAt?: string | null;
  editedBy?: string | null;
}

export interface FormOption {
  id: string;
  name: string;
  fields: FormField[];
}

interface SubmissionsViewProps {
  collectionSlug?: string;
}

type StatusTab = "all" | "new" | "read" | "archived" | "spam";

const STATUS_TABS: Array<{ value: StatusTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
  { value: "spam", label: "Spam" },
];

const PAGE_SIZE = 25;

/** How many per-field columns are visible before the rest hide behind the selector. */
const VISIBLE_FIELD_COLUMNS = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formIdOf(row: SubmissionRow): string {
  return typeof row.form === "object" ? row.form.id : row.form;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Status → badge styling. Tokens only; spam reads as a warning state. */
function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge
      variant="outline"
      className={`rounded-none px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${
        status === "spam"
          ? "border-destructive/40 text-destructive"
          : status === "new"
            ? "border-primary/40 text-primary"
            : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </Badge>
  );
}

/** Compact "key: value" preview of a submission for the all-forms table. */
function summarizeData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatExportValue(value)}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubmissionsView({ collectionSlug }: SubmissionsViewProps) {
  const [slugs, setSlugs] = useState<{ forms: string; submissions: string }>();
  const [forms, setForms] = useState<FormOption[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string>(() => {
    // Deep links (?form=<id>) preselect the form filter.
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("form") ?? "";
  });
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const submissionsSlug =
    slugs?.submissions ?? collectionSlug ?? "form-submissions";

  // --- bootstrap: resolved slugs, the forms list, and the user's rights ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const configRes = await fetch(
          "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config",
          { credentials: "include" }
        );
        const config = configRes.ok
          ? ((await configRes.json()) as {
              slugs?: { forms: string; submissions: string };
            })
          : null;
        const resolved = config?.slugs ?? {
          forms: "forms",
          submissions: "form-submissions",
        };
        if (cancelled) return;
        setSlugs(resolved);

        // Page through ALL forms — a capped single fetch would silently
        // drop forms from the filter and the per-field column lookup.
        const allForms: FormOption[] = [];
        const formsPageSize = 200;
        for (let formsPage = 1; ; formsPage += 1) {
          const formsRes = await fetch(
            `/admin/api/collections/${resolved.forms}/entries?pageSize=${formsPageSize}&page=${formsPage}`,
            { credentials: "include" }
          );
          if (!formsRes.ok) break;
          const json = (await formsRes.json()) as {
            items?: Array<{ id: string; name?: string; fields?: FormField[] }>;
          };
          const items = json.items ?? [];
          allForms.push(
            ...items.map(item => ({
              id: item.id,
              name: item.name ?? item.id,
              fields: Array.isArray(item.fields) ? item.fields : [],
            }))
          );
          if (items.length < formsPageSize) break;
        }
        if (!cancelled) setForms(allForms);

        const permsRes = await fetch("/admin/api/me/permissions", {
          credentials: "include",
        });
        if (permsRes.ok) {
          const perms = (await permsRes.json()) as {
            permissions?: string[];
            isSuperAdmin?: boolean;
          };
          const has = (slug: string) =>
            Boolean(perms.isSuperAdmin) ||
            (perms.permissions ?? []).includes(slug);
          if (!cancelled) {
            setCanUpdate(has(`update-${resolved.submissions}`));
            setCanDelete(has(`delete-${resolved.submissions}`));
          }
        }
      } catch {
        // Bootstrap failures degrade to the default slugs — without them
        // the list fetch would wait forever and the loading state never end.
        if (!cancelled) {
          setSlugs(
            current =>
              current ?? { forms: "forms", submissions: "form-submissions" }
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- the list fetch ------------------------------------------------------
  // Monotonic request sequence: rapid filter changes overlap fetches, and
  // only the LATEST request may commit rows — an older response finishing
  // last must never overwrite the current filter's data.
  const fetchSeqRef = useRef(0);
  const fetchRows = useCallback(async () => {
    if (!slugs) return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const where: Record<string, unknown> = {};
      if (selectedFormId) where.form = { equals: selectedFormId };
      // "All" means every human status; spam only shows when asked for —
      // the same default the export route applies.
      if (statusTab === "all") where.status = { not_equals: "spam" };
      else where.status = { equals: statusTab };

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy: "submittedAt",
        sortOrder: "desc",
        where: JSON.stringify(where),
      });
      const res = await fetch(
        `/admin/api/collections/${slugs.submissions}/entries?${params}`,
        { credentials: "include" }
      );
      if (!res.ok)
        throw new Error(`Failed to load submissions (${res.status})`);
      const json = (await res.json()) as {
        items?: SubmissionRow[];
        meta?: { total?: number };
      };
      if (seq !== fetchSeqRef.current) return;
      setRows(json.items ?? []);
      setTotal(json.meta?.total ?? (json.items ?? []).length);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load submissions"
      );
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [slugs, selectedFormId, statusTab, page]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const selectedForm = useMemo(
    () => forms.find(form => form.id === selectedFormId),
    [forms, selectedFormId]
  );

  const formNameById = useMemo(
    () => new Map(forms.map(form => [form.id, form.name])),
    [forms]
  );

  // --- columns --------------------------------------------------------------
  // Hidden field columns, per form. Wide forms start with everything past
  // the first few hidden; the toolbar's Columns menu toggles the rest in.
  const [hiddenFieldColumns, setHiddenFieldColumns] = useState<Set<string>>(
    new Set()
  );
  useEffect(() => {
    setHiddenFieldColumns(
      new Set(
        (selectedForm?.fields ?? [])
          .slice(VISIBLE_FIELD_COLUMNS)
          .map(field => field.name)
      )
    );
  }, [selectedForm]);

  const columns = useMemo<NextlyColumn<SubmissionRow>[]>(() => {
    if (selectedForm) {
      // One form selected: real per-field columns.
      const fieldColumns = selectedForm.fields
        .filter(field => !hiddenFieldColumns.has(field.name))
        .map<NextlyColumn<SubmissionRow>>(field => ({
          name: `data.${field.name}`,
          header: field.label || field.name,
          accessor: row => formatExportValue(row.data?.[field.name], field),
        }));
      return [
        ...fieldColumns,
        {
          name: "status",
          header: "Status",
          accessor: row => row.status,
          cell: ({ row }) => <StatusBadge status={row.status} />,
        },
        {
          name: "submittedAt",
          header: "Submitted",
          accessor: row => formatDate(row.submittedAt),
        },
      ];
    }
    return [
      {
        name: "form",
        header: "Form",
        accessor: row => formNameById.get(formIdOf(row)) ?? formIdOf(row),
      },
      {
        name: "data",
        header: "Submission",
        accessor: row => summarizeData(row.data ?? {}),
      },
      {
        name: "status",
        header: "Status",
        accessor: row => row.status,
        cell: ({ row }) => <StatusBadge status={row.status} />,
      },
      {
        name: "submittedAt",
        header: "Submitted",
        accessor: row => formatDate(row.submittedAt),
      },
    ];
  }, [selectedForm, formNameById, hiddenFieldColumns]);

  // --- actions ---------------------------------------------------------------
  const patchSubmission = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(
        `/admin/api/collections/${submissionsSlug}/entries/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      await fetchRows();
    },
    [submissionsSlug, fetchRows]
  );

  const deleteSubmission = useCallback(
    async (id: string) => {
      const res = await fetch(
        `/admin/api/collections/${submissionsSlug}/entries/${id}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setOpenId(null);
      await fetchRows();
    },
    [submissionsSlug, fetchRows]
  );

  const rowActions = useCallback(
    (row: SubmissionRow): RowAction<SubmissionRow>[] => {
      const actions: RowAction<SubmissionRow>[] = [];
      if (row.status === "spam" && canUpdate) {
        actions.push({
          id: "not-spam",
          label: "Not spam",
          onSelect: target =>
            void patchSubmission(target.id, {
              status: "new",
              spamReason: null,
            }),
        });
      }
      if (canDelete) {
        actions.push({
          id: "delete",
          label: "Delete",
          destructive: true,
          onSelect: target => void deleteSubmission(target.id),
        });
      }
      return actions;
    },
    [canUpdate, canDelete, patchSubmission, deleteSubmission]
  );

  // --- export ----------------------------------------------------------------
  const exportHref = useCallback(
    (format: "csv" | "json") => {
      const params = new URLSearchParams({ format });
      if (selectedFormId) params.set("form", selectedFormId);
      if (statusTab !== "all") params.set("status", statusTab);
      return `/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export?${params}`;
    },
    [selectedFormId, statusTab]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The open record is tracked by ID: after a save refetch the row may
  // move or leave the filtered view entirely — index tracking would silently
  // show a different submission, while a missing ID just closes the drawer.
  const openIndex = openId ? rows.findIndex(row => row.id === openId) : -1;
  const openRow = openIndex === -1 ? null : rows[openIndex];

  return (
    <div className="space-y-4">
      {/* Toolbar: form filter, status tabs, export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={selectedFormId || "__all"}
            onValueChange={value => {
              setSelectedFormId(value === "__all" ? "" : value);
              setPage(1);
              setOpenId(null);
            }}
          >
            <SelectTrigger
              aria-label="Filter by form"
              className="w-full sm:w-56 bg-transparent border-input dark:bg-muted/50"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All forms</SelectItem>
              {forms.map(form => (
                <SelectItem key={form.id} value={form.id}>
                  {form.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs
            value={statusTab}
            onValueChange={value => {
              setStatusTab(value as StatusTab);
              setPage(1);
              setOpenId(null);
            }}
          >
            <TabsList className="rounded-none">
              {STATUS_TABS.map(tab => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-none"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          {selectedForm && selectedForm.fields.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline">
                  <Columns3 className="h-4 w-4" aria-hidden="true" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="shadow-none border-border"
              >
                {selectedForm.fields.map(field => (
                  <DropdownMenuCheckboxItem
                    key={field.name}
                    checked={!hiddenFieldColumns.has(field.name)}
                    onCheckedChange={checked =>
                      setHiddenFieldColumns(prev => {
                        const next = new Set(prev);
                        if (checked) next.delete(field.name);
                        else next.add(field.name);
                        return next;
                      })
                    }
                    // Keep the menu open while toggling several columns.
                    onSelect={event => event.preventDefault()}
                  >
                    {field.label || field.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                <Download className="h-4 w-4" aria-hidden="true" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="shadow-none border-border"
            >
              {selectedFormId ? (
                <DropdownMenuItem asChild className="cursor-pointer">
                  <a href={exportHref("csv")} download>
                    CSV
                  </a>
                </DropdownMenuItem>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* CSV columns come from one form's fields, so it needs a
                      form selected; the tooltip says so instead of hiding it. */}
                    <DropdownMenuItem
                      disabled
                      onSelect={event => event.preventDefault()}
                    >
                      CSV
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Select a form first — CSV columns come from its fields.
                  </TooltipContent>
                </Tooltip>
              )}
              <DropdownMenuItem asChild className="cursor-pointer">
                <a href={exportHref("json")} download>
                  JSON
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTableView<SubmissionRow>
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        emptyMessage={
          statusTab === "spam"
            ? "No spam — nothing has been flagged."
            : "No submissions yet."
        }
        ariaLabel="Submissions"
        onRowClick={row => setOpenId(row.id)}
        rowActions={rowActions}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span role="status">
          {total === 0
            ? "0 submissions"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-none"
            disabled={page <= 1}
            onClick={() => setPage(current => current - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-none"
            disabled={page >= totalPages}
            onClick={() => setPage(current => current + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Detail drawer with prev/next over the current page */}
      {openRow && (
        <SubmissionSheet
          submission={openRow}
          form={
            forms.find(form => form.id === formIdOf(openRow)) ?? {
              id: formIdOf(openRow),
              name: formNameById.get(formIdOf(openRow)) ?? "Form",
              fields: [],
            }
          }
          canUpdate={canUpdate}
          onClose={() => setOpenId(null)}
          onPrev={
            openIndex > 0 ? () => setOpenId(rows[openIndex - 1].id) : undefined
          }
          onNext={
            openIndex < rows.length - 1
              ? () => setOpenId(rows[openIndex + 1].id)
              : undefined
          }
          onSave={async changes => {
            await patchSubmission(openRow.id, changes);
          }}
        />
      )}
    </div>
  );
}

export default SubmissionsView;
