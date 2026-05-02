"use client";

import type { Column } from "@revnixhq/ui";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResponsiveTable,
  Skeleton,
  TableSkeleton,
} from "@revnixhq/ui";
import type React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit,
  Eye,
  Loader2,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailTemplates,
  useEmailLayout,
  useDeleteEmailTemplate,
  useUpdateEmailLayout,
  usePreviewEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

// Built-in template slugs that cannot be deleted
const BUILT_IN_SLUGS = new Set([
  "welcome",
  "password-reset",
  "email-verification",
]);
// ============================================================
// Helper: Format Date
// ============================================================

function formatDate(dateValue?: string): string {
  return formatDateWithAdminTimezone(
    dateValue,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
    "N/A"
  );
}

// ============================================================
// Email Layout Section Component
// ============================================================

function EmailLayoutSection() {
  const [expanded, setExpanded] = useState(false);
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data: layout, isLoading } = useEmailLayout({
    enabled: expanded && !loaded,
  });
  const { mutate: doUpdateLayout, isPending: isSaving } =
    useUpdateEmailLayout();

  // Sync fetched layout data into local state
  useEffect(() => {
    if (layout && !loaded) {
      setHeader(layout.header);
      setFooter(layout.footer);
      setLoaded(true);
    }
  }, [layout, loaded]);

  const handleSave = useCallback(() => {
    doUpdateLayout(
      { header, footer },
      {
        onSuccess: () => toast.success("Email layout saved"),
        onError: err =>
          toast.error("Failed to save layout", {
            description: err instanceof Error ? err.message : "Unknown error",
          }),
      }
    );
  }, [header, footer, doUpdateLayout]);

  return (
    <Card className="mb-6 border-border shadow-none">
      <button
        type="button"
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded(prev => !prev)}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-4 pt-4 px-5">
          <div className="space-y-1 group">
            <CardTitle className="text-base font-semibold group-hover-unified">
              Email Layout Framework
            </CardTitle>
            <CardDescription className="text-sm">
              Global Header/Footer wrapped around all individual email
              templates. Ideal for consistent branding and footers.
            </CardDescription>
          </div>
          {expanded ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200" />
          ) : (
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200" />
          )}
        </CardHeader>
      </button>

      {expanded && (
        <>
          <CardContent className="pt-0 pb-6 px-5 border-t border-border">
            {isLoading && !loaded ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <Skeleton className="h-[200px] w-full rounded-none" />
                <Skeleton className="h-[200px] w-full rounded-none" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="layout-header"
                      className="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Global Header (HTML)
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Prepended automatically to every email. Variables supported:
                    `{"{{variable}}"}`.
                  </p>
                  <textarea
                    id="layout-header"
                    value={header}
                    onChange={e => setHeader(e.target.value)}
                    rows={8}
                    className="flex min-h-[200px] w-full rounded-none border border-input bg-background/50 px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="<div style='padding: 24px; text-align: center;'><!-- Header HTML --></div>"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="layout-footer"
                      className="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Global Footer (HTML)
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Appended automatically to every email. Variables supported:
                    `{"{{variable}}"}`.
                  </p>
                  <textarea
                    id="layout-footer"
                    value={footer}
                    onChange={e => setFooter(e.target.value)}
                    rows={8}
                    className="flex min-h-[200px] w-full rounded-none border border-input bg-background/50 px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="<div style='padding: 24px; text-align: center; color: #6t6666;'><!-- Footer HTML --></div>"
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="px-5 py-4 border-t border-border bg-primary/5 flex justify-end rounded-none">
            <Button
              onClick={handleSave}
              disabled={isSaving || (isLoading && !loaded)}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving Configuration...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}

// ============================================================
// Delete Dialog Component
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
// Preview Dialog Component
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
      {
        id: template.id,
        sampleData: {
          name: "John Doe",
          email: "john@example.com",
          url: "https://example.com",
          token: "sample-token-123",
          siteName: "My App",
        },
      },
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
        <div className="flex-1 overflow-auto border rounded-none">
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
// Template Table Component
// ============================================================

function EmailTemplateTable() {
  // Fetch all templates via query hook
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useEmailTemplates();

  // Mutations
  const { mutate: doDelete, isPending: isDeleting } = useDeleteEmailTemplate();

  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state
  const [search, setSearch] = useState("");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [templateToPreview, setTemplateToPreview] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Client-side filtered + paginated data
  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const term = search.toLowerCase();
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

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search]);

  // Action handlers
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
        // Close dialog even on error as template might already be deleted
        setDeleteDialogOpen(false);
        setTemplateToDelete(null);

        // Only show error if it's not a "not found" error (already deleted)
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        if (!errorMessage.toLowerCase().includes("not found")) {
          toast.error("Delete failed", {
            description: errorMessage,
          });
        } else {
          // Template was already deleted, show success instead
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
    // Navigate to create page with template ID as query parameter
    navigateTo(
      `${ROUTES.SETTINGS_EMAIL_TEMPLATES_CREATE}?duplicate=${template.id}`
    );
  }, []);

  // Page size change handler
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  // Table columns
  const columns: Column<EmailTemplateRecord>[] = [
    {
      key: "name",
      label: "Name",
      render: (_value, template) => (
        <div className="flex items-center gap-2">
          <span
            className="font-medium cursor-pointer hover-unified"
            onClick={() => handleEdit(template)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleEdit(template);
              }
            }}
          >
            {template.name}
          </span>
          {BUILT_IN_SLUGS.has(template.slug) && (
            <Badge variant="outline">Built-in</Badge>
          )}
        </div>
      ),
    },
    {
      key: "slug",
      label: "Slug",
      hideOnMobile: true,
      render: slug => (
        <code className="text-xs bg-primary/5 px-1.5 py-0.5 rounded-none font-mono">
          {slug as string}
        </code>
      ),
    },
    {
      key: "subject",
      label: "Subject",
      render: subject => (
        <span className="text-sm truncate max-w-[200px] block">
          {subject as string}
        </span>
      ),
    },
    {
      key: "providerId",
      label: "Provider",
      hideOnMobile: true,
      render: providerId => (
        <Badge variant={providerId ? "primary" : "default"}>
          {providerId ? "Custom" : "Default"}
        </Badge>
      ),
    },
    {
      key: "isActive",
      label: "Status",
      hideOnMobile: true,
      render: (_value, template) => (
        <div className="flex gap-1.5">
          {template.isActive ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warning">Inactive</Badge>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      label: "Created",
      hideOnMobile: true,
      render: createdAt => (
        <span className="text-sm">{formatDate(createdAt as string)}</span>
      ),
    },
    {
      key: "id",
      label: "Actions",
      render: (_value, template) => {
        const isBuiltIn = BUILT_IN_SLUGS.has(template.slug);

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0 border border-border"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => handleEdit(template)}
              >
                <Edit className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => handlePreview(template)}
              >
                <Eye className="h-4 w-4" />
                Preview
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => { void handleDuplicate(template); }}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              {!isBuiltIn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onClick={() => handleDelete(template)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  // Error state
  if (isError) {
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search templates by name, slug, or subject..."
          isLoading={false}
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

  // Loading state (initial load only)
  if (isLoading && templates.length === 0) {
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search templates by name, slug, or subject..."
          isLoading={true}
        />
        <TableSkeleton columns={7} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search toolbar */}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search templates by name, slug, or subject..."
        isLoading={isLoading}
      />

      {/* Table */}
      <div className="table-wrapper rounded-none border border-border bg-card overflow-hidden">
        <ResponsiveTable
          data={paginatedTemplates}
          columns={columns}
          emptyMessage="No email templates found. Add a template to get started."
          ariaLabel="Email templates table"
          tableWrapperClassName="border-0 rounded-none shadow-none"
        />
        {totalPages > 0 && (
          <div className="table-footer border-t border-border p-4">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50]}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              isLoading={isLoading}
              totalItems={totalItems}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <TemplateDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        template={templateToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Preview dialog */}
      <TemplatePreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        template={templateToPreview}
      />
    </div>
  );
}

// ============================================================
// Page Component
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
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          }
        >
          {" "}
          <div className="space-y-6">
            {/* Email Layout section */}
            <EmailLayoutSection />

            {/* Template table */}
            <EmailTemplateTable />
          </div>
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default EmailTemplatesPage;
