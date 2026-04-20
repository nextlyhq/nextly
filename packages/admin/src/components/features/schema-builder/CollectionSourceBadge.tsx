// Small badge that indicates whether a collection is defined in code
// (nextly.config.ts) or in the UI (Schema Builder). Shown next to collection
// names in list views and on builder pages so users know which source
// they are operating on.
//
// Task 11 context: collections have an exclusive source. Code-owned means
// the Schema Builder can view but not edit fields; UI-owned means fields
// are fully editable via Schema Builder. See Sub-task 7 for the
// conflict-detection and promote/demote commands.
"use client";

import { Badge } from "@revnixhq/ui";
import { Code2, LayoutPanelLeft } from "lucide-react";

import { cn } from "../../../lib/utils";

export type CollectionSource = "code" | "ui";

interface CollectionSourceBadgeProps {
  source: CollectionSource;
  className?: string;
  // When true, only show the icon (no label). Useful in dense lists.
  iconOnly?: boolean;
}

export function CollectionSourceBadge({
  source,
  className,
  iconOnly = false,
}: CollectionSourceBadgeProps) {
  const Icon = source === "code" ? Code2 : LayoutPanelLeft;
  const label = source === "code" ? "Code" : "UI";

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 px-1.5 py-0 h-5 text-[10px] font-medium uppercase tracking-wider",
        source === "code"
          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300"
          : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300",
        className
      )}
      title={
        source === "code"
          ? "This collection is defined in nextly.config.ts. Edit fields by updating the code."
          : "This collection is managed via the Schema Builder."
      }
    >
      <Icon className="h-2.5 w-2.5" />
      {!iconOnly && label}
    </Badge>
  );
}
