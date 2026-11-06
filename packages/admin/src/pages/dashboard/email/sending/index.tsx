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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@nextlyhq/ui";
import type React from "react";
import { useState, useCallback, useMemo } from "react";

import { EmailHubLayout } from "@admin/components/features/email-hub/EmailHubLayout";
import { SendingOverview } from "@admin/components/features/email-hub/sending/SendingOverview";
import { SendTestDialog } from "@admin/components/features/email-hub/sending/SendTestDialog";
import { emailCatalogState } from "@admin/components/features/settings/EmailProviderForm";
import { clearSelectionValue } from "@admin/components/features/settings/EmailProviderForm/ProviderConfigFields";
import {
  AlertTriangle,
  Edit,
  Loader2,
  Plus,
  Send,
  Star,
  Trash2,
} from "@admin/components/icons";
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
import {
  EMAIL_PROVIDER_CREATE_PERMISSIONS,
  EMAIL_PROVIDER_DELETE_PERMISSIONS,
  EMAIL_PROVIDER_TEST_PERMISSIONS,
  EMAIL_PROVIDER_UPDATE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { PAGINATION } from "@admin/constants/pagination";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailProviders,
  useEmailProviderTypes,
  useDeleteEmailProvider,
  useSetDefaultProvider,
} from "@admin/hooks/queries/useEmailProviders";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
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
// Provider Table (unified DataTableView)
// ============================================================

const ALWAYS_VISIBLE = new Set(["name"]);

/**
 * Why the catalog can't be trusted, with a retry: unavailable when there is
 * nothing in hand, stale when a refresh failed over the list already loaded.
 */
function CatalogNotice({
  catalog,
  onRetry,
  retrying,
}: {
  catalog: ReturnType<typeof emailCatalogState>;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (catalog !== "unavailable" && catalog !== "stale") return null;
  const retry = (
    <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
      {retrying ? "Retrying..." : "Retry"}
    </Button>
  );
  if (catalog === "unavailable") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Provider catalog unavailable</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>
            Provider types could not be loaded, so this page cannot tell which
            of these are still installed. Each row falls back to its stored
            type, and the type filter has nothing to offer.
          </span>
          {retry}
        </AlertDescription>
      </Alert>
    );
  }
  // A refresh that did not land, over descriptors already in hand. The
  // sentence above would be untrue here in every particular: the rows are
  // named from the cache, the filter is built from it, and nothing has been
  // withheld. Said without the destructive styling, because the page is
  // working and this is the one thing that is not.
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>
          Provider types could not be refreshed, so this page is using the list
          it loaded with. A type installed or removed since then may not be
          reflected.
        </span>
        {retry}
      </AlertDescription>
    </Alert>
  );
}

/** What the list failed with, or null while it hasn't. */
function listError(isError: boolean, error: unknown): string | null {
  if (!isError) return null;
  return error instanceof Error
    ? error.message
    : "Failed to load email providers. Please try again.";
}

/** The pager, for a response that reports any pages at all. */
function providerPagination(
  meta: { totalPages: number; total: number } | undefined,
  state: {
    page: number;
    pageSize: number;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
    isLoading: boolean;
  }
) {
  if (!meta || meta.totalPages <= 0) return undefined;
  return {
    currentPage: state.page,
    totalPages: meta.totalPages,
    pageSize: state.pageSize,
    pageSizeOptions: PAGINATION.TABLE_PAGE_SIZE_OPTIONS,
    onPageChange: state.setPage,
    onPageSizeChange: state.setPageSize,
    isLoading: state.isLoading,
    totalItems: meta.total,
  };
}

/** Whether a provider can be made the default: installed, on, and not already. */
function promotable(
  provider: EmailProviderRecord,
  installed: boolean
): boolean {
  return installed && provider.isActive && !provider.isDefault;
}

