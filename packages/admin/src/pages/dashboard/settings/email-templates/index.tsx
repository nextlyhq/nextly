"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@nextlyhq/ui";
import type React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";

import {
  SettingsLayout,
  SettingsTableToolbar,
} from "@admin/components/features/settings";
import {
  AlertTriangle,
  Columns,
  Copy,
  Edit,
  Eye,
  Loader2,
  Plus,
  Trash2,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailTemplates,
  useDeleteEmailTemplate,
  usePreviewEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

// Built-in template slugs that cannot be deleted.
const BUILT_IN_SLUGS = new Set([
  "welcome",
  "password-reset",
  "email-verification",
]);

function formatDate(dateValue?: string): string {
  return formatDateWithAdminTimezone(
    dateValue,
    { year: "numeric", month: "short", day: "numeric" },
    "N/A"
  );
}

// Sample data for the list preview — mirrors the workbench values so the
// preview renders the real variables instead of leaving them blank.
const PREVIEW_SAMPLE_DATA: Record<string, string> = {
  appName: "Northwind",
  year: String(new Date().getFullYear()),
  userName: "Priya Raman",
  userEmail: "priya.raman@northwind.io",
  verifyLink: "https://app.northwind.io/verify?token=8f2c1a",
  resetLink: "https://app.northwind.io/reset?token=8f2c1a",
  url: "https://app.northwind.io/action?token=8f2c1a",
  token: "8f2c1a",
  expiresIn: "30 minutes",
  siteName: "Northwind",
  siteUrl: "https://northwind.io",
};

// ============================================================
// Delete Dialog
// ============================================================

function TemplateDeleteDialog({
  open,
  onOpenChange,
  template,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: { id: string; name: string } | null;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-template-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Delete Email Template?</DialogTitle>
          <DialogDescription id="delete-template-description">
            Are you sure you want to delete <strong>{template.name}</strong>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Preview Dialog
// ============================================================

function TemplatePreviewDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: { id: string; name: string } | null;
}) {
  const { mutate: doPreview, isPending: isLoading } = usePreviewEmailTemplate();
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");

  useEffect(() => {
    if (!open || !template) return;
    doPreview(
      { id: template.id, sampleData: PREVIEW_SAMPLE_DATA },
      {
        onSuccess: result => {
          setPreviewSubject(result.subject);
          setPreviewHtml(result.html);
        },
        onError: err => {
          toast.error("Failed to load preview", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
          onOpenChange(false);
        },
      }
    );
  }, [open, template, doPreview, onOpenChange]);

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview: {template.name}</DialogTitle>
          {previewSubject && (
            <DialogDescription>Subject: {previewSubject}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-auto border border-border rounded-none">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <iframe
              srcDoc={previewHtml}
              title={`Preview: ${template.name}`}
              className="w-full h-[400px] border-0"
              sandbox=""
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Template Table (unified DataTableView)
// ============================================================

const ALWAYS_VISIBLE = new Set(["name"]);

function EmailTemplateTable() {
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useEmailTemplates();

  const { mutate: doDelete, isPending: isDeleting } = useDeleteEmailTemplate();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [templateToPreview, setTemplateToPreview] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filteredTemplates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter(
      t =>
        t.name.toLowerCase().includes(term) ||
        t.slug.toLowerCase().includes(term) ||
        t.subject.toLowerCase().includes(term)
    );
  }, [templates, search]);

  const totalItems = filteredTemplates.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paginatedTemplates = useMemo(
    () => filteredTemplates.slice(page * pageSize, (page + 1) * pageSize),
    [filteredTemplates, page, pageSize]
  );

  useEffect(() => {
    setPage(0);
  }, [search]);

  const handleEdit = useCallback((template: EmailTemplateRecord) => {
    navigateTo(
      buildRoute(ROUTES.SETTINGS_EMAIL_TEMPLATES_EDIT, { id: template.id })
    );
  }, []);

  const handleDelete = useCallback((template: EmailTemplateRecord) => {
    setTemplateToDelete({ id: template.id, name: template.name });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!templateToDelete) return;
    doDelete(templateToDelete.id, {
      onSuccess: () => {
        toast.success("Template deleted", {
          description: `${templateToDelete.name} has been deleted.`,
        });
        setDeleteDialogOpen(false);
        setTemplateToDelete(null);
      },
      onError: err => {
        setDeleteDialogOpen(false);
        setTemplateToDelete(null);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        if (!errorMessage.toLowerCase().includes("not found")) {
          toast.error("Delete failed", { description: errorMessage });
        } else {
          toast.success("Template deleted", {
            description: `${templateToDelete.name} has been deleted.`,
          });
        }
      },
    });
  }, [templateToDelete, doDelete]);

  const handlePreview = useCallback((template: EmailTemplateRecord) => {
    setTemplateToPreview({ id: template.id, name: template.name });
    setPreviewDialogOpen(true);
  }, []);

  const handleDuplicate = useCallback((template: EmailTemplateRecord) => {
    navigateTo(
      `${ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE}?duplicate=${template.id}`
    );
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const allColumns = useMemo<NextlyColumn<EmailTemplateRecord>[]>(
    () => [
      {
        name: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {BUILT_IN_SLUGS.has(row.slug) && (
              <Badge variant="outline">Built-in</Badge>
            )}
          </div>
        ),
      },
      {
        name: "slug",
        header: "Slug",
        hideOnMobile: true,
        cell: ({ row }) => (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded-none font-mono">
            {row.slug}
          </code>
        ),
      },
      {
        name: "subject",
        header: "Subject",
        cell: ({ row }) => (
          <span className="text-sm truncate max-w-60 block">{row.subject}</span>
        ),
      },
      {
        name: "providerId",
        header: "Provider",
        hideOnMobile: true,
        cell: ({ row }) =>
          row.providerId ? (
            <Badge>Custom</Badge>
          ) : (
            <Badge variant="outline">Default</Badge>
          ),
      },
      {
        name: "isActive",
        header: "Status",
        hideOnMobile: true,
        cell: ({ row }) =>
          row.isActive ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warning">Inactive</Badge>
          ),
      },
      {
        name: "createdAt",
        header: "Created",
        hideOnMobile: true,
        cell: ({ row }) => (
          <span className="text-sm">{formatDate(row.createdAt)}</span>
        ),
      },
    ],
    []
  );

  const columns = useMemo(
    () =>
      allColumns.map(col => ({ ...col, hidden: hiddenColumns.has(col.name) })),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(col.name)),
    [allColumns]
  );

  const rowActions = useCallback(
    (template: EmailTemplateRecord): RowAction<EmailTemplateRecord>[] => {
      const actions: RowAction<EmailTemplateRecord>[] = [
        {
          id: "edit",
          label: "Edit",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => handleEdit(template),
        },
        {
          id: "preview",
          label: "Preview",
          icon: <Eye className="h-4 w-4" />,
          onSelect: () => handlePreview(template),
        },
        {
          id: "duplicate",
          label: "Duplicate",
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => handleDuplicate(template),
        },
      ];
      if (!BUILT_IN_SLUGS.has(template.slug)) {
        actions.push({
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => handleDelete(template),
        });
      }
      return actions;
    },
    [handleEdit, handlePreview, handleDuplicate, handleDelete]
  );

  if (isError) {
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search templates by name, slug, or subject..."
          isLoading={false}
          className="w-full max-w-md bg-background text-foreground border-input"
        />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message ||
              "Failed to load email templates. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsTableToolbar
        search={
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search templates by name, slug, or subject..."
            isLoading={isLoading}
            className="w-full bg-background text-foreground border-input"
          />
        }
        columns={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="md" className="bg-background">
                <Columns className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.name}
                  checked={!hiddenColumns.has(col.name)}
                  onCheckedChange={() => toggleColumn(col.name)}
                >
                  {typeof col.header === "string" ? col.header : col.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {isLoading && templates.length === 0 ? (
        <div className="rounded-none border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-none" />
        </div>
      ) : (
        <>
          <DataTableView<EmailTemplateRecord>
            columns={columns}
            rows={paginatedTemplates}
            loading={isLoading}
            onRowClick={template => handleEdit(template)}
            primaryColumn="name"
            rowActions={rowActions}
            registryKey="email-templates"
            ariaLabel="Email templates table"
            emptyMessage="No email templates found. Create a template to get started."
          />

          <Pagination
            currentPage={page}
            totalPages={Math.max(1, totalPages)}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            totalItems={totalItems}
            isLoading={isLoading}
          />
        </>
      )}

      <TemplateDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        template={templateToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      <TemplatePreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        template={templateToPreview}
      />
    </div>
  );
}

// ============================================================
// Page
// ============================================================

const EmailTemplatesPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <Button
              onClick={() => navigateTo(ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE)}
            >
              <Plus className="h-4 w-4" />
              Create Template
            </Button>
          }
        >
          <EmailTemplateTable />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default EmailTemplatesPage;
