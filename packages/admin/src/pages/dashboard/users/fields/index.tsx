"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@revnixhq/ui";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UserBreadcrumbs } from "@admin/components/features/user-management/breadcrumbs";
import {
  AlertTriangle,
  AlignLeft,
  Calendar,
  CheckSquare,
  Circle,
  Edit,
  Eye,
  GripVertical,
  Hash,
  List,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Type,
  Users,
  Columns,
  type LucideIcon,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  useDeleteUserField,
  useReorderUserFields,
  useUserFields,
} from "@admin/hooks/queries/useUserFields";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import { navigateTo } from "@admin/lib/navigation";
import type {
  UserFieldDefinitionRecord,
  UserFieldType,
} from "@admin/services/userFieldsApi";

// ============================================================
// Field Type Badge Config
// ============================================================

const FIELD_TYPE_CONFIG: Record<
  UserFieldType,
  {
    label: string;
    variant: "default" | "primary" | "success";
    icon: LucideIcon;
  }
> = {
  text: { label: "Text", variant: "default", icon: Type },
  textarea: { label: "Textarea", variant: "default", icon: AlignLeft },
  number: { label: "Number", variant: "primary", icon: Hash },
  email: { label: "Email", variant: "primary", icon: Mail },
  select: { label: "Select", variant: "success", icon: List },
  radio: { label: "Radio", variant: "success", icon: Circle },
  checkbox: { label: "Checkbox", variant: "default", icon: CheckSquare },
  date: { label: "Date", variant: "default", icon: Calendar },
};

// ============================================================
// Static User Fields (built-in, read-only)
// ============================================================

interface StaticField {
  name: string;
  label: string;
  type: UserFieldType;
  required: boolean;
}

const STATIC_USER_FIELDS: StaticField[] = [
  { name: "id", label: "ID", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "name", label: "Name", type: "text", required: false },
  { name: "image", label: "Image", type: "text", required: false },
  { name: "isActive", label: "Is Active", type: "checkbox", required: false },
  {
    name: "emailVerified",
    label: "Email Verified",
    type: "date",
    required: false,
  },
  { name: "createdAt", label: "Created At", type: "date", required: false },
  { name: "updatedAt", label: "Updated At", type: "date", required: false },
];

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