/** The actions a row offers, each only with the grant the server checks. */
function providerActions(
  provider: EmailProviderRecord,
  can: { update: boolean; test: boolean; delete: boolean },
  typeIsKnownMissing: (type: string) => boolean,
  on: {
    edit: (provider: EmailProviderRecord) => void;
    setDefault: (provider: EmailProviderRecord) => void;
    test: (provider: EmailProviderRecord) => void;
    delete: (provider: EmailProviderRecord) => void;
  }
): RowAction<EmailProviderRecord>[] {
  const installed = !typeIsKnownMissing(provider.type);
  const actions: Array<RowAction<EmailProviderRecord> | false> = [
    can.update && {
      id: "edit",
      label: "Edit",
      icon: <Edit className="h-4 w-4" />,
      onSelect: () => on.edit(provider),
    },
    // Not offered for a stored provider whose plugin is gone. Promoting one
    // points every unrouted message at a type nothing can build an adapter
    // for, AND clears the working default on the way — so the damage outlives
    // the click. Nor for one that is off, which the service refuses to make
    // the default. The service refuses both; this is the affordance, not the
    // rule.
    can.update &&
      promotable(provider, installed) && {
        id: "set-default",
        label: "Set Default",
        icon: <Star className="h-4 w-4" />,
        onSelect: () => on.setDefault(provider),
      },
    // Same gate as Set Default. `testProvider` reaches the registry for the
    // stored type and can only fail for one that is gone, and the read-only
    // fallback exists so an orphaned row can be INSPECTED and deleted --
    // offering an action that cannot succeed contradicts that.
    can.test &&
      installed && {
        id: "test",
        label: "Send a test",
        icon: <Send className="h-4 w-4" />,
        onSelect: () => on.test(provider),
      },
    can.delete && {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      onSelect: () => on.delete(provider),
    },
  ];
  return actions.filter(
    (action): action is RowAction<EmailProviderRecord> => action !== false
  );
}

function ProviderNameCell({ row }: { row: EmailProviderRecord }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{row.name}</span>
      {/* Off sends nothing: a new provider stays off until its test is
          accepted or someone turns it on. */}
      {!row.isActive && (
        <Badge variant="warning" className="text-xs">
          Off
        </Badge>
      )}
    </div>
  );
}

function ProviderFromCell({ row }: { row: EmailProviderRecord }) {
  return (
    <div>
      {row.fromName && (
        <div className="text-sm font-medium">{row.fromName}</div>
      )}
      <div className="text-sm text-muted-foreground">{row.fromEmail}</div>
    </div>
  );
}

function ProviderDefaultCell({ row }: { row: EmailProviderRecord }) {
  if (!row.isDefault) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <Star className="h-4 w-4 fill-current text-foreground shrink-0" />
      <Badge variant="success">Default</Badge>
    </div>
  );
}

/** The type's label from the catalog, or the stored type when it has none. */
function typeLabel(
  descriptorsByType: Map<string, EmailProviderDescriptor>,
  type: string
): string {
  return descriptorsByType.get(type)?.label ?? type;
}

/**
 * The table's columns. The type badge and the configuration summary read
 * from the catalog, so these are rebuilt when it arrives.
 */
function providerColumns(
  descriptorsByType: Map<string, EmailProviderDescriptor>
): NextlyColumn<EmailProviderRecord>[] {
  return [
    {
      name: "name",
      header: "Name",
      cell: ({ row }) => <ProviderNameCell row={row} />,
    },
    {
      name: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={PROVIDER_BADGE_VARIANTS.get(row.type) ?? "default"}>
          {/* The registry's label when it has one; otherwise the stored
              type, so a provider whose plugin was removed still says what it
              is instead of rendering blank. */}
          {typeLabel(descriptorsByType, row.type)}
        </Badge>
      ),
    },
    {
      name: "fromEmail",
      header: "From",
      cell: ({ row }) => <ProviderFromCell row={row} />,
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
      cell: ({ row }) => <ProviderDefaultCell row={row} />,
    },
    {
      name: "createdAt",
      header: "Created",
      hideOnMobile: true,
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.createdAt)}</span>
      ),
    },
  ];
}

/**
 * The registry catalog, which names and describes each type. Without it the
 * table could only label the providers this admin was compiled against.
 */
