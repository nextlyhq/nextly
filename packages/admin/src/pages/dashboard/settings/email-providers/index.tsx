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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@nextlyhq/ui";
import React, { useState, useCallback, useMemo } from "react";

import { emailCatalogState } from "@admin/components/features/settings/EmailProviderForm";
import { clearSelectionValue } from "@admin/components/features/settings/EmailProviderForm/ProviderConfigFields";
import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import {
  AlertTriangle,
  Edit,
  Loader2,
  Plus,
  Send,
  Star,
  Trash2,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import {
  ListView,
  useTableColumns,
} from "@admin/components/ui/table/list-view";
import { PAGINATION } from "@admin/constants/pagination";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailProviders,
  useEmailProviderTypes,
  useDeleteEmailProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { usePagination } from "@admin/hooks/usePagination";
import { navigateTo } from "@admin/lib/navigation";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

// ============================================================
// Provider type badge map
// ============================================================

/**
 * Badge colours for the providers this admin ships artwork and copy for.
 *
 * Only the colour is looked up here — the LABEL comes from the descriptor, so a
 * contributed provider is named correctly and merely renders in the neutral
 * variant. A missing entry is the normal case for a plugin provider, never an
 * error, which is what the old hardcoded map made it.
 */
/**
 * A `Map` rather than an object literal, because the key is a plugin-chosen
 * provider type. `variants["constructor"]` on a plain object answers with an
 * inherited function, which is truthy, so the `?? "default"` fallback beside
 * the lookup would never run and `Badge` would receive a function as its
 * variant. A `Map` has no inherited keys to find.
 */
const PROVIDER_BADGE_VARIANTS = new Map<
  string,
  "default" | "primary" | "success"
>([
  ["smtp", "default"],
  ["resend", "primary"],
  ["sendlayer", "success"],
]);

/**
 * A one-line summary of a provider's configuration for the table.
 *
 * Built from the descriptor's non-secret fields in declaration order, so it
 * works for a provider this admin has never heard of and can never print a
 * credential: a secret field is returned masked by the server, and is skipped
 * here regardless.
 */
function summariseConfiguration(
  descriptor: EmailProviderDescriptor | undefined,
  config: Record<string, unknown>
): string {
  if (!descriptor) return "—";

  const parts: string[] = [];
  for (const field of descriptor.configFields) {
    if (field.secret === true) continue;
    const value = field.name
      .split(".")
      .reduce<unknown>(
        (current, segment) =>
          current !== null && typeof current === "object"
            ? (current as Record<string, unknown>)[segment]
            : undefined,
        config
      );
    // Only primitives are summarised. A nested object under a declared path
    // means the descriptor and the stored shape disagree, and printing
    // "[object Object]" in the table is worse than printing nothing.
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    if (value === "") continue;
    parts.push(String(value));
    if (parts.length === 2) break;
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
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
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();
  const [search, setSearch] = useState("");
  // `undefined` is "no filter". A hardcoded sentinel would have to be a string
  // no provider may register, and no such string exists -- a plugin is entitled
  // to the type `"all"`, and then choosing it would be indistinguishable from
  // clearing the filter. The sentinel below exists only for the Select, which
  // cannot hold an empty value, and never reaches the request.
  const [type, setType] = useState<string | undefined>(undefined);

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

  // The registry catalog names and describes each type. Without it the table
  // could only label the providers this admin was compiled against.
  const {
    data: descriptorList,
    isError: isCatalogError,
    isLoading: isCatalogLoading,
    refetch: refetchCatalog,
    isFetching: isCatalogFetching,
  } = useEmailProviderTypes();
  const descriptors = useMemo(() => descriptorList ?? [], [descriptorList]);
  // A failed request means two different things here, and the page owes a
  // different sentence to each. Asked of the same function the form asks, so
  // an operator moving between the table and the form is not told the catalog
  // is unusable on one and merely stale on the other.
  const catalog = emailCatalogState({
    loading: isCatalogLoading,
    failed: isCatalogError,
    descriptors,
  });
  const descriptorsByType = useMemo(
    () => new Map(descriptors.map(entry => [entry.type, entry])),
    [descriptors]
  );
  // Derived from the catalog rather than fixed, for the reason the
  // configuration select derives its own: any literal chosen here is a value
  // some provider is entitled to register.
  const allTypesValue = useMemo(
    () =>
      clearSelectionValue(descriptors.map(entry => ({ value: entry.type }))),
    [descriptors]
  );

  /**
   * Whether this type is known to have no provider behind it.
   *
   * An empty catalog is produced by a type that is genuinely gone AND by a
   * catalog that failed or has not arrived, and only the first is a reason to
   * withhold an action. Answering "unregistered" from an unanswered request
   * takes Set Default and Send Test away from every working provider on the
   * page, silently and with nothing to retry.
   *
   * The question is whether descriptors are in HAND, not whether the last
   * request succeeded. A refresh that fails over a cache keeps every
   * descriptor, so the cache can still say the type is gone — reading the
   * request's own status instead reports every type as present the moment a
   * refresh fails, and hands both actions back to a provider whose plugin has
   * been removed.
   */
  const typeIsKnownMissing = useCallback(
    (providerType: string) =>
      (catalog === "ready" || catalog === "stale") &&
      !descriptorsByType.has(providerType),
    [catalog, descriptorsByType]
  );

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

  const handleTypeChange = useCallback(
    (newType: string) => {
      setType(newType === allTypesValue ? undefined : newType);
      resetPage();
    },
    [allTypesValue, resetPage]
  );

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
          const descriptor = descriptorsByType.get(row.type);
          return (
            <Badge variant={PROVIDER_BADGE_VARIANTS.get(row.type) ?? "default"}>
              {/* The registry's label when it has one; otherwise the stored
                  type, so a provider whose plugin was removed still says what
                  it is instead of rendering blank. */}
              {descriptor?.label ?? row.type}
            </Badge>
          );
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
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded-sm font-mono">
            {summariseConfiguration(
              descriptorsByType.get(row.type),
              row.configuration
            )}
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
    // Rebuilt when the catalog arrives: the type badge and the configuration
    // summary both read from it.
    [descriptorsByType]
  );

  const { columns, columnsControl } = useTableColumns({
    storageKey: "email-providers",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

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
      // Not offered for a stored provider whose plugin is gone. Promoting one
      // points every unrouted message at a type nothing can build an adapter
      // for, AND clears the working default on the way — so the damage outlives
      // the click. The service refuses it too; this is the affordance, not the
      // rule.
      if (!provider.isDefault && !typeIsKnownMissing(provider.type)) {
        actions.push({
          id: "set-default",
          label: "Set Default",
          icon: <Star className="h-4 w-4" />,
          onSelect: () => handleSetDefault(provider),
        });
      }
      // Same gate as Set Default. `testProvider` reaches the registry for the
      // stored type and can only fail for one that is gone, and the read-only
      // fallback exists so an orphaned row can be INSPECTED and deleted --
      // offering an action that cannot succeed contradicts that.
      if (!typeIsKnownMissing(provider.type)) {
        actions.push({
          id: "test",
          label: "Send Test",
          icon: <Send className="h-4 w-4" />,
          isDisabled: () => isTesting,
          onSelect: () => handleTest(provider),
        });
      }
      actions.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        onSelect: () => handleDelete(provider),
      });
      return actions;
    },
    [
      handleEdit,
      handleSetDefault,
      handleTest,
      handleDelete,
      isTesting,
      // Read to decide whether Set Default is offered, so the actions have to
      // be rebuilt when the catalog arrives — otherwise the action stays
      // hidden for every row until something else invalidates them.
      typeIsKnownMissing,
    ]
  );

  const totalItems = data?.meta.total ?? 0;

  return (
    <ListView<EmailProviderRecord>
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Search providers by name...",
        isLoading,
      }}
      // A visible control rather than the filter dropdown: the current type is
      // what a reader checks before trusting the list, so hiding it behind a
      // click costs more than the row space it saves.
      inlineFilters={
        <Select value={type ?? allTypesValue} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[130px] bg-background text-foreground hover:bg-accent/10">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={allTypesValue}>All Types</SelectItem>
            {/* One entry per registered provider, so the filter can reach a
                    contributed provider that is genuinely in the table. */}
            {descriptors.map(descriptor => (
              <SelectItem key={descriptor.type} value={descriptor.type}>
                {descriptor.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      columnsControl={columnsControl}
      // Loading and failure are TABLE states, so the toolbar stays mounted and
      // the reader keeps the search field they just typed in.
      loading={isLoading && !data}
      skeleton={
        <div className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-50 w-full rounded-lg" />
        </div>
      }
      error={
        isError
          ? error instanceof Error
            ? error.message
            : "Failed to load email providers. Please try again."
          : null
      }
      slots={{
        beforeList: (
          <>
            {catalog === "unavailable" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Provider catalog unavailable</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>
                    Provider types could not be loaded, so this page cannot tell
                    which of these are still installed. Each row falls back to
                    its stored type, and the type filter has nothing to offer.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void refetchCatalog();
                    }}
                    disabled={isCatalogFetching}
                  >
                    {isCatalogFetching ? "Retrying..." : "Retry"}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {/* A refresh that did not land, over descriptors already in hand. The
              sentence above would be untrue here in every particular: the rows are
              named from the cache, the filter is built from it, and nothing has
              been withheld. Said without the destructive styling, because the page
              is working and this is the one thing that is not. */}
            {catalog === "stale" && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>
                    Provider types could not be refreshed, so this page is using
                    the list it loaded with. A type installed or removed since
                    then may not be reflected.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void refetchCatalog();
                    }}
                    disabled={isCatalogFetching}
                  >
                    {isCatalogFetching ? "Retrying..." : "Retry"}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </>
        ),
        afterList: (
          <>
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
          </>
        ),
      }}
      columns={columns}
      rows={data?.data ?? []}
      onRowClick={provider => handleEdit(provider)}
      primaryColumn="name"
      rowActions={rowActions}
      registryKey="email-providers"
      ariaLabel="Email providers table"
      emptyMessage="No email providers configured. Add a provider to start sending emails."
      // The table owns the pager, so it is placed for whichever view is
      // showing. The gate hides it only when a response reports no pages
      // at all -- an empty list. A single-page list still shows it,
      // deliberately: the page-size selector lives there, and it is the
      // control that gets a longer list onto one screen.
      pagination={
        data && data.meta.totalPages > 0
          ? {
              currentPage: page,
              totalPages: data.meta.totalPages,
              pageSize,
              pageSizeOptions: PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
              isLoading,
              totalItems,
            }
          : undefined
      }
    />
  );
}

// ============================================================
// Page
// ============================================================

const EmailProvidersPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="wide">
        <SettingsLayout
          title="Email Providers"
          description="Configure your SMTP and email delivery services"
          crumb="Email Providers"
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

// The table alone, so its behaviour can be exercised without the page's
// boundary, layout and router around it.
export { EmailProviderTable };
