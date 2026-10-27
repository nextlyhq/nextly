"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { TemplateAction } from "./useTemplateActions";

/** An email's or layout's actions menu; nothing when there is no action. */
export function TemplateActionsMenu({
  name,
  actions,
}: {
  name: string;
  actions: TemplateAction[];
}): JSX.Element | null {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Actions for ${name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(action => (
          <DropdownMenuItem
            key={action.id}
            onSelect={action.onSelect}
            className={cn(action.destructive && "text-destructive")}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