function useProviderCatalog() {
  const {
    data: descriptorList,
    isError,
    isLoading,
    refetch,
    isFetching,
  } = useEmailProviderTypes();
  const descriptors = useMemo(() => descriptorList ?? [], [descriptorList]);
  // A failed request means two different things here, and the page owes a
  // different sentence to each. Asked of the same function the form asks, so
  // an operator moving between the table and the form is not told the catalog
  // is unusable on one and merely stale on the other.
  const catalog = emailCatalogState({
    loading: isLoading,
    failed: isError,
    descriptors,
  });
  const descriptorsByType = useMemo(
    () => new Map(descriptors.map(entry => [entry.type, entry])),
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

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    descriptors,
    catalog,
    descriptorsByType,
    typeIsKnownMissing,
    retry,
    retrying: isFetching,
  };
}

/**
 * The type filter. `undefined` is "no filter". A hardcoded sentinel would have
 * to be a string no provider may register, and no such string exists -- a
 * plugin is entitled to the type `"all"`, and then choosing it would be
 * indistinguishable from clearing the filter. The Select's own sentinel is
 * derived from the catalog for the reason the configuration select derives
 * its own, and never reaches the request.
 */
function TypeFilter({
  descriptors,
  value,
  onChange,
}: {
  descriptors: EmailProviderDescriptor[];
  value: string | undefined;
  onChange: (type: string | undefined) => void;
}) {
  const allTypesValue = useMemo(
    () =>
      clearSelectionValue(descriptors.map(entry => ({ value: entry.type }))),
    [descriptors]
  );
  return (
    <Select
      value={value ?? allTypesValue}
      onValueChange={next =>
        onChange(next === allTypesValue ? undefined : next)
      }
    >
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
  );
}

/**
 * Said after a delete the server refused. A provider already gone is what the
 * person asked for, so it is reported as deleted.
 */
function reportDeleteError(error: Error, name: string) {
  const errorMessage = error.message || "Unknown error";
  if (errorMessage.toLowerCase().includes("not found")) {
    toast.success("Provider deleted", {
      description: `${name} has been deleted.`,
    });
    return;
  }
  toast.error("Delete failed", { description: errorMessage });
}

/** Deleting a provider, behind a confirmation. */
function useProviderDelete() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { mutate: doDelete, isPending } = useDeleteEmailProvider();

  const ask = useCallback((row: EmailProviderRecord) => {
    setProvider({ id: row.id, name: row.name });
    setOpen(true);
  }, []);

  const confirm = useCallback(() => {
    if (!provider) return;
    const close = () => {
      setOpen(false);
      setProvider(null);
    };
    doDelete(provider.id, {
      onSuccess: () => {
        toast.success("Provider deleted", {
          description: `${provider.name} has been deleted.`,
        });
        close();
      },
      onError: (err: Error) => {
        close();
        reportDeleteError(err, provider.name);
      },
    });
  }, [provider, doDelete]);

  return { open, setOpen, provider, ask, confirm, isPending };
}

/** Making a provider the default, said in a toast either way. */
function useMakeDefault() {
  const { mutate: doSetDefault } = useSetDefaultProvider();
  return useCallback(
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
}

/** Sending a test from a row, in the shared dialog. */
function useRowTest() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EmailProviderRecord | null>(null);
  const ask = useCallback((row: EmailProviderRecord) => {
    setProvider(row);
    setOpen(true);
  }, []);
  return { open, setOpen, provider, ask };
}

/** The row test's dialog, named by the tested provider's type. */
function RowTestDialog({
  rowTest,
  descriptorsByType,
}: {
  rowTest: ReturnType<typeof useRowTest>;
  descriptorsByType: Map<string, EmailProviderDescriptor>;
}) {
  const tested = rowTest.provider;
  return (
    <SendTestDialog
      open={rowTest.open}
      onOpenChange={rowTest.setOpen}
      provider={tested}
      providerName={tested?.name ?? ""}
      providerLabel={typeLabel(descriptorsByType, tested?.type ?? "")}
    />
  );
}

function editProvider(provider: EmailProviderRecord) {
  navigateTo(buildRoute(ROUTES.EMAIL_SENDING_EDIT, { id: provider.id }));
}

