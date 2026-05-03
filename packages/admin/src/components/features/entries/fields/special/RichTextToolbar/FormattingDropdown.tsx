/**
 * Formatting Dropdown Component
 *
 * Dropdown for additional text formatting options (strikethrough, inline code,
 * highlight, horizontal rule) in the rich text editor toolbar.
 *
 * @module components/entries/fields/special/RichTextToolbar/FormattingDropdown
 * @since 1.0.0
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import type { TextFormatType } from "lexical";

import {
  ALargeSmall,
  ChevronDown,
  Code,
  Highlighter,
  SeparatorHorizontal,
  Strikethrough,
} from "@admin/components/icons";

// ============================================================
// Types
// ============================================================

export interface FormattingDropdownProps {
  disabled: boolean;
  hasFeature: (feature: string) => boolean;
  isStrikethrough: boolean;
  isCode: boolean;
  isHighlight: boolean;
  formatText: (format: TextFormatType) => void;
  insertHorizontalRule: () => void;
}

// ============================================================
// Component
// ============================================================

export function FormattingDropdown({
  disabled,
  hasFeature,
  isStrikethrough,
  isCode,
  isHighlight,
  formatText,
  insertHorizontalRule,
}: FormattingDropdownProps) {
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
              <ALargeSmall className="h-4 w-4" />
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom">More Formatting</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {hasFeature("strikethrough") && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => formatText("strikethrough")}
          >
            <Strikethrough className="h-4 w-4" />
            <span>Strikethrough</span>
            {isStrikethrough && (
              <span className="ml-auto text-xs text-muted-foreground">✓</span>
            )}
          </DropdownMenuItem>
        )}
        {hasFeature("code") && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => formatText("code")}
          >
            <Code className="h-4 w-4" />
            <span>Inline Code</span>
            {isCode && (
              <span className="ml-auto text-xs text-muted-foreground">✓</span>
            )}
          </DropdownMenuItem>
        )}
        {hasFeature("highlight") && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => formatText("highlight")}
          >
            <Highlighter className="h-4 w-4" />
            <span>Highlight</span>
            {isHighlight && (
              <span className="ml-auto text-xs text-muted-foreground">✓</span>
            )}
          </DropdownMenuItem>
        )}
        {hasFeature("horizontalRule") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={insertHorizontalRule}>
              <SeparatorHorizontal className="h-4 w-4" />
              <span>Horizontal Rule</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