function FieldDeleteDialog({
  open,
  onOpenChange,
  field,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: { id: string; name: string; label: string } | null;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  if (!field) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-field-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Delete User Field?</DialogTitle>
          <DialogDescription id="delete-field-description">
            Are you sure you want to delete the field{" "}
            <strong>{field.label}</strong> (<code>{field.name}</code>)? This
            action cannot be undone.
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
// Static Field Row Component (read-only, non-draggable)
// ============================================================

function StaticFieldRow({ field }: { field: StaticField }) {
  const typeConfig = FIELD_TYPE_CONFIG[field.type];
  const TypeIcon = typeConfig.icon;

  return (
    <TableRow className="bg-primary/5 hover:bg-primary/5">
      {/* Lock icon + Name */}
      <TableCell className="whitespace-nowrap text-base">
        <div className="flex items-center gap-2">
          <span
            className="text-muted-foreground shrink-0"
            title="Built-in field (read-only)"
          >
            <Lock className="h-4 w-4" />
          </span>
          <code className="text-sm px-1.5 py-0.5 rounded-none font-mono">
            {field.name}
          </code>
        </div>
      </TableCell>

      {/* Label */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {field.label}
      </TableCell>

      {/* Type */}
      <TableCell className="whitespace-nowrap text-base">
        <Badge variant={typeConfig.variant} className="gap-1 shadow-none">
          <TypeIcon className="h-3 w-3" />
          {typeConfig.label}
        </Badge>
      </TableCell>

      {/* Required */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {field.required ? "Yes" : "No"}
      </TableCell>

      {/* Source */}
      <TableCell className="whitespace-nowrap text-base">
        <Badge variant="default" className="shadow-none">
          Built-in
        </Badge>
      </TableCell>

      {/* Status */}
      <TableCell className="whitespace-nowrap text-base">
        <Badge variant="success" className="shadow-none">
          Active
        </Badge>
      </TableCell>

      {/* Created */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground hidden lg:table-cell">
        —
      </TableCell>

      {/* Actions */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        —
      </TableCell>
    </TableRow>
  );
}

// ============================================================
// Sortable Row Component
// ============================================================

function SortableFieldRow({
  field,
  onEdit,
  onView,
  onDelete,
}: {
  field: UserFieldDefinitionRecord;
  onEdit: (field: UserFieldDefinitionRecord) => void;
  onView: (field: UserFieldDefinitionRecord) => void;
  onDelete: (field: UserFieldDefinitionRecord) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const typeConfig = FIELD_TYPE_CONFIG[field.type];
  const TypeIcon = typeConfig.icon;
  const isCode = field.source === "code";

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "hover-unified-table-row",
        isDragging && "bg-primary/5 opacity-80"
      )}
    >
      {/* Drag handle + Name */}
      <TableCell className="whitespace-nowrap text-base">
        <div className="flex items-center gap-2">
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
            {...attributes}
            {...listeners}
            tabIndex={0}
            aria-label="Drag to reorder"
            style={{ touchAction: "none" }}
          >
            <GripVertical className="h-4 w-4" />
          </span>
          <code
            className="text-sm bg-primary/5 px-1.5 py-0.5 rounded-none font-mono cursor-pointer hover-unified transition-colors"
            onClick={() => (isCode ? onView(field) : onEdit(field))}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (isCode) {
                  onView(field);
                } else {
                  onEdit(field);
                }
              }
            }}
          >
            {field.name}
          </code>
        </div>
      </TableCell>

      {/* Label */}
      <TableCell className="whitespace-nowrap text-sm">{field.label}</TableCell>

      {/* Type */}
      <TableCell className="whitespace-nowrap text-sm">
        <Badge variant={typeConfig.variant} className="gap-1 shadow-none">
          <TypeIcon className="h-3 w-3" />
          {typeConfig.label}
        </Badge>
      </TableCell>

      {/* Required */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {field.required ? "Yes" : "No"}
      </TableCell>

      {/* Source */}
      <TableCell className="whitespace-nowrap text-sm">
        {isCode ? (
          <Badge variant="default" className="shadow-none">
            Code
          </Badge>
        ) : (
          <Badge variant="primary" className="shadow-none">
            Custom
          </Badge>
        )}
      </TableCell>

      {/* Status */}
      <TableCell className="whitespace-nowrap text-sm">
        {field.isActive ? (
          <Badge variant="success" className="shadow-none">
            Active
          </Badge>
        ) : (
          <Badge variant="warning" className="shadow-none">
            Inactive
          </Badge>
        )}
      </TableCell>

      {/* Created */}
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground hidden lg:table-cell">
        {formatDate(field.createdAt)}
      </TableCell>

      {/* Actions */}
      <TableCell className="whitespace-nowrap text-sm">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {isCode ? (
              <DropdownMenuItem onClick={() => onView(field)}>
                <Eye className="h-4 w-4 mr-2" />
                View
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => onEdit(field)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(field)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ============================================================
// User Fields Table Component
// ============================================================

function UserFieldsTable() {
  // Pagination state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  // Search state
  const [search, setSearch] = useState("");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<{
    id: string;
    name: string;
    label: string;
  } | null>(null);

  // Restart banner state
  const [showRestartBanner, setShowRestartBanner] = useState(false);

  // Local reorder state (optimistic updates)
  const [localFields, setLocalFields] = useState<
    UserFieldDefinitionRecord[] | null
  >(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // Fetch fields
  const { data, isLoading, isError, error } = useUserFields();

  // Sync local fields with server data
  useEffect(() => {
    if (data?.fields) {
      setLocalFields(data.fields);
    }
  }, [data]);

  // Delete mutation
  const { mutate: doDelete, isPending: isDeleting } = useDeleteUserField();

  // Reorder mutation
  const { mutate: doReorder } = useReorderUserFields();

  // Client-side search filtering (static fields)
  const filteredStaticFields = useMemo(() => {
    if (!search.trim()) return STATIC_USER_FIELDS;
    const q = search.toLowerCase();
    return STATIC_USER_FIELDS.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q)
    );
  }, [search]);

  // Client-side search filtering (custom fields)
  const filteredFields = useMemo(() => {
    const fields = localFields || [];
    if (!search.trim()) return fields;
    const q = search.toLowerCase();
    return fields.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.label.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q)
    );
  }, [localFields, search]);

  // Client-side pagination
  const totalItems = filteredFields.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paginatedFields = useMemo(() => {
    const start = page * pageSize;
    return filteredFields.slice(start, start + pageSize);
  }, [filteredFields, page, pageSize]);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search]);

  // Action handlers
  const handleEdit = useCallback((field: UserFieldDefinitionRecord) => {
    navigateTo(buildRoute(ROUTES.USERS_FIELDS_EDIT, { id: field.id }));
  }, []);

  const handleView = useCallback((field: UserFieldDefinitionRecord) => {
    // For code-sourced fields, navigate to edit page (form will be read-only)
    navigateTo(buildRoute(ROUTES.USERS_FIELDS_EDIT, { id: field.id }));
  }, []);

  const handleDelete = useCallback((field: UserFieldDefinitionRecord) => {
    setFieldToDelete({ id: field.id, name: field.name, label: field.label });
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!fieldToDelete) return;
    doDelete(fieldToDelete.id, {
      onSuccess: () => {
        toast.success("Field deleted", {
          description: `${fieldToDelete.label} has been deleted.`,
        });
        setDeleteDialogOpen(false);
        setFieldToDelete(null);
        setShowRestartBanner(true);
      },
      onError: (err: Error) => {
        toast.error("Delete failed", {
          description: err.message || "Failed to delete the field.",
        });
      },
    });
  }, [fieldToDelete, doDelete]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fields = localFields || [];
      const oldIndex = fields.findIndex(f => f.id === active.id);
      const newIndex = fields.findIndex(f => f.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      // Optimistic reorder
      const reordered = arrayMove(fields, oldIndex, newIndex);
      setLocalFields(reordered);

      // Send reorder to API
      doReorder(
        reordered.map(f => f.id),
        {
          onError: () => {
            // Revert optimistic update on failure
            if (data?.fields) {
              setLocalFields(data.fields);
            }
            toast.error("Reorder failed", {
              description: "Failed to update field order. Please try again.",
            });
          },
        }
      );
    },
    [localFields, doReorder, data]
  );

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  }, []);

  // Error state
  if (isError) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 max-w-md w-full">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search fields by name or label..."
              isLoading={false}
              className="bg-background text-foreground border-primary/5"
            />
          </div>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load user fields. Please try again."}
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
          <div className="flex-1 max-w-md w-full">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search fields by name or label..."
              isLoading={true}
              className="bg-background text-foreground border-primary/5"
            />
          </div>
        </div>
        <TableSkeleton columns={8} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Restart banner */}
      {showRestartBanner && (
        <Alert>
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>Schema change detected</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              Restart the server (
              <code className="text-xs bg-primary/5 px-1 py-0.5 rounded-none">
                next dev
              </code>
              ) for new fields to take effect in the database.
            </span>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setShowRestartBanner(false)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Toolbar: Search + Action button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <div className="flex-1 max-w-md w-full">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search fields by name or label..."
              isLoading={isLoading}
              className="bg-background text-foreground border-primary/5"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="md" className="bg-background">
            <Columns className="mr-2 h-4 w-4" />
            Columns
          </Button>
        </div>
      </div>

      {/* Table with DnD */}
      {filteredStaticFields.length === 0 && paginatedFields.length === 0 ? (
        <div className="border rounded-none p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-none bg-primary/5 mx-auto mb-4">
            <Users className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium mb-1">
            No fields match your search
          </h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
            Try a different search term or clear the filter.
          </p>
        </div>
      ) : (
        <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table aria-label="User fields table">
              <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                <TableRow>
                  <TableHead className="w-[200px]">Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    Created
                  </TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              {/* Static fields (read-only, non-draggable) */}
              {filteredStaticFields.length > 0 && (
                <TableBody>
                  {filteredStaticFields.map(field => (
                    <StaticFieldRow key={field.name} field={field} />
                  ))}
                </TableBody>
              )}
              {/* Custom fields (draggable) */}
              <TableBody>
                <SortableContext
                  items={paginatedFields.map(f => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {paginatedFields.map(field => (
                    <SortableFieldRow
                      key={field.id}
                      field={field}
                      onEdit={handleEdit}
                      onView={handleView}
                      onDelete={handleDelete}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>

          {/* Pagination inside table wrapper - always show if table is shown */}
          {/* <div className="table-footer  border-t border-primary/5 bg-[hsl(var(--table-header-bg))] p-4"> */}
          <Pagination
            currentPage={page}
            totalPages={Math.max(1, totalPages)}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            totalItems={totalItems + filteredStaticFields.length}
          />
          {/* </div> */}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <FieldDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        field={fieldToDelete}
        onConfirm={handleConfirmDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}

// ============================================================
// Page Component
// ============================================================

const UserFieldsPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div>
          <div className="mb-6">
            <UserBreadcrumbs currentPage="fields" />
          </div>

          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                User Fields
              </h1>
              <p className="text-sm font-normal text-primary/50 mt-1">
                Manage custom attributes for user accounts
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={ROUTES.USERS_FIELDS_CREATE}>
                <Button size="md" className="flex items-center gap-1 shrink-0">
                  <Plus className="h-4 w-4" />
                  <span>Add Field</span>
                </Button>
              </Link>
            </div>
          </div>

          <UserFieldsTable />
        </div>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default UserFieldsPage;