function EmailProviderTable(): React.JSX.Element {
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, error } = useEmailProviders({
    page,
    pageSize,
    search,
    type,
  });
  const {
    descriptors,
    catalog,
    descriptorsByType,
    typeIsKnownMissing,
    retry,
    retrying,
  } = useProviderCatalog();

  // Each action shows only with the grant the server checks for it, so a
  // reader who may only look sees the list without actions they'd be refused.
  const { hasPermission } = useCurrentUserPermissions();
  const canUpdate = holdsAny(hasPermission, EMAIL_PROVIDER_UPDATE_PERMISSIONS);
  const canTest = holdsAny(hasPermission, EMAIL_PROVIDER_TEST_PERMISSIONS);
  const canDelete = holdsAny(hasPermission, EMAIL_PROVIDER_DELETE_PERMISSIONS);

  const deletion = useProviderDelete();
  const makeDefault = useMakeDefault();
  const rowTest = useRowTest();

  // Rebuilt when the catalog arrives: the type badge and the configuration
  // summary both read from it.
  const allColumns = useMemo(
    () => providerColumns(descriptorsByType),
    [descriptorsByType]
  );

  // Resolves persisted column visibility while ensuring pinned provider names remain visible.
  const { columns, columnsControl } = useTableColumns({
    storageKey: "email-providers",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  const askDelete = deletion.ask;
  const askTest = rowTest.ask;
  const rowActions = useCallback(
    (provider: EmailProviderRecord) =>
      providerActions(
        provider,
        { update: canUpdate, test: canTest, delete: canDelete },
        typeIsKnownMissing,
        {
          edit: editProvider,
          setDefault: makeDefault,
          test: askTest,
          delete: askDelete,
        }
      ),
    [
      canUpdate,
      canTest,
      canDelete,
      makeDefault,
      askTest,
      askDelete,
      // Read to decide whether Set Default is offered, so the actions have to
      // be rebuilt when the catalog arrives — otherwise the action stays
      // hidden for every row until something else invalidates them.
      typeIsKnownMissing,
    ]
  );

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
        <TypeFilter
          descriptors={descriptors}
          value={type}
          onChange={next => {
            setType(next);
            resetPage();
          }}
        />
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
      error={listError(isError, error)}
      slots={{
        beforeList: (
          <CatalogNotice
            catalog={catalog}
            onRetry={retry}
            retrying={retrying}
          />
        ),
        afterList: (
          <>
            <ProviderDeleteDialog
              open={deletion.open}
              onOpenChange={deletion.setOpen}
              provider={deletion.provider}
              onConfirm={deletion.confirm}
              isLoading={deletion.isPending}
            />

            <RowTestDialog
              rowTest={rowTest}
              descriptorsByType={descriptorsByType}
            />
          </>
        ),
      }}
      columns={columns}
      rows={data?.data ?? []}
      onRowClick={canUpdate ? editProvider : undefined}
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
      pagination={providerPagination(data?.meta, {
        page,
        pageSize,
        setPage,
        setPageSize,
        isLoading,
      })}
    />
  );
}

// ============================================================
// Page
// ============================================================

/**
 * Sending: the providers email goes out through, as the hub's tab. Adding a
 * provider shows only with the grant the server checks for it.
 */
const EmailProvidersPage: React.FC = () => {
  const { hasPermission } = useCurrentUserPermissions();
  const canCreate = holdsAny(hasPermission, EMAIL_PROVIDER_CREATE_PERMISSIONS);
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <EmailHubLayout
        tab="sending"
        actions={
          canCreate ? (
            <Link href={ROUTES.EMAIL_SENDING_CREATE}>
              <Button size="md" className="flex items-center gap-1">
                <Plus className="h-4 w-4" />
                <span>Add Provider</span>
              </Button>
            </Link>
          ) : undefined
        }
      >
        <div className="space-y-6">
          <SendingOverview />
          <section aria-labelledby="providers-heading" className="space-y-2">
            <h2 id="providers-heading" className="text-base font-semibold">
              Providers
            </h2>
            <EmailProviderTable />
          </section>
        </div>
      </EmailHubLayout>
    </QueryErrorBoundary>
  );
};

export default EmailProvidersPage;

// The table alone, so its behaviour can be exercised without the page's
// boundary, layout and router around it.
export { EmailProviderTable };
