/**
 * Toolbar Button Component
 *
 * A reusable button with tooltip for the rich text editor toolbar.
 *
 * @module components/entries/fields/special/RichTextToolbar/ToolbarButton
 * @since 1.0.0
 */

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@revnixhq/ui";

import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  tooltip: string;
  shortcut?: string;
  children: React.ReactNode;
  className?: string;
}

// ============================================================
// Component
// ============================================================

export function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  tooltip,
  shortcut,
  children,
  className,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            isActive && "bg-accent text-accent-foreground",
            className
          )}
          onClick={onClick}
          disabled={disabled}
          aria-pressed={isActive}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>{tooltip}</span>
        {shortcut && (
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded-none  border border-primary/5 bg-primary/5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
