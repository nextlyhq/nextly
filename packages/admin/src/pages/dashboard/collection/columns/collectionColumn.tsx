import { createColumnHelper } from "@tanstack/react-table";

import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";

// Collection type definition
export interface Collection {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

interface ActionCallbacks {
  onEdit?: (collection: Collection) => void;
  onDelete?: (collection: Collection) => void;
  onView?: (collection: Collection) => void;
}

const columnHelper = createColumnHelper<Collection>();

export const createCollectionColumns = (callbacks?: ActionCallbacks) => [
  columnHelper.accessor("name", {
    header: "Name",
    enableSorting: true,
    cell: ({ row }) => {
      const collection = row.original;
      return (
        <div className="flex items-center gap-3">
          <div>
            <div className="font-medium">{collection.name}</div>
          </div>
        </div>
      );
    },
  }),

  columnHelper.accessor("description", {
    header: "Description",
    enableSorting: false,
    cell: ({ row }) => {
      const collection = row.original;
      return (
        <div className="max-w-[700px] line-clamp-2">
          {collection.description}
        </div>
      );
    },
  }),

  columnHelper.accessor("createdAt", {
    header: "Created",
    enableSorting: true,
    cell: ({ row }) => {
      const collection = row.original;
      const dateValue = collection.createdAt;
      if (!dateValue) return "N/A";
      return formatDateWithAdminTimezone(dateValue, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    },
  }),

  ...(callbacks && (callbacks.onEdit || callbacks.onDelete || callbacks.onView)
    ? [
        columnHelper.display({
          id: "actions",
          header: "Actions",
          cell: ({ row }) => (
            <ActionColumn item={row.original} callbacks={callbacks} />
          ),
        }),
      ]
    : []),
];

// For backward compatibility
export const collectionColumns = createCollectionColumns();
