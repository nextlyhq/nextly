"use client";

import type { Column } from "@revnixhq/ui";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ResponsiveTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableSkeleton,
} from "@revnixhq/ui";
import React, { useState, useCallback, useMemo } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import {
  Columns,
  Loader2,
  Plus,
  Star,
  Trash2,
  Edit,
  MoreHorizontal,
  Send,
  AlertTriangle,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailProviders,
  useDeleteEmailProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailProviderRecord } from "@admin/services/emailProviderApi";

// ============================================================
// Provider Type Badge Map
// ============================================================

const PROVIDER_TYPE_CONFIG: Record<
  EmailProviderRecord["type"],
  { label: string; variant: "default" | "primary" | "success" }
> = {
  smtp: { label: "SMTP", variant: "default" },
  resend: { label: "Resend", variant: "primary" },
  sendlayer: { label: "SendLayer", variant: "success" },
};

// ============================================================
// Helper: Mask Configuration
// ============================================================

function maskConfiguration(
  type: EmailProviderRecord["type"],
  config: Record<string, unknown>
): string {
  switch (type) {
    case "smtp": {
      const host = (config.host as string | undefined) ?? "unknown";
      const port = String((config.port as string | number | undefined) ?? "");
      return `${host}:${port}`;
    }
    case "resend":
    case "sendlayer": {
      const apiKey = config.apiKey as string | undefined;
      if (apiKey && apiKey.length > 8) {
        return `${apiKey.slice(0, 4)}${"*".repeat(8)}${apiKey.slice(-4)}`;
      }
      return "********";
    }
    default:
      return "—";
  }
}

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
// Delete Dialog Component
// ============================================================

