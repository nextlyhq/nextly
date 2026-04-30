/**
 * Slash Command Plugin
 *
 * A Lexical plugin that provides a slash command menu for quick block insertion.
 * Type "/" at the start of a line or after a space to open the menu.
 * Uses Lexical's built-in TypeaheadMenuPlugin for consistent styling and behavior.
 *
 * @module components/entries/fields/special/SlashCommandPlugin
 * @since 1.2.0
 */

import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $getSelection,
  $isRangeSelection,
  type TextNode,
  type LexicalEditor,
} from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  CheckSquare,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  Quote,
  Code2,
  Image,
  Video,
  Table,
  SeparatorHorizontal,
  MousePointerClick,
  ChevronDownSquare,
  Columns,
  GalleryHorizontalEnd,
  type LucideIcon,
} from "@admin/components/icons";

import { OPEN_BUTTON_GROUP_DIALOG_COMMAND } from "./RichTextButtonGroupPlugin";
import { OPEN_BUTTON_LINK_DIALOG_COMMAND } from "./RichTextButtonLinkPlugin";
import { INSERT_COLLAPSIBLE_COMMAND } from "./RichTextCollapsiblePlugin";
import { OPEN_GALLERY_DIALOG_COMMAND } from "./RichTextGalleryPlugin";
import { OPEN_IMAGE_DIALOG_COMMAND } from "./RichTextMediaPlugin";
import { OPEN_TABLE_DIALOG_COMMAND } from "./RichTextTablePlugin";
import { OPEN_VIDEO_DIALOG_COMMAND } from "./RichTextVideoPlugin";

// ============================================================
// Types
// ============================================================

export interface SlashCommandPluginProps {
  disabled?: boolean;
}

// ============================================================
// Command Option Class (extends MenuOption)
// ============================================================

class SlashCommandOption extends MenuOption {
  label: string;
  IconComponent: LucideIcon;
  keywords: string[];
  onSelect: (editor: LexicalEditor) => void;

  constructor(
    label: string,
    options: {
      icon: LucideIcon;
      keywords: string[];
      onSelect: (editor: LexicalEditor) => void;
    }
  ) {
    super(label);
    this.label = label;
    this.IconComponent = options.icon;
    this.keywords = options.keywords;
    this.onSelect = options.onSelect;
  }
}

// ============================================================
// Command Options Factory
// ============================================================

function getSlashCommandOptions(editor: LexicalEditor): SlashCommandOption[] {
  return [
    // Headings
    new SlashCommandOption("Heading 2", {
      icon: Heading2,
      keywords: ["h2", "heading", "title", "large"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h2"));
          }
        });
      },
    }),
    new SlashCommandOption("Heading 3", {
      icon: Heading3,
      keywords: ["h3", "heading", "title", "medium"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h3"));
          }
        });
      },
    }),
    new SlashCommandOption("Heading 4", {
      icon: Heading4,
      keywords: ["h4", "heading", "title", "small"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createHeadingNode("h4"));
          }
        });
      },
    }),
    // Lists
    new SlashCommandOption("Bullet List", {
      icon: List,
      keywords: ["ul", "unordered", "bullet", "list"],
      onSelect: () => {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Numbered List", {
      icon: ListOrdered,
      keywords: ["ol", "ordered", "number", "list"],
      onSelect: () => {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Checklist", {
      icon: CheckSquare,
      keywords: ["checklist", "check", "todo", "task", "checkbox"],
      onSelect: () => {
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      },
    }),
    // Blocks
    new SlashCommandOption("Quote", {
      icon: Quote,
      keywords: ["blockquote", "quote", "citation"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode());
          }
        });
      },
    }),
    new SlashCommandOption("Code Block", {
      icon: Code2,
      keywords: ["code", "pre", "snippet", "programming"],
      onSelect: () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createCodeNode());
          }
        });
      },
    }),
    new SlashCommandOption("Divider", {
      icon: SeparatorHorizontal,
      keywords: ["hr", "horizontal", "line", "divider", "separator"],
      onSelect: () => {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
      },
    }),
    // Media
    new SlashCommandOption("Image", {
      icon: Image,
      keywords: ["image", "picture", "photo", "img"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_IMAGE_DIALOG_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Video", {
      icon: Video,
      keywords: ["video", "youtube", "vimeo", "embed"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_VIDEO_DIALOG_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Gallery", {
      icon: GalleryHorizontalEnd,
      keywords: ["gallery", "images", "photos", "grid"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_GALLERY_DIALOG_COMMAND, undefined);
      },
    }),
    // Interactive
    new SlashCommandOption("Table", {
      icon: Table,
      keywords: ["table", "grid", "spreadsheet"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_TABLE_DIALOG_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Collapsible", {
      icon: ChevronDownSquare,
      keywords: ["collapsible", "accordion", "toggle", "expandable"],
      onSelect: () => {
        editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Button Link", {
      icon: MousePointerClick,
      keywords: ["button", "cta", "call to action", "link"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_BUTTON_LINK_DIALOG_COMMAND, undefined);
      },
    }),
    new SlashCommandOption("Button Group", {
      icon: Columns,
      keywords: ["buttons", "group", "cta", "actions"],
      onSelect: () => {
        editor.dispatchCommand(OPEN_BUTTON_GROUP_DIALOG_COMMAND, undefined);
      },
    }),
  ];
}

