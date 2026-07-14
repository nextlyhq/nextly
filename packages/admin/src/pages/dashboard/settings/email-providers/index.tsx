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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@nextlyhq/ui";
import React, { useState, useCallback, useMemo } from "react";

import { SettingsTableToolbar } from "@admin/components/features/settings";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import {
  AlertTriangle,
  Columns,
  Edit,
  Loader2,
  Plus,
  Send,
  Star,
  Trash2,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
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
// Provider type badge map
// ============================================================

const PROVIDER_TYPE_CONFIG: Record<
  EmailProviderRecord["type"],
  { label: string; variant: "default" | "primary" | "success" }
> = {
  smtp: { label: "SMTP", variant: "default" },
  resend: { label: "Resend", variant: "primary" },
  sendlayer: { label: "SendLayer", variant: "success" },
};

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

function formatDate(dateValue?: string): string {
  return formatDateWithAdminTimezone(
    dateValue,
    { year: "numeric", month: "short", day: "numeric" },
    "N/A"
  );
}

// ============================================================
// Delete Dialog
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
// Send-Test Dialog
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
              placeholder="you@nextly.local"
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
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
// Provider Table (unified DataTableView)
// ============================================================

const ALWAYS_VISIBLE = new Set(["name"]);

function EmailProviderTable() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
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
  const [providerToDelete, setProviderToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [providerToTest, setProviderToTest] = useState<{
    id: string;
    name: string;
    fromEmail: string;
  } | null>(null);

  const { data, isLoading, isError, error } = useEmailProviders({
    page,
    pageSize,
    search,
    type,
  });

  const { mutate: doDelete, isPending: isDeleting } = useDeleteEmailProvider();
  const { mutate: doSetDefault } = useSetDefaultProvider();
  const { mutate: doTest, isPending: isTesting } = useTestProvider();

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
        setDeleteDialogOpen(false);
        setProviderToDelete(null);
        const errorMessage = err.message || "Unknown error";
        if (!errorMessage.toLowerCase().includes("not found")) {
          toast.error("Delete failed", { description: errorMessage });
        } else {
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

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  const handleTypeChange = useCallback((newType: string) => {
    setType(newType);
    setPage(0);
  }, []);

  const allColumns = useMemo<NextlyColumn<EmailProviderRecord>[]>(
    () => [
      {
        name: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {!row.isActive && (
              <Badge variant="warning" className="text-xs">
                Inactive
              </Badge>
            )}
          </div>
        ),
      },
      {
        name: "type",
        header: "Type",
        cell: ({ row }) => {
          const config = PROVIDER_TYPE_CONFIG[row.type];
          return <Badge variant={config.variant}>{config.label}</Badge>;
        },
      },
      {
        name: "fromEmail",
        header: "From",
        cell: ({ row }) => (
          <div>
            {row.fromName && (
              <div className="text-sm font-medium">{row.fromName}</div>
            )}
            <div className="text-sm text-muted-foreground">{row.fromEmail}</div>
          </div>
        ),
      },
      {
        name: "configuration",
        header: "Configuration",
        hideOnMobile: true,
        cell: ({ row }) => (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded-none font-mono">
            {maskConfiguration(row.type, row.configuration)}
          </code>
        ),
      },
      {
        name: "isDefault",
        header: "Default",
        cell: ({ row }) =>
          row.isDefault ? (
            <div className="flex items-center gap-1.5">
              <Star className="h-4 w-4 fill-current text-foreground shrink-0" />
              <Badge variant="success">Default</Badge>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
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
    (provider: EmailProviderRecord): RowAction<EmailProviderRecord>[] => {
      const actions: RowAction<EmailProviderRecord>[] = [
        {
          id: "edit",
          label: "Edit",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => handleEdit(provider),
        },
      ];
      if (!provider.isDefault) {
        actions.push({
          id: "set-default",
          label: "Set Default",
          icon: <Star className="h-4 w-4" />,
          onSelect: () => handleSetDefault(provider),
        });
      }
      actions.push({
        id: "test",
        label: "Send Test",
        icon: <Send className="h-4 w-4" />,
        isDisabled: () => isTesting,
        onSelect: () => handleTest(provider),
      });
      actions.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onSelect: () => handleDelete(provider),
      });
      return actions;
    },
    [handleEdit, handleSetDefault, handleTest, handleDelete, isTesting]
  );

  if (isError) {
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search providers by name..."
          isLoading={false}
          className="w-full max-w-md bg-background text-foreground border-input"
        />
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

  const totalItems = data?.meta.total ?? 0;

  return (
    <div className="space-y-4">
      <SettingsTableToolbar
        search={
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search providers by name..."
            isLoading={isLoading}
            className="w-full bg-background text-foreground border-input"
          />
        }
        filters={
          <Select value={type} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-[130px] bg-background text-foreground border-border hover:bg-accent/10">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="smtp">SMTP</SelectItem>
              <SelectItem value="resend">Resend</SelectItem>
              <SelectItem value="sendlayer">SendLayer</SelectItem>
            </SelectContent>
          </Select>
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

      {isLoading && !data ? (
        <div className="rounded-none border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-none" />
        </div>
      ) : (
        <>
          <DataTableView<EmailProviderRecord>
            columns={columns}
            rows={data?.data ?? []}
            loading={isLoading}
            onRowClick={provider => handleEdit(provider)}
            primaryColumn="name"
            rowActions={rowActions}
            registryKey="email-providers"
            ariaLabel="Email providers table"
            emptyMessage="No email providers configured. Add a provider to start sending emails."
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
        </>
      )}

      <ProviderDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        provider={providerToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />

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
// Page
// ============================================================

const EmailProvidersPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <Link href={ROUTES.SETTINGS_EMAIL_PROVIDERS_CREATE}>
              <Button size="md" className="flex items-center gap-1">
                <Plus className="h-4 w-4" />
                <span>Add Provider</span>
              </Button>
            </Link>
          }
        >
          <EmailProviderTable />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default EmailProvidersPage;
