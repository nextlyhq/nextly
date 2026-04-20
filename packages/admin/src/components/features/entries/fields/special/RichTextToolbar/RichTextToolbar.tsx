/**
 * Rich Text Toolbar Component
 *
 * A toolbar for the Lexical rich text editor providing formatting controls.
 * Features active state tracking for visual feedback and tooltips with keyboard shortcuts.
 *
 * Must be rendered inside a LexicalComposer to access the editor context.
 *
 * @module components/entries/fields/special/RichTextToolbar
 * @since 1.0.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@revnixhq/ui";
import { UNDO_COMMAND, REDO_COMMAND } from "lexical";

import {
  ALargeSmall,
  Baseline,
  Bold,
  Italic,
  Paintbrush,
  Redo,
  RemoveFormatting,
  Type,
  Underline,
  Undo,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { AlignmentDropdown } from "./AlignmentDropdown";
import { BlockTypeDropdown } from "./BlockTypeDropdown";
import { FormattingDropdown } from "./FormattingDropdown";
import { InsertDropdown } from "./InsertDropdown";
import { ToolbarButton } from "./ToolbarButton";
import { useToolbarState } from "./useToolbarState";

// ============================================================
// Constants
// ============================================================

const FONT_FAMILY_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial" },
  { label: "Courier New", value: "Courier New" },
  { label: "Georgia", value: "Georgia" },
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Trebuchet MS", value: "Trebuchet MS" },
  { label: "Verdana", value: "Verdana" },
];

const FONT_SIZE_OPTIONS = [
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "20px",
  "24px",
  "30px",
  "36px",
  "48px",
  "60px",
  "72px",
];

// ============================================================
// Types
// ============================================================

export interface RichTextToolbarProps {
  /**
   * List of features to enable in the toolbar.
   * If empty or undefined, all features are enabled.
   */
  features?: string[];

  /**
   * Whether the toolbar is disabled.
   */
  disabled?: boolean;
}

// ============================================================
// Main Component
// ============================================================