// ============================================================
// Menu Styles (inline to avoid CSS scoping issues with portals)
// ============================================================

const menuContainerStyle: React.CSSProperties = {
  minWidth: "220px",
  maxHeight: "300px",
  overflowY: "auto",
  overflowX: "hidden",
  borderRadius: "8px",
  border: "1px solid #e2e8f0",
  backgroundColor: "#ffffff",
  padding: "4px",
  boxShadow:
    "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
  zIndex: 9999,
};

const menuListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const getMenuItemStyle = (isSelected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  margin: 0,
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  color: "#1e293b",
  backgroundColor: isSelected ? "#f1f5f9" : "transparent",
  transition: "background-color 0.15s ease",
  whiteSpace: "nowrap",
});

const iconStyle: React.CSSProperties = {
  width: "16px",
  height: "16px",
  flexShrink: 0,
  color: "#64748b",
};

const textStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// ============================================================
// Menu Item Component
// ============================================================

function SlashCommandMenuItem({
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: {
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  option: SlashCommandOption;
}) {
  const Icon = option.IconComponent;

  return (
    <li
      key={option.key}
      tabIndex={-1}
      ref={el => {
        option.setRefElement(el);
      }}
      role="option"
      aria-selected={isSelected}
      id={`typeahead-item-${index}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={getMenuItemStyle(isSelected)}
    >
      <Icon style={iconStyle} />
      <span style={textStyle}>{option.label}</span>
    </li>
  );
}

// ============================================================
// Plugin Component
// ============================================================

export function SlashCommandPlugin({
  disabled = false,
}: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  // Check for "/" trigger
  const checkForSlashTrigger = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  });

  // Get all options
  const allOptions = useMemo(() => getSlashCommandOptions(editor), [editor]);

  // Filter options based on query
  const options = useMemo(() => {
    if (!queryString) return allOptions;
    const lowerQuery = queryString.toLowerCase();
    return allOptions.filter(
      option =>
        option.label.toLowerCase().includes(lowerQuery) ||
        option.keywords.some(kw => kw.includes(lowerQuery))
    );
  }, [allOptions, queryString]);

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void
    ) => {
      editor.update(() => {
        if (nodeToRemove) {
          nodeToRemove.remove();
        }
        selectedOption.onSelect(editor);
      });
      closeMenu();
    },
    [editor]
  );

  const checkForMatch = useCallback(
    (text: string) => {
      const match = checkForSlashTrigger(text, editor);
      return match;
    },
    [checkForSlashTrigger, editor]
  );

  if (disabled) return null;

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (!anchorElementRef.current || options.length === 0) {
          return null;
        }

        return createPortal(
          <div style={menuContainerStyle}>
            <ul style={menuListStyle}>
              {options.map((option, index) => (
                <SlashCommandMenuItem
                  key={option.key}
                  index={index}
                  isSelected={selectedIndex === index}
                  onClick={() => {
                    setHighlightedIndex(index);
                    selectOptionAndCleanUp(option);
                  }}
                  onMouseEnter={() => {
                    setHighlightedIndex(index);
                  }}
                  option={option}
                />
              ))}
            </ul>
          </div>,
          anchorElementRef.current
        );
      }}
    />
  );
}