function ProviderDeleteDialog({
  open,
  onOpenChange,
  provider,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: { id: string; name: string } | null;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  if (!provider) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-provider-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Delete Email Provider?</DialogTitle>
          <DialogDescription id="delete-provider-description">
            Are you sure you want to delete <strong>{provider.name}</strong>?
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
// Send-Test Dialog Component
// ============================================================

function ProviderTestDialog({
  open,
  onOpenChange,
  provider,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: { id: string; name: string; fromEmail: string } | null;
  onConfirm: (email: string) => void;
  isLoading: boolean;
}) {
  const [email, setEmail] = useState("");

  // Reset the field whenever the dialog opens
  React.useEffect(() => {
    if (open) setEmail("");
  }, [open]);

  if (!provider) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) onConfirm(email.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="test-provider-description"
      >
        <DialogHeader>
          <DialogTitle>Send Test Email</DialogTitle>
          <DialogDescription id="test-provider-description">
            Send a test email via <strong>{provider.name}</strong> to verify
            your configuration is correct.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="test-email" className="text-sm font-medium">
              Recipient Email
            </label>
            <Input
              id="test-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              The test email will be sent to this address.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !email.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Test
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Provider Table Component
// ============================================================

function EmailProviderTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state
  const [search, setSearch] = useState("");

  // Filter state
  const [type, setType] = useState<string>("all");

  // Column visibility state
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Test dialog state
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [providerToTest, setProviderToTest] = useState<{
    id: string;
    name: string;
    fromEmail: string;
  } | null>(null);

  // Fetch providers
  const { data, isLoading, isError, error } = useEmailProviders({
    page,
    pageSize,
    search,
    type,
  });

  // Delete mutation
  const { mutate: doDelete, isPending: isDeleting } = useDeleteEmailProvider();

  // Set default mutation
  const { mutate: doSetDefault } = useSetDefaultProvider();

  // Test mutation
  const { mutate: doTest, isPending: isTesting } = useTestProvider();

  // Action handlers
  const handleEdit = useCallback((provider: EmailProviderRecord) => {
    navigateTo(
      buildRoute(ROUTES.SETTINGS_EMAIL_PROVIDERS_EDIT, { id: provider.id })
    );
  }, []);

  const handleDelete = useCallback((provider: EmailProviderRecord) => {
    setProviderToDelete({ id: provider.id, name: provider.name });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!providerToDelete) return;
    doDelete(providerToDelete.id, {
      onSuccess: () => {
        toast.success("Provider deleted", {
          description: `${providerToDelete.name} has been deleted.`,
        });
        setDeleteDialogOpen(false);
        setProviderToDelete(null);
      },
      onError: (err: Error) => {
        // Close dialog even on error as provider might already be deleted
        setDeleteDialogOpen(false);
        setProviderToDelete(null);

        // Only show error if it's not a "not found" error (already deleted)
        const errorMessage = err.message || "Unknown error";
        if (!errorMessage.toLowerCase().includes("not found")) {
          toast.error("Delete failed", {
            description: errorMessage,
          });
        } else {
          // Provider was already deleted, show success instead
          toast.success("Provider deleted", {
            description: `${providerToDelete.name} has been deleted.`,
          });
        }
      },
    });
  }, [providerToDelete, doDelete]);

  const handleSetDefault = useCallback(
    (provider: EmailProviderRecord) => {
      doSetDefault(provider.id, {
        onSuccess: () => {
          toast.success("Default provider updated");
        },
        onError: (err: Error) => {
          toast.error("Failed to set default", {
            description:
              err.message || "Could not update the default provider.",
          });
        },
      });
    },
    [doSetDefault]
  );

  // Open the test dialog — actual send happens in handleConfirmTest
  const handleTest = useCallback((provider: EmailProviderRecord) => {
    setProviderToTest({
      id: provider.id,
      name: provider.name,
      fromEmail: provider.fromEmail,
    });
    setTestDialogOpen(true);
  }, []);

  const handleConfirmTest = useCallback(
    (email: string) => {
      if (!providerToTest) return;
      doTest(
        { id: providerToTest.id, email },
        {
          onSuccess: result => {
            if (result.success) {
              toast.success("Test email sent", {
                description: `Check ${email} for the test email.`,
              });
            } else {
              toast.error("Test failed", {
                description: result.error || "Provider returned unsuccessful.",
              });
            }
            setTestDialogOpen(false);
            setProviderToTest(null);
          },
          onError: (err: Error) => {
            toast.error("Test failed", {
              description: err.message || "Failed to send a test email.",
            });
          },
        }
      );
    },
    [providerToTest, doTest]
  );

  // Page size change handler
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const handleTypeChange = useCallback((newType: string) => {
    setType(newType);
    setPage(0);
  }, []);

  // Table columns
  const ALWAYS_VISIBLE = new Set(["id"]);

  const columnDefs = useMemo<Column<EmailProviderRecord>[]>(
    () => [
      {
        key: "name",
        label: "Name",
        render: (_value, provider) => (
          <div className="flex items-center gap-2">
            <span
              className="font-medium cursor-pointer hover-unified"
              onClick={() => handleEdit(provider)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleEdit(provider);
                }
              }}
            >
              {provider.name}
            </span>
            {!provider.isActive && (
              <Badge variant="warning" className="text-xs">
                Inactive
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: "type",
        label: "Type",
        render: (_value, provider) => {
          const config = PROVIDER_TYPE_CONFIG[provider.type];
          return <Badge variant={config.variant}>{config.label}</Badge>;
        },
      },
      {
        key: "fromEmail",
        label: "From",
        render: (_value, provider) => (
          <div>
            {provider.fromName && (
              <div className="text-sm font-medium">{provider.fromName}</div>
            )}
            <div className="text-sm text-muted-foreground">
              {provider.fromEmail}
            </div>
          </div>
        ),
      },
      {
        key: "configuration",
        label: "Configuration",
        hideOnMobile: true,
        render: (_value, provider) => (
          <code className="text-xs bg-primary/5 px-1.5 py-0.5 rounded-none font-mono">
            {maskConfiguration(provider.type, provider.configuration)}
          </code>
        ),
      },
      {
        key: "isDefault",
        label: "Default",
        render: (_value, provider) =>
          provider.isDefault ? (
            <div className="flex items-center gap-1.5">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500 shrink-0" />
              <Badge variant="success">Default</Badge>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
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
        render: (_value, provider) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0  border border-primary/5"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => handleEdit(provider)}
              >
                <Edit className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              {!provider.isDefault && (
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => handleSetDefault(provider)}
                >
                  <Star className="h-4 w-4" />
                  Set Default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => handleTest(provider)}
                disabled={isTesting}
              >
                <Send className="h-4 w-4" />
                Send Test
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={() => handleDelete(provider)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [handleEdit, handleSetDefault, handleTest, handleDelete, isTesting]
  );

  const columns = useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  // Error state
  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search providers by name..."
              isLoading={false}
              className="flex-1 max-w-sm bg-white text-black border-primary/5"
            />
          </div>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load email providers. Please try again."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Loading state (initial load only)
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search providers by name..."
              isLoading={true}
              className="flex-1 max-w-sm bg-white text-black border-primary/5"
            />
          </div>
        </div>
        <TableSkeleton columns={7} />
      </div>
    );
  }

  const totalItems = data?.meta.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search providers by name..."
            isLoading={isLoading}
            className="flex-1 max-w-sm bg-white text-black border-primary/5"
          />
        </div>

        {/* Right: Filters & Column visibility */}
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-[130px] bg-white text-black border-primary/5 hover:bg-white/90">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="smtp">SMTP</SelectItem>
              <SelectItem value="resend">Resend</SelectItem>
              <SelectItem value="sendlayer">SendLayer</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="md">
                <Columns className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map(col => (
                <DropdownMenuCheckboxItem
                  key={String(col.key)}
                  checked={!hiddenColumns.has(String(col.key))}
                  onCheckedChange={() => toggleColumn(String(col.key))}
                >
                  {typeof col.label === "string" ? col.label : String(col.key)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
        <ResponsiveTable
          data={data?.data || []}
          columns={columns}
          emptyMessage="No email providers configured. Add a provider to start sending emails."
          ariaLabel="Email providers table"
          tableWrapperClassName="border-0 rounded-none shadow-none"
        />
        {data && data.meta.totalPages > 0 && (
          <Pagination
            currentPage={page}
            totalPages={data.meta.totalPages}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            isLoading={isLoading}
            totalItems={totalItems}
          />
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ProviderDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        provider={providerToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

      {/* Send test email dialog */}
      <ProviderTestDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        provider={providerToTest}
        onConfirm={handleConfirmTest}
        isLoading={isTesting}
      />
    </div>
  );
}

// ============================================================
// Page Component
// ============================================================

const EmailProvidersPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <div className="flex items-center gap-3">
              <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE}>
                <Button size="md" className="flex items-center gap-1">
                  <Plus className="h-4 w-4" />
                  <span>Add Provider</span>
                </Button>
              </Link>
            </div>
          }
        >
          {/* Email provider table */}
          <EmailProviderTable />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default EmailProvidersPage;
