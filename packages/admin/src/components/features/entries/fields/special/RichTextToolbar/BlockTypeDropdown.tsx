/**
 * Block Type Dropdown Component
 *
 * Dropdown selector for block types (paragraph, headings, lists, etc.)
 * in the rich text editor toolbar.
 *
 * @module components/entries/fields/special/RichTextToolbar/BlockTypeDropdown
 * @since 1.0.0
 */

import type { HeadingTagType } from "@lexical/rich-text";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import {
  CheckSquare,
  ChevronDown,
  Code2,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
} from "@admin/components/icons";

// ============================================================
// Constants
// ============================================================

export const BLOCK_TYPE_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    feature?: string;
  }
> = {
  paragraph: { label: "Paragraph", icon: Pilcrow },
  h2: { label: "Heading 2", icon: Heading2, feature: "h2" },
  h3: { label: "Heading 3", icon: Heading3, feature: "h3" },
  h4: { label: "Heading 4", icon: Heading4, feature: "h4" },
  h5: { label: "Heading 5", icon: Heading5, feature: "h5" },
  h6: { label: "Heading 6", icon: Heading6, feature: "h6" },
  ul: { label: "Bullet List", icon: List, feature: "unorderedList" },
  ol: { label: "Numbered List", icon: ListOrdered, feature: "orderedList" },
  check: { label: "Checklist", icon: CheckSquare, feature: "checklist" },
  quote: { label: "Blockquote", icon: Quote, feature: "blockquote" },
  code: { label: "Code Block", icon: Code2, feature: "codeBlock" },
};

// ============================================================
// Types
// ============================================================

export interface BlockTypeDropdownProps {
  blockType: string;
  disabled: boolean;
  hasFeature: (feature: string) => boolean;
  formatHeading: (type: HeadingTagType) => void;
  formatList: (type: "bullet" | "number" | "check") => void;
  formatQuote: () => void;
  formatCodeBlock: () => void;
  formatParagraph: () => void;
}

// ============================================================
// Component
// ============================================================

export function BlockTypeDropdown({
  blockType,
  disabled,
  hasFeature,
  formatHeading,
  formatList,
  formatQuote,
  formatCodeBlock,
  formatParagraph,
}: BlockTypeDropdownProps) {
  const currentConfig =
    BLOCK_TYPE_CONFIG[blockType] || BLOCK_TYPE_CONFIG.paragraph;
  const CurrentIcon = currentConfig.icon;

  const handleSelect = (type: string) => {
    switch (type) {
      case "paragraph":
        formatParagraph();
        break;
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        formatHeading(type);
        break;
      case "ul":
        formatList("bullet");
        break;
      case "ol":
        formatList("number");
        break;
      case "check":
        formatList("check");
        break;
      case "quote":
        formatQuote();
        break;
      case "code":
        formatCodeBlock();
        break;
    }
  };

  const items = Object.entries(BLOCK_TYPE_CONFIG).filter(
    ([, config]) => !config.feature || hasFeature(config.feature)
  );

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="h-8 gap-1 px-2 text-xs"
          disabled={disabled}
        >
          <CurrentIcon className="h-4 w-4" />
          <span className="max-w-[100px] truncate">{currentConfig.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {items.map(([type, config]) => {
          const Icon = config.icon;
          return (
            <DropdownMenuItem
              key={type}
              className="gap-2"
              onSelect={() => handleSelect(type)}
            >
              <Icon className="h-4 w-4" />
              <span>{config.label}</span>
              {blockType === type && (
                <span className="ml-auto text-xs text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
