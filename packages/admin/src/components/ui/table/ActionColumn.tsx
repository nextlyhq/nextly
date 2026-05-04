import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@revnixhq/ui";

import { MoreHorizontal, Edit, Trash2, Eye } from "@admin/components/icons";

interface ActionCallbacks<TData = unknown> {
  onEdit?: (item: TData) => void;
  onDelete?: (item: TData) => void;
  onView?: (item: TData) => void;
}

interface ActionColumnProps<TData> {
  item: TData;
  callbacks?: ActionCallbacks<TData>;
}

export function ActionColumn<TData>({
  item,
  callbacks,
}: ActionColumnProps<TData>) {
  const { onEdit, onDelete, onView } = callbacks || {};

  if (!onEdit && !onDelete && !onView) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {onView && (
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={e => {
              e.stopPropagation();
              onView(item);
            }}
          >
            <Eye className="h-4 w-4" />
            View
          </DropdownMenuItem>
        )}

        {onEdit && (
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={e => {
              e.stopPropagation();
              onEdit(item);
            }}
          >
            <Edit className="h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}

        {onDelete && (
          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:text-destructive"
            onClick={e => {
              e.stopPropagation();
              onDelete(item);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
