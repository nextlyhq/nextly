/**
 * Restricted Reference
 *
 * A link the editor cannot see: a related item or a media item they may not
 * read, or one that no longer exists. The two are shown the same way because
 * the server answers them the same way. The editor sees that the link is
 * there and keeps it when saving, can remove it, and cannot open it.
 *
 * @module components/entries/fields/RestrictedReference
 */

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { EyeOff, X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/** What a placeholder says in place of the item. */
export const RESTRICTED_REFERENCE_LABEL = "Restricted or missing item";

export interface RestrictedReferenceProps {
  /** The stored id of the linked item. */
  id: string;
  /** Removes the link from the field. */
  onRemove: () => void;
  /** Whether the field is read-only or disabled. */
  disabled?: boolean;
  /** A row in a relationship list, or a tile in an upload grid. */
  variant?: "row" | "tile";
  className?: string;
}

export function RestrictedReference({
  id,
  onRemove,
  disabled = false,
  variant = "row",
  className,
}: RestrictedReferenceProps): JSX.Element {
  const remove = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onRemove}
      disabled={disabled}
      className={cn(
        "h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive",
        variant === "tile" && "absolute right-1 top-1"
      )}
      aria-label={`Remove ${RESTRICTED_REFERENCE_LABEL.toLowerCase()} ${id}`}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );

  return (
    <div
      role="group"
      aria-label={`${RESTRICTED_REFERENCE_LABEL} ${id}`}
      className={cn(
        "rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground",
        variant === "row"
          ? "flex items-center justify-between gap-2 p-2"
          : "relative flex aspect-square flex-col items-center justify-center gap-1 p-3 text-center",
        disabled && "opacity-60",
        className
      )}
    >
      <div
        className={cn(
          "flex min-w-0 gap-2",
          variant === "row" ? "flex-1 items-center" : "flex-col items-center"
        )}
      >
        <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{RESTRICTED_REFERENCE_LABEL}</p>
          <p
            className={cn(
              "font-mono text-xs",
              variant === "row" ? "truncate" : "break-all"
            )}
          >
            {id}
          </p>
        </div>
      </div>
      {remove}
    </div>
  );
}
