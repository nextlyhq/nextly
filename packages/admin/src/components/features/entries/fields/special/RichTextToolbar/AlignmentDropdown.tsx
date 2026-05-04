/**
 * Alignment Dropdown Component
 *
 * Dropdown selector for text alignment options in the rich text editor toolbar.
 *
 * @module components/entries/fields/special/RichTextToolbar/AlignmentDropdown
 * @since 1.0.0
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import type { ElementFormatType } from "lexical";

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronDown,
} from "@admin/components/icons";

// ============================================================
// Constants
// ============================================================

export const ALIGNMENT_OPTIONS: {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "left", label: "Align Left", icon: AlignLeft },
  { value: "center", label: "Align Center", icon: AlignCenter },
  { value: "right", label: "Align Right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
];

// ============================================================
// Types
// ============================================================

export interface AlignmentDropdownProps {
  elementFormat: string;
  disabled: boolean;
  formatAlignment: (alignment: ElementFormatType) => void;
}

// ============================================================
// Component
// ============================================================

export function AlignmentDropdown({
  elementFormat,
  disabled,
  formatAlignment,
}: AlignmentDropdownProps) {
  const currentAlignment =
    ALIGNMENT_OPTIONS.find(
      opt =>
        opt.value === elementFormat ||
        (opt.value === "left" &&
          (elementFormat === "" || elementFormat === "start"))
    ) || ALIGNMENT_OPTIONS[0];
  const CurrentIcon = currentAlignment.icon;

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="h-8 gap-0.5 px-1.5"
              disabled={disabled}
            >
              <CurrentIcon className="h-4 w-4" />
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">{currentAlignment.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {ALIGNMENT_OPTIONS.map(opt => {
          const Icon = opt.icon;
          const isActive =
            opt.value === elementFormat ||
            (opt.value === "left" &&
              (elementFormat === "" || elementFormat === "start"));
          return (
            <DropdownMenuItem
              key={opt.value}
              className="gap-2"
              onSelect={() => formatAlignment(opt.value as ElementFormatType)}
            >
              <Icon className="h-4 w-4" />
              <span>{opt.label}</span>
              {isActive && (
                <span className="ml-auto text-xs text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