export function RichTextToolbar({
  features = [],
  disabled = false,
}: RichTextToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const {
    isBold,
    isItalic,
    isUnderline,
    isStrikethrough,
    isCode,
    isHighlight,
    isLink,
    blockType,
    elementFormat,
    fontFamily,
    fontSize,
    fontColor,
    bgColor,
    fontColorRef,
    bgColorRef,
    canUndo,
    canRedo,
    hasFeature,
    formatText,
    formatHeading,
    formatCodeBlock,
    formatList,
    formatQuote,
    formatParagraph,
    formatAlignment,
    insertHorizontalRule,
    toggleLink,
    insertImage,
    insertVideo,
    insertButtonLink,
    insertTable,
    insertCollapsible,
    insertButtonGroup,
    insertGallery,
    applyFontFamily,
    applyFontSize,
    applyFontColor,
    applyBgColor,
    clearFormatting,
    hasBlockType,
    hasFontSelects,
    hasTextFormatting,
    hasMoreFormatting,
    hasAlignment,
    hasMedia,
  } = useToolbarState(editor, features);

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 p-1 border-b flex-wrap",
        disabled && "opacity-50 pointer-events-none"
      )}
      role="toolbar"
      aria-label="Text formatting"
    >
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        disabled={disabled || !canUndo}
        tooltip="Undo"
        shortcut="Ctrl+Z"
      >
        <Undo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        disabled={disabled || !canRedo}
        tooltip="Redo"
        shortcut="Ctrl+Y"
      >
        <Redo className="h-4 w-4" />
      </ToolbarButton>

      {/* Block Type Dropdown */}
      {hasBlockType && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <BlockTypeDropdown
            blockType={blockType}
            disabled={disabled}
            hasFeature={hasFeature}
            formatHeading={formatHeading}
            formatList={formatList}
            formatQuote={formatQuote}
            formatCodeBlock={formatCodeBlock}
            formatParagraph={formatParagraph}
          />
        </>
      )}

      {/* Font Family / Size */}
      {hasFontSelects && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />

          {hasFeature("fontFamily") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Select
                    value={fontFamily}
                    onValueChange={val =>
                      applyFontFamily(val === "__default__" ? "" : val)
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-[130px] text-xs gap-1"
                    >
                      <Type className="h-3.5 w-3.5 shrink-0" />
                      <SelectValue placeholder="Font" />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_FAMILY_OPTIONS.map(opt => (
                        <SelectItem
                          key={opt.value || "__default__"}
                          value={opt.value || "__default__"}
                        >
                          <span
                            style={
                              opt.value ? { fontFamily: opt.value } : undefined
                            }
                          >
                            {opt.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">Font Family</TooltipContent>
            </Tooltip>
          )}

          {hasFeature("fontSize") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Select value={fontSize} onValueChange={applyFontSize}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-[80px] text-xs gap-1"
                    >
                      <ALargeSmall className="h-3.5 w-3.5 shrink-0" />
                      <SelectValue placeholder="Size" />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_SIZE_OPTIONS.map(size => (
                        <SelectItem key={size} value={size}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">Font Size</TooltipContent>
            </Tooltip>
          )}
        </>
      )}

      {/* B / I / U + Color Pickers */}
      {hasTextFormatting && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />

          {hasFeature("bold") && (
            <ToolbarButton
              onClick={() => formatText("bold")}
              isActive={isBold}
              disabled={disabled}
              tooltip="Bold"
              shortcut="Ctrl+B"
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
          )}
          {hasFeature("italic") && (
            <ToolbarButton
              onClick={() => formatText("italic")}
              isActive={isItalic}
              disabled={disabled}
              tooltip="Italic"
              shortcut="Ctrl+I"
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
          )}
          {hasFeature("underline") && (
            <ToolbarButton
              onClick={() => formatText("underline")}
              isActive={isUnderline}
              disabled={disabled}
              tooltip="Underline"
              shortcut="Ctrl+U"
            >
              <Underline className="h-4 w-4" />
            </ToolbarButton>
          )}

          {hasFeature("fontColor") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 relative"
                  onClick={() => fontColorRef.current?.click()}
                  disabled={disabled}
                >
                  <Baseline className="h-4 w-4" />
                  <span
                    className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-full"
                    style={{ backgroundColor: fontColor }}
                  />
                  <input
                    ref={fontColorRef}
                    type="color"
                    value={fontColor}
                    onChange={e => applyFontColor(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    tabIndex={-1}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Text Color</TooltipContent>
            </Tooltip>
          )}

          {hasFeature("bgColor") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 relative"
                  onClick={() => bgColorRef.current?.click()}
                  disabled={disabled}
                >
                  <Paintbrush className="h-4 w-4" />
                  <span
                    className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-full border"
                    style={{ backgroundColor: bgColor }}
                  />
                  <input
                    ref={bgColorRef}
                    type="color"
                    value={bgColor}
                    onChange={e => applyBgColor(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    tabIndex={-1}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Background Color</TooltipContent>
            </Tooltip>
          )}
        </>
      )}

      {/* More Formatting Dropdown */}
      {hasMoreFormatting && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <FormattingDropdown
            disabled={disabled}
            hasFeature={hasFeature}
            isStrikethrough={isStrikethrough}
            isCode={isCode}
            isHighlight={isHighlight}
            formatText={formatText}
            insertHorizontalRule={insertHorizontalRule}
          />
        </>
      )}

      {/* Alignment Dropdown */}
      {hasAlignment && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <AlignmentDropdown
            elementFormat={elementFormat}
            disabled={disabled}
            formatAlignment={formatAlignment}
          />
        </>
      )}

      {/* Insert Dropdown */}
      {hasMedia && (
        <>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <InsertDropdown
            disabled={disabled}
            isLink={isLink}
            hasFeature={hasFeature}
            toggleLink={toggleLink}
            insertImage={insertImage}
            insertVideo={insertVideo}
            insertButtonLink={insertButtonLink}
            insertButtonGroup={insertButtonGroup}
            insertTable={insertTable}
            insertCollapsible={insertCollapsible}
            insertGallery={insertGallery}
          />
        </>
      )}

      {/* Clear formatting - always available */}
      <Separator orientation="vertical" className="h-6 mx-1" />
      <ToolbarButton
        onClick={clearFormatting}
        disabled={disabled}
        tooltip="Clear Formatting"
      >
        <RemoveFormatting className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
