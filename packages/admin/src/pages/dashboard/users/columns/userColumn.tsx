import { Avatar, AvatarFallback, AvatarImage, Badge } from "@revnixhq/ui";
import { createColumnHelper } from "@tanstack/react-table";

import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
import { formatDateWithAdminTimezone } from "@admin/hooks/useAdminDateFormatter";
import type { UserApiResponse } from "@admin/types/user";

interface ActionCallbacks {
  onEdit?: (user: UserApiResponse) => void;
  onDelete?: (user: UserApiResponse) => void;
  onView?: (user: UserApiResponse) => void;
}

const columnHelper = createColumnHelper<UserApiResponse>();

export const createUserColumns = (callbacks?: ActionCallbacks) => [
  columnHelper.accessor("name", {
    header: "Name",
    enableSorting: true,
    cell: ({ row }) => {
      const user = row.original;
      const firstName = user.name.split(" ")[0];
      const alp = firstName.charAt(0).toUpperCase();
      return (
        <div className="flex items-center gap-3">
          <Avatar size="md">
            <AvatarImage src={user.image} alt={user.name} />
            <AvatarFallback>{alp}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{user.name}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
        </div>
      );
    },
  }),

  columnHelper.accessor("roles", {
    header: "Role",
    cell: ({ row }) => {
      const user = row.original;
      return (
        <div className="flex gap-2">
          {user.roles &&
            user.roles.map(n => (
              <Badge key={n.id} variant="destructive" className="capitalize">
                {n.name}
              </Badge>
            ))}
        </div>
      );
    },
  }),

  columnHelper.accessor("created", {
    header: "Created",
    enableSorting: true,
    cell: ({ row }) => {
      const user = row.original;
      const dateValue = user.createdAt;
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
export const userColumns = createUserColumns();
